import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { generateWeddingCharacters } from "./gemini.js";
import { createDevLogger, isDevMode } from "./devLogger.js";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { removeBackground } from "@imgly/background-removal-node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

const logger = createDevLogger("Server");

const app = express();
const PORT = process.env.PORT || 8080;

/** Validate image by checking magic bytes (JPEG/PNG/GIF/WebP) */
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

/** Validate WebM by checking EBML magic bytes */
function isValidWebMBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;

  const bytes = [...buffer.slice(0, 4)];

  // WebM files start with EBML header: 0x1A 0x45 0xDF 0xA3
  return bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3;
}

function validatePhotoUpload(photo, requestId) {
  if (!photo) {
    return { valid: false, status: 400, error: "Couple photo is required" };
  }
  if (!isValidImageBuffer(photo.buffer)) {
    return { valid: false, status: 400, error: "Invalid image file. Please upload a valid JPEG, PNG, GIF, or WebP image." };
  }
  return { valid: true };
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
// CORS configuration - supports multiple origins for web + mobile apps
const allowedOrigins = [
  // Capacitor Android/iOS origins
  'https://localhost',
  'capacitor://localhost',
  // Add origins from CORS_ORIGIN env var (comma-separated)
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(o => o.trim().replace(/\/+$/, '')) : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // In dev mode, allow all origins
    if (isDevMode()) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Serve frontend assets (for local development with backend/frontend/ folder)
// In production Docker, this serves assets copied by Dockerfile
app.use('/assets', express.static(path.join(__dirname, 'frontend', 'public', 'assets')));
app.use('/fonts', express.static(path.join(__dirname, 'frontend', 'public', 'fonts')));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", devMode: isDevMode() });
});

// Background removal endpoint - server-side fallback for when client-side fails
app.post(
  "/api/remove-background",
  upload.single("image"),
  async (req, res) => {
    const requestId = Date.now().toString(36);

    try {
      const image = req.file;

      if (!image) {
        return res.status(400).json({
          success: false,
          error: "Image file is required",
        });
      }

      const validation = validatePhotoUpload(image, requestId);
      if (!validation.valid) {
        return res.status(validation.status).json({
          success: false,
          error: validation.error
        });
      }

      logger.log(`[${requestId}] Starting server-side background removal`, {
        imageSize: `${(image.buffer.length / 1024).toFixed(1)} KB`,
        mimeType: image.mimetype,
      });

      const startTime = Date.now();

      // Remove background using @imgly/background-removal-node
      const resultBlob = await removeBackground(image.buffer, {
        model: "small",
        output: {
          format: "image/png",
          quality: 1.0,
        },
      });

      const duration = Date.now() - startTime;

      // Convert Blob to Buffer
      const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

      logger.log(`[${requestId}] Background removal complete`, {
        duration: `${duration}ms`,
        inputSize: `${(image.buffer.length / 1024).toFixed(1)} KB`,
        outputSize: `${(resultBuffer.length / 1024).toFixed(1)} KB`,
      });

      // Return as base64 data URL
      const base64 = resultBuffer.toString("base64");
      const dataURL = `data:image/png;base64,${base64}`;

      res.json({
        success: true,
        imageDataURL: dataURL,
      });
    } catch (error) {
      logger.error(`[${requestId}] Background removal failed`, error);

      res.status(500).json({
        success: false,
        error: "Background removal failed. Please try again.",
      });
    }
  }
);

