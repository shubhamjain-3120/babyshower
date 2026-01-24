import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { generateWeddingCharacters } from "./gemini.js";
import { createDevLogger, isDevMode } from "./devLogger.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const logger = createDevLogger("Server");

const app = express();
const PORT = process.env.PORT || 3001;

// Validate file is actually an image by checking magic bytes
function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;

  const bytes = [...buffer.slice(0, 12)];

  // Check JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;

  // Check PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;

  // Check GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;

  // Check WebP (RIFF....WEBP)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;

  return false;
}

// Validate file is actually a WebM video by checking magic bytes
function isValidWebMBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;

  const bytes = [...buffer.slice(0, 4)];

  // WebM files start with EBML header: 0x1A 0x45 0xDF 0xA3
  return bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3;
}

// Configure multer for memory storage (images)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
  },
  fileFilter: (req, file, cb) => {
    // First check: MIME type (can be spoofed but catches obvious mistakes)
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});

// Configure multer for video uploads (for WebM to MP4 conversion)
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max for video files
  },
  fileFilter: (req, file, cb) => {
    // Accept video/webm MIME type
    if (file.mimetype !== "video/webm") {
      cb(new Error("Only WebM video files are allowed"));
      return;
    }
    cb(null, true);
  },
});

// Rate limiting: 10 requests per week per IP
const generateLimiter = rateLimit({
  windowMs: 7 * 24 * 60 * 60 * 1000, // 1 week
  max: 10, // 10 requests per week per IP
  message: { 
    success: false, 
    error: "Rate limit exceeded. You can generate up to 10 invites per week. Please try again later." 
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use X-Forwarded-For if behind proxy, otherwise use IP
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  },
});

// Middleware
// Strip trailing slash from CORS origin to match browser's Origin header exactly
const corsOrigin = process.env.CORS_ORIGIN?.replace(/\/+$/, "") || (isDevMode() ? '*' : 'https://your-domain.com');
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get("/api/health", (req, res) => {
  logger.log("Health check requested");
  res.json({ status: "ok", devMode: isDevMode() });
});

// Main generation endpoint with rate limiting
app.post(
  "/api/generate",
  generateLimiter,
  upload.single("photo"),
  async (req, res) => {
    const requestId = Date.now().toString(36);
    const startTime = performance.now();
    
    logger.log(`[${requestId}] Generate endpoint called`, {
      hasFile: !!req.file,
      fileSize: req.file ? `${(req.file.size / 1024).toFixed(1)} KB` : null,
      fileMimeType: req.file?.mimetype,
    });

    try {
      const photo = req.file;

      // Validate input - require couple photo
      if (!photo) {
        logger.warn(`[${requestId}] Validation failed`, "No photo provided");
        return res.status(400).json({
          success: false,
          error: "Couple photo is required",
        });
      }

      // Security: Validate file content (magic bytes) - not just MIME type
      if (!isValidImageBuffer(photo.buffer)) {
        logger.warn(`[${requestId}] Validation failed`, "Invalid image file content");
        return res.status(400).json({
          success: false,
          error: "Invalid image file. Please upload a valid JPEG, PNG, GIF, or WebP image.",
        });
      }

      logger.log(`[${requestId}] Step 1: Starting generation pipeline`, {
        photoSize: `${(photo.size / 1024).toFixed(1)} KB`,
        photoMimeType: photo.mimetype,
      });
      console.log(`[Server] Generating wedding portrait from couple photo`);

      // Generate characters using Gemini (extracts features then generates)
      const result = await generateWeddingCharacters(photo, requestId);

      const totalDuration = performance.now() - startTime;
      logger.log(`[${requestId}] Generation complete`, {
        totalDuration: `${totalDuration.toFixed(0)}ms`,
        imageSizeKB: `${(result.imageData.length * 0.75 / 1024).toFixed(1)} KB`,
        evaluationScore: result.evaluation?.score,
        evaluationPassed: result.evaluation?.passed,
      });

      res.json({
        success: true,
        characterImage: `data:${result.mimeType};base64,${result.imageData}`,
        evaluation: result.evaluation ? {
          score: result.evaluation.score,
          passed: result.evaluation.passed,
          hardRulesPassed: result.evaluation.hardRulesPassed,
          issues: result.evaluation.details?.issues || []
        } : null
      });
    } catch (error) {
      const totalDuration = performance.now() - startTime;
      logger.error(`[${requestId}] Generation failed after ${totalDuration.toFixed(0)}ms`, error);
      console.error("[Server] Generation error:", error);

      // After max retries, return error to client
      res.status(500).json({
        success: false,
        error: "Generation failed. Please try again.",
      });
    }
  }
);

