import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { generateWeddingCharacters } from "./gemini.js";
import { createDevLogger, isDevMode } from "./devLogger.js";

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

// Configure multer for memory storage
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
app.use(cors({
  origin: process.env.CORS_ORIGIN || (isDevMode() ? '*' : 'https://your-domain.com'),
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