// Main generation endpoint with rate limiting (skip in dev mode)
app.post(
  "/api/generate",
  (req, res, next) => {
    // Skip rate limiting in dev mode
    if (isDevMode()) {
      return next();
    }
    return generateLimiter(req, res, next);
  },
  upload.single("photo"),
  async (req, res) => {
    const requestId = Date.now().toString(36);

    try {
      const photo = req.file;

      const validation = validatePhotoUpload(photo, requestId);
      if (!validation.valid) return res.status(validation.status).json({ success: false, error: validation.error });

      const result = await generateWeddingCharacters(photo, requestId);

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
      logger.error(`[${requestId}] Generation failed`, error);

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

    try {
      const video = req.file;

      if (!video) {
        return res.status(400).json({
          success: false,
          error: "WebM video file is required",
        });
      }

      if (!isValidWebMBuffer(video.buffer)) {
        return res.status(400).json({
          success: false,
          error: "Invalid WebM file. Please upload a valid WebM video.",
        });
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-convert-"));
      const inputPath = path.join(tempDir, "input.webm");
      const outputPath = path.join(tempDir, "output.mp4");

      await fs.writeFile(inputPath, video.buffer);

      const ffmpegCmd = `ffmpeg -y -i "${inputPath}" \
        -c:v libx264 \
        -preset veryfast \
        -crf 36 \
        -maxrate 600k \
        -bufsize 1200k \
        -bf 0 \
        -pix_fmt yuv420p \
        -c:a aac -b:a 96k \
        -movflags +faststart \
        "${outputPath}"`;

      try {
        await execAsync(ffmpegCmd, { timeout: 120000 });
      } catch (ffmpegError) {
        logger.error(`[${requestId}] FFmpeg conversion failed`, ffmpegError);
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        return res.status(500).json({
          success: false,
          error: "Video conversion failed. FFmpeg error.",
        });
      }

      const mp4Buffer = await fs.readFile(outputPath);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

      res.set({
        "Content-Type": "video/mp4",
        "Content-Length": mp4Buffer.length,
        "Content-Disposition": "attachment; filename=output.mp4",
      });
      res.send(mp4Buffer);

    } catch (error) {
      logger.error(`[${requestId}] Video conversion failed`, error);

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

    try {
      const { brideName, groomName, date, time, brideParents, groomParents } = req.body;
      const characterImage = req.file;

      if (!brideName || !groomName || !date || !time || !brideParents || !groomParents) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: brideName, groomName, date, time, brideParents, groomParents",
        });
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-compose-"));
      const characterPath = path.join(tempDir, "character.png");
      const dividerPngPath = path.join(tempDir, "divider.png");
      const outputPath = path.join(tempDir, "output.mp4");

      const backgroundVideoPath = path.join(__dirname, "../frontend/public/assets/background.mp4");
      const dividerSvgPath = path.join(__dirname, "../frontend/public/assets/divider.svg");
      const fontsDir = path.join(__dirname, "../frontend/public/fonts");
      const playfairRegular = path.join(fontsDir, "PlayfairDisplay.ttf");
      const playfairBold = path.join(fontsDir, "PlayfairDisplay-Bold.ttf");
      const playfairItalic = path.join(fontsDir, "PlayfairDisplay-Italic.ttf");

      try {
        await fs.access(backgroundVideoPath);
      } catch (err) {
        logger.error(`[${requestId}] Background video NOT FOUND at ${backgroundVideoPath}`);
        return res.status(500).json({
          success: false,
          error: `Background video not found at path: ${backgroundVideoPath}`,
        });
      }

      try {
        await fs.access(playfairRegular);
        await fs.access(playfairBold);
        await fs.access(playfairItalic);
        await fs.access(dividerSvgPath);
      } catch (err) {
        logger.error(`[${requestId}] Required assets NOT FOUND`, err);
        return res.status(500).json({
          success: false,
          error: `Required assets not found. Please check fonts and divider.svg`,
        });
      }

      if (characterImage) {
        await fs.writeFile(characterPath, characterImage.buffer);
      }

      // Convert divider.svg to PNG for overlay (width=400px for good quality)
      try {
        await execAsync(`convert -background none -density 300 -resize 400x "${dividerSvgPath}" "${dividerPngPath}"`);
      } catch (convertError) {
        logger.error(`[${requestId}] SVG to PNG conversion failed, trying rsvg-convert`, convertError);
        try {
          await execAsync(`rsvg-convert -w 400 "${dividerSvgPath}" -o "${dividerPngPath}"`);
        } catch (rsvgError) {
          logger.error(`[${requestId}] Both convert and rsvg-convert failed, skipping divider`);
          // Continue without divider if conversion fails
        }
      }

      // Video dimensions (720p portrait for high quality)
      const width = 720;
      const height = 1280;

      // Character positioning (matching client-side layout)
      // Character takes 60% of height, centered horizontally
      const charHeightPercent = 0.60;
      const charTopPercent = 0.4;
      const charHeight = Math.round(height * charHeightPercent);
      const charY = Math.round(height * charTopPercent);

      // Text layout positions (text fades in at 10s after character fades out)
      const brideNameY = Math.round(height * 0.18); // 18% from top = 230px
      const brideDaughterY = brideNameY + 105;      // 105px below bride name = 335px
      const wedsY = Math.round(height * 0.40);      // 40% from top = 512px
      const groomNameY = 690;                       // Moved up by 20px (was 710)
      const groomSonY = groomNameY + 105;           // 105px below groom name = 795px
      const dividerY = Math.round(height * 0.68);   // 68% from top = 870px (moved up, now before date)
      const dateY = dividerY + 90;                  // 90px below divider = 960px
      const timeY = dateY + 80;                     // 80px below date = 1040px

      // Font sizes (updated per plan)
      const brideGroomNameSize = 80;
      const parentLineSize = 40;  // 20 → 40
      const wedsSize = 60;        // 24 → 60
      const dateSize = 40;        // 24 → 40
      const timeSize = 30;        // 20 → 30
      // Character animation timing
      const CHARACTER_FADE_START = 2;
      const CHARACTER_FADE_DURATION = 2;
      const CHARACTER_FADE_OUT_START = 8;  // Start fading out at 8s
      const CHARACTER_FADE_OUT_DURATION = 2;  // Fade out over 2s (done by 10s)

      // Escape special characters for FFmpeg drawtext
      const escapeText = (text) => text.replace(/'/g, "'\\''").replace(/:/g, "\\:");

      // Escape font file paths for FFmpeg (colons need escaping, use forward slashes)
      const escapeFontPath = (fontPath) => fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');

      // Build text for each line
      const brideNameText = escapeText(brideName);
      const brideDaughterText = escapeText(`(Daughter of ${brideParents})`);
      const wedsText = "WEDS";
      const groomNameText = escapeText(groomName);
      const groomSonText = escapeText(`(Son of ${groomParents})`);
      const dateText = escapeText(date);
      const timeText = escapeText(`${time} onwards`);

      // Check if divider PNG was created successfully
      let dividerExists = false;
      try {
        await fs.access(dividerPngPath);
        dividerExists = true;
      } catch {
        // Divider not available, will skip in filter
      }

      // Layers: scaled video → character overlay → divider overlay → text overlays
      let filterComplex = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];`;

      let inputIndex = 1;
      if (characterImage) {
        // Scale character image, fade in at 2s, fade out by 10s
        filterComplex += `[${inputIndex}:v]scale=-1:${charHeight},format=rgba,fade=in:st=${CHARACTER_FADE_START}:d=${CHARACTER_FADE_DURATION}:alpha=1,fade=out:st=${CHARACTER_FADE_OUT_START}:d=${CHARACTER_FADE_OUT_DURATION}:alpha=1[char];`;
        filterComplex += `[bg][char]overlay=(W-w)/2:${charY}[vid];`;
        inputIndex++;
      } else {
        filterComplex += `[bg]copy[vid];`;
      }

      // Add divider overlay with fade-in at 10s (if available)
      if (dividerExists) {
        filterComplex += `[${inputIndex}:v]scale=400:-1,format=rgba,fade=in:st=10:d=2:alpha=1[divider];`;
        filterComplex += `[vid][divider]overlay=(W-w)/2:${dividerY}[vid2];`;
      } else {
        filterComplex += `[vid]copy[vid2];`;
      }

      // Add text overlays with fade-in at 10s over 2s duration
      // Alpha expression: invisible until 10s, fade from 0 to 1 between 10-12s, then fully visible
      const textAlpha = "if(lt(t,10),0,if(lt(t,12),((t-10)/2),1))";

      // Escape font paths for FFmpeg drawtext filter
      const playfairBoldEsc = escapeFontPath(playfairBold);
      const playfairItalicEsc = escapeFontPath(playfairItalic);

      // Bride name (Playfair Display Bold, 80px, #621d35)
      filterComplex += `[vid2]drawtext=fontfile=${playfairBoldEsc}:text='${brideNameText}':fontsize=${brideGroomNameSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${brideNameY}:alpha='${textAlpha}'[v1];`;

      // Daughter of... (Playfair Display Italic, 40px, #621d35)
      filterComplex += `[v1]drawtext=fontfile=${playfairItalicEsc}:text='${brideDaughterText}':fontsize=${parentLineSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${brideDaughterY}:alpha='${textAlpha}'[v2];`;

      // WEDS (Playfair Display Italic, 60px, #621d35)
      filterComplex += `[v2]drawtext=fontfile=${playfairItalicEsc}:text='${wedsText}':fontsize=${wedsSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${wedsY}:alpha='${textAlpha}'[v3];`;

      // Groom name (Playfair Display Bold, 80px, #621d35)
      filterComplex += `[v3]drawtext=fontfile=${playfairBoldEsc}:text='${groomNameText}':fontsize=${brideGroomNameSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${groomNameY}:alpha='${textAlpha}'[v4];`;

      // Son of... (Playfair Display Italic, 40px, #621d35)
      filterComplex += `[v4]drawtext=fontfile=${playfairItalicEsc}:text='${groomSonText}':fontsize=${parentLineSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${groomSonY}:alpha='${textAlpha}'[v5];`;

      // Date (Playfair Display Italic, 40px, #621d35)
      filterComplex += `[v5]drawtext=fontfile=${playfairItalicEsc}:text='${dateText}':fontsize=${dateSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${dateY}:alpha='${textAlpha}'[v6];`;

      // Time onwards (Playfair Display Italic, 30px, #621d35)
      filterComplex += `[v6]drawtext=fontfile=${playfairItalicEsc}:text='${timeText}':fontsize=${timeSize}:fontcolor=0x621D35:x=(w-text_w)/2:y=${timeY}:alpha='${textAlpha}'[vout]`;

      // Build FFmpeg command
      // Use explicit -t on looped image input to avoid infinite stream + malformed moov atom
      let inputs = `-i "${backgroundVideoPath}"`;
      if (characterImage) {
        inputs += ` -loop 1 -t 15 -i "${characterPath}"`;
      }
      if (dividerExists) {
        inputs += ` -loop 1 -t 15 -i "${dividerPngPath}"`;
      }

      const ffmpegCmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[vout]" -map 0:a? -c:v libx264 -preset fast -r 24 -crf 23 -maxrate 2500k -bufsize 5000k -c:a aac -b:a 128k -pix_fmt yuv420p -movflags +faststart -shortest "${outputPath}"`;

      try {
        await execAsync(ffmpegCmd, { timeout: 300000 });
      } catch (ffmpegError) {
        logger.error(`[${requestId}] FFmpeg composition failed`, {
          error: ffmpegError.message,
          stderr: ffmpegError.stderr?.slice(-500),
        });

        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

        return res.status(500).json({
          success: false,
          error: `Video composition failed: ${ffmpegError.stderr?.slice(-200) || ffmpegError.message}`,
        });
      }

      const mp4Buffer = await fs.readFile(outputPath);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

      res.set({
        "Content-Type": "video/mp4",
        "Content-Length": mp4Buffer.length,
        "Content-Disposition": "attachment; filename=wedding-invite.mp4",
      });
      res.send(mp4Buffer);

    } catch (error) {
      logger.error(`[${requestId}] Video composition failed`, error);

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
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Server] Dev Mode: ${isDevMode() ? "ENABLED" : "disabled"}`);
  console.log(`[Server] Gemini API Key: ${process.env.GEMINI_API_KEY ? "Set" : "NOT SET"}`);
  console.log(`[Server] Photo Analysis Provider: ${process.env.PHOTO_ANALYSIS_PROVIDER || "gpt"}`);

  // Check critical assets
  const assetPaths = {
    backgroundVideo: path.join(__dirname, "../frontend/public/assets/background.mp4"),
    dividerSvg: path.join(__dirname, "../frontend/public/assets/divider.svg"),
    playfairRegular: path.join(__dirname, "../frontend/public/fonts/PlayfairDisplay.ttf"),
    playfairBold: path.join(__dirname, "../frontend/public/fonts/PlayfairDisplay-Bold.ttf"),
    playfairItalic: path.join(__dirname, "../frontend/public/fonts/PlayfairDisplay-Italic.ttf"),
  };

  for (const [name, filePath] of Object.entries(assetPaths)) {
    try {
      await fs.access(filePath);
    } catch {
      console.log(`  ✗ ${name} MISSING: ${filePath}`);
    }
  }

  try {
    execSync('ffmpeg -version', { encoding: 'utf-8', stdio: 'ignore' });
  } catch (err) {
    console.error('[Server] ✗ FFmpeg NOT FOUND');
  }
});

// Graceful shutdown for node --watch and CTRL+C
function gracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal}, closing server gracefully...`);
  server.close(() => {
    console.log('[Server] Server closed. Exiting process.');
    process.exit(0);
  });

  // Force close after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