// Video conversion endpoint (WebM to MP4)
// Used as fallback for iOS/mobile devices where FFmpeg.wasm doesn't work
app.post(
  "/api/convert-video",
  videoUpload.single("video"),
  async (req, res) => {
    const requestId = Date.now().toString(36);
    const startTime = performance.now();

    logger.log(`[${requestId}] Video conversion endpoint called`, {
      hasFile: !!req.file,
      fileSize: req.file ? `${(req.file.size / 1024 / 1024).toFixed(2)} MB` : null,
      fileMimeType: req.file?.mimetype,
    });

    try {
      const video = req.file;

      // Validate input
      if (!video) {
        logger.warn(`[${requestId}] Validation failed`, "No video provided");
        return res.status(400).json({
          success: false,
          error: "WebM video file is required",
        });
      }

      // Validate file content (magic bytes)
      if (!isValidWebMBuffer(video.buffer)) {
        logger.warn(`[${requestId}] Validation failed`, "Invalid WebM file content");
        return res.status(400).json({
          success: false,
          error: "Invalid WebM file. Please upload a valid WebM video.",
        });
      }

      // Create temp directory and files
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-convert-"));
      const inputPath = path.join(tempDir, "input.webm");
      const outputPath = path.join(tempDir, "output.mp4");

      logger.log(`[${requestId}] Writing WebM to temp file`, {
        tempDir,
        inputSize: `${(video.buffer.length / 1024 / 1024).toFixed(2)} MB`,
      });

      // Write WebM to temp file
      await fs.writeFile(inputPath, video.buffer);

      // Run FFmpeg conversion
      // -i: input file
      // -c:v libx264: H.264 video codec
      // -preset ultrafast: fastest encoding (good enough quality for our use case)
      // -crf 23: quality level (lower = better, 23 is default)
      // -c:a aac: AAC audio codec
      // -b:a 96k: audio bitrate
      // -movflags +faststart: optimize for web streaming
      // -pix_fmt yuv420p: ensure compatibility with all players
      const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 96k -movflags +faststart -pix_fmt yuv420p "${outputPath}"`;

      logger.log(`[${requestId}] Running FFmpeg conversion`, { command: ffmpegCmd });
      const conversionStart = performance.now();

      try {
        await execAsync(ffmpegCmd, { timeout: 120000 }); // 2 minute timeout
      } catch (ffmpegError) {
        logger.error(`[${requestId}] FFmpeg conversion failed`, ffmpegError);

        // Cleanup temp files
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

        return res.status(500).json({
          success: false,
          error: "Video conversion failed. FFmpeg error.",
        });
      }

      const conversionTime = performance.now() - conversionStart;
      logger.log(`[${requestId}] FFmpeg conversion complete`, {
        duration: `${conversionTime.toFixed(0)}ms`,
      });

      // Read output MP4
      const mp4Buffer = await fs.readFile(outputPath);

      logger.log(`[${requestId}] MP4 output ready`, {
        outputSize: `${(mp4Buffer.length / 1024 / 1024).toFixed(2)} MB`,
        compressionRatio: `${((1 - mp4Buffer.length / video.buffer.length) * 100).toFixed(1)}%`,
      });

      // Cleanup temp files
      await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
        logger.warn(`[${requestId}] Failed to cleanup temp dir`, err.message);
      });

      const totalDuration = performance.now() - startTime;
      logger.log(`[${requestId}] Video conversion complete`, {
        totalDuration: `${totalDuration.toFixed(0)}ms`,
        inputSize: `${(video.buffer.length / 1024 / 1024).toFixed(2)} MB`,
        outputSize: `${(mp4Buffer.length / 1024 / 1024).toFixed(2)} MB`,
      });

      // Send MP4 as binary response
      res.set({
        "Content-Type": "video/mp4",
        "Content-Length": mp4Buffer.length,
        "Content-Disposition": "attachment; filename=output.mp4",
      });
      res.send(mp4Buffer);

    } catch (error) {
      const totalDuration = performance.now() - startTime;
      logger.error(`[${requestId}] Video conversion failed after ${totalDuration.toFixed(0)}ms`, error);
      console.error("[Server] Video conversion error:", error);

      res.status(500).json({
        success: false,
        error: "Video conversion failed. Please try again.",
      });
    }
  }
);

// Configure multer for video composition (character image + text fields)
const composeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for character image
  },
});

// Video composition endpoint - full server-side video generation
// Used for Chrome iOS where client-side MediaRecorder is broken
app.post(
  "/api/compose-video",
  composeUpload.single("characterImage"),
  async (req, res) => {
    const requestId = Date.now().toString(36);
    const startTime = performance.now();

    logger.log(`[${requestId}] Video composition endpoint called`, {
      hasCharacterImage: !!req.file,
      characterImageSize: req.file ? `${(req.file.size / 1024).toFixed(1)} KB` : null,
      brideName: req.body.brideName,
      groomName: req.body.groomName,
      date: req.body.date,
      venue: req.body.venue,
    });

    try {
      const { brideName, groomName, date, venue } = req.body;
      const characterImage = req.file;

      // Validate required fields
      if (!brideName || !groomName || !date || !venue) {
        logger.warn(`[${requestId}] Validation failed`, "Missing required fields");
        return res.status(400).json({
          success: false,
          error: "Missing required fields: brideName, groomName, date, venue",
        });
      }

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-compose-"));
      const characterPath = path.join(tempDir, "character.png");
      const outputPath = path.join(tempDir, "output.mp4");

      // Path to background video (in frontend public assets)
      const backgroundVideoPath = path.resolve("../frontend/public/assets/background.mp4");

      // Path to fonts
      const fontsDir = path.resolve("../frontend/public/fonts");
      const alexBrushFont = path.join(fontsDir, "AlexBrush-Regular.ttf");
      const playfairFont = path.join(fontsDir, "PlayfairDisplay-Regular.ttf");

      logger.log(`[${requestId}] Writing character image to temp file`, { tempDir });

      // Write character image to temp file
      if (characterImage) {
        await fs.writeFile(characterPath, characterImage.buffer);
      }

      // Video dimensions
      const width = 1080;
      const height = 1920;

      // Animation timings (in seconds)
      const namesStart = 2.5, namesEnd = 3;
      const dateStart = 3, dateEnd = 3.5;
      const venueStart = 3.5, venueEnd = 4;
      const charStart = 4, charEnd = 5;

      // Character positioning (matching client-side layout)
      // Character takes 60% of height, centered horizontally
      const charHeightPercent = 0.60;
      const charTopPercent = 0.22;
      const charHeight = Math.round(height * charHeightPercent);
      const charY = Math.round(height * charTopPercent);

      // Text positions
      const namesY = Math.round(height * 0.1);
      const dateY = Math.round(height * 0.875);
      const venueY = Math.round(height * 0.915);

      // Font sizes
      const namesFontSize = Math.round(54 * 2.405);
      const textFontSize = Math.round(54 * 0.9);

      // Escape special characters for FFmpeg drawtext
      const escapeText = (text) => text.replace(/'/g, "'\\''").replace(/:/g, "\\:");

      // Build the names text (Bride & Groom)
      const namesText = escapeText(`${brideName} & ${groomName}`);
      const dateText = escapeText(date);
      const venueText = escapeText(venue);

      // Build FFmpeg filter complex
      // Layer 1: Scale video to canvas size
      // Layer 2: Overlay character image (with fade-in)
      // Layer 3: Draw text overlays (with fade-in)
let filterComplex = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];`;

if (characterImage) {
  // Calculate duration because the 'fade' filter takes Duration (d), not End Time.
  const fadeDuration = charEnd - charStart;

  // 2. Apply Scale AND Fade to the character image
  // 'format=rgba' ensures transparency works.
  // 'st' is start time, 'd' is duration.
  filterComplex += `[1:v]scale=-1:${charHeight},format=rgba,fade=t=in:st=${charStart}:d=${fadeDuration}:alpha=1[char];`;

  // 3. Simple Overlay (No complex math here)
  filterComplex += `[bg][char]overlay=(W-w)/2:${charY}[vid];`;

} else {        filterComplex += `[bg]copy[vid];`;
      }

      // Add text overlays with fade-in
      // Names text (gold color, script font)
      filterComplex += `[vid]drawtext=fontfile='${alexBrushFont}':text='${namesText}':fontsize=${namesFontSize}:fontcolor=0xD4A853:x=(w-text_w)/2:y=${namesY}:alpha='if(lt(t,${namesStart}),0,if(lt(t,${namesEnd}),(t-${namesStart})/(${namesEnd}-${namesStart}),1))'[v1];`;

      // Date text (brown color, serif font)
      filterComplex += `[v1]drawtext=fontfile='${playfairFont}':text='${dateText}':fontsize=${textFontSize}:fontcolor=0x8B7355:x=(w-text_w)/2:y=${dateY}:alpha='if(lt(t,${dateStart}),0,if(lt(t,${dateEnd}),(t-${dateStart})/(${dateEnd}-${dateStart}),1))'[v2];`;

      // Venue text (brown color, serif font)
      filterComplex += `[v2]drawtext=fontfile='${playfairFont}':text='${venueText}':fontsize=${textFontSize}:fontcolor=0x8B7355:x=(w-text_w)/2:y=${venueY}:alpha='if(lt(t,${venueStart}),0,if(lt(t,${venueEnd}),(t-${venueStart})/(${venueEnd}-${venueStart}),1))'[vout]`;

      // Build FFmpeg command
      const inputs = characterImage
        ? `-i "${backgroundVideoPath}" -loop 1 -i "${characterPath}"`
        : `-i "${backgroundVideoPath}"`;

      const ffmpegCmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[vout]" -map 0:a? -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -pix_fmt yuv420p -shortest "${outputPath}"`;

      logger.log(`[${requestId}] Running FFmpeg composition`, {
        command: ffmpegCmd.slice(0, 200) + "...",
      });

      const compositionStart = performance.now();

      try {
        await execAsync(ffmpegCmd, { timeout: 180000 }); // 3 minute timeout
      } catch (ffmpegError) {
        logger.error(`[${requestId}] FFmpeg composition failed`, {
          error: ffmpegError.message,
          stderr: ffmpegError.stderr?.slice(0, 1000),
          stdout: ffmpegError.stdout?.slice(0, 500),
        });

        // Cleanup temp files
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

        return res.status(500).json({
          success: false,
          error: `Video composition failed: ${ffmpegError.stderr?.slice(0, 200) || ffmpegError.message}`,
        });
      }

      const compositionTime = performance.now() - compositionStart;
      logger.log(`[${requestId}] FFmpeg composition complete`, {
        duration: `${compositionTime.toFixed(0)}ms`,
      });

      // Read output MP4
      const mp4Buffer = await fs.readFile(outputPath);

      logger.log(`[${requestId}] MP4 output ready`, {
        outputSize: `${(mp4Buffer.length / 1024 / 1024).toFixed(2)} MB`,
      });

      // Cleanup temp files
      await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
        logger.warn(`[${requestId}] Failed to cleanup temp dir`, err.message);
      });

      const totalDuration = performance.now() - startTime;
      logger.log(`[${requestId}] Video composition complete`, {
        totalDuration: `${totalDuration.toFixed(0)}ms`,
        outputSize: `${(mp4Buffer.length / 1024 / 1024).toFixed(2)} MB`,
      });

      // Send MP4 as binary response
      res.set({
        "Content-Type": "video/mp4",
        "Content-Length": mp4Buffer.length,
        "Content-Disposition": "attachment; filename=wedding-invite.mp4",
      });
      res.send(mp4Buffer);

    } catch (error) {
      const totalDuration = performance.now() - startTime;
      logger.error(`[${requestId}] Video composition failed after ${totalDuration.toFixed(0)}ms`, error);
      console.error("[Server] Video composition error:", error);

      res.status(500).json({
        success: false,
        error: "Video composition failed. Please try again.",
      });
    }
  }
);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Unhandled error", err);
  console.error("[Server] Error:", err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] Dev Mode: ${isDevMode() ? "ENABLED" : "disabled"}`);
  console.log(`[Server] OpenAI API Key: ${process.env.OPENAI_API_KEY ? "Set" : "NOT SET"}`);
  console.log(`[Server] Gemini API Key: ${process.env.GEMINI_API_KEY ? "Set" : "NOT SET"}`);
  
  if (isDevMode()) {
    console.log(`[Server] Dev logging is enabled - detailed logs will be shown`);
  }
});
