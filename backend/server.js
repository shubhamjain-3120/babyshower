import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { generateBabyIllustration } from "./image-generation.js";
import { createDevLogger, isDevMode } from "./devLogger.js";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { removeBackground } from "@imgly/background-removal-node";
import { VIDEO_CONFIG } from "./videoConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

const logger = createDevLogger("Server");

const app = express();
const PORT = process.env.PORT || 8080;

const DEV_MODE_VENUE = "Hotel Jain Ji Shubham";
function parseEnvPrice(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DEFAULT_PRICE_USD = parseEnvPrice("PRICE_USD", 4.99);
const DEV_PRICE_USD = parseEnvPrice("DEV_PRICE_USD", 1);

const DEFAULT_PRICING = {
  USD: DEFAULT_PRICE_USD,
};
const DEV_PRICING = {
  USD: DEV_PRICE_USD,
};

function isDevModeVenue(venue) {
  if (!venue) return false;
  return venue.trim().toLowerCase() === DEV_MODE_VENUE.toLowerCase();
}

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RAZORPAY_ENABLED = process.env.RAZORPAY_ENABLED
  ? process.env.RAZORPAY_ENABLED === "true"
  : Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
const RAZORPAY_BASE_URL = process.env.RAZORPAY_BASE_URL || "https://api.razorpay.com";

function getRazorpayAuthHeader(requestId) {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    logger.error(`[${requestId}] Razorpay credentials missing`);
    throw new Error("Razorpay configuration missing");
  }
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  return `Basic ${auth}`;
}

function toMinorUnits(amount) {
  const major = Number(amount);
  if (!Number.isFinite(major)) return null;
  return Math.round(major * 100);
}

function resolveOrderAmount({ venue, currency }) {
  const normalizedCurrency = (currency || "USD").toUpperCase();
  const isDevOrder = isDevModeVenue(venue) || isDevMode();

  const majorAmount = isDevOrder
    ? (DEV_PRICING[normalizedCurrency] ?? DEFAULT_PRICING[normalizedCurrency] ?? 0.01)
    : (DEFAULT_PRICING[normalizedCurrency] ?? 0.01);

  return {
    currency: normalizedCurrency,
    majorAmount,
  };
}

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
    return { valid: false, status: 400, error: "Baby photo is required" };
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
app.use('/assets', express.static(path.join(__dirname, '../frontend/public/assets')));
app.use('/fonts', express.static(path.join(__dirname, '../frontend/public/fonts')));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", devMode: isDevMode() });
});

// Pricing config (derived from backend env only)
app.get("/api/pricing", (req, res) => {
  const venue = req.query?.venue ? String(req.query.venue) : "";
  const resolved = resolveOrderAmount({ venue, currency: "USD" });
  res.json({
    currency: resolved.currency,
    amount: resolved.majorAmount,
  });
});

// Razorpay payment: create order (USD only)
app.post("/api/payment/razorpay/create-order", async (req, res) => {
  const requestId = Date.now().toString(36);

  try {
    if (!RAZORPAY_ENABLED) {
      return res.status(503).json({
        success: false,
        error: "Razorpay is disabled",
      });
    }

    const { venue, currency } = req.body || {};
    if (currency && String(currency).toUpperCase() !== "USD") {
      return res.status(400).json({
        success: false,
        error: "Only USD payments are supported",
      });
    }

    const resolved = resolveOrderAmount({ venue, currency: "USD" });

    if (!resolved?.majorAmount || resolved.majorAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount",
      });
    }

    if (resolved.currency !== "USD") {
      return res.status(400).json({
        success: false,
        error: "Only USD payments are supported",
      });
    }

    const amountMinor = toMinorUnits(resolved.majorAmount);
    if (!amountMinor || amountMinor <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount",
      });
    }

    const authHeader = getRazorpayAuthHeader(requestId);

    logger.log(`[${requestId}] Creating Razorpay order`, {
      currency: resolved.currency,
      amount: amountMinor,
      venue,
      devMode: isDevModeVenue(venue) || isDevMode(),
    });

    const orderRes = await fetch(`${RAZORPAY_BASE_URL}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountMinor,
        currency: resolved.currency,
        receipt: `receipt_${requestId}`,
        payment_capture: 1,
        notes: venue ? { venue: venue.slice(0, 120) } : undefined,
      }),
    });

    if (!orderRes.ok) {
      const errorText = await orderRes.text();
      logger.error(`[${requestId}] Razorpay order failed`, {
        status: orderRes.status,
        error: errorText,
      });
      return res.status(502).json({
        success: false,
        error: "Failed to create Razorpay order",
        ...(isDevMode()
          ? { details: errorText, status: orderRes.status }
          : {}),
      });
    }

    const orderData = await orderRes.json();

    logger.log(`[${requestId}] Razorpay order created`, {
      orderId: orderData?.id,
      amount: amountMinor,
      currency: resolved.currency,
    });

    return res.json({
      success: true,
      orderId: orderData.id,
      amount: resolved.majorAmount,
      currency: resolved.currency,
    });
  } catch (error) {
    logger.error(`[${requestId}] Razorpay create order failed`, error);
    return res.status(500).json({
      success: false,
      error: "Razorpay order creation failed",
    });
  }
});

// Razorpay payment: verify signature and confirm capture
app.post("/api/payment/razorpay/verify", async (req, res) => {
  const requestId = Date.now().toString(36);

  try {
    if (!RAZORPAY_ENABLED) {
      return res.status(503).json({
        success: false,
        error: "Razorpay is disabled",
      });
    }

    const { orderId, paymentId, signature, venue } = req.body || {};
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        success: false,
        error: "Missing Razorpay verification payload",
      });
    }

    if (!RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        success: false,
        error: "Razorpay configuration missing",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    const providedSignature = String(signature);
    let signatureValid = false;
    if (providedSignature.length === expectedSignature.length) {
      signatureValid = crypto.timingSafeEqual(
        Buffer.from(providedSignature),
        Buffer.from(expectedSignature)
      );
    }

    if (!signatureValid) {
      logger.warn(`[${requestId}] Razorpay signature mismatch`, { orderId, paymentId });
      return res.json({ success: true, verified: false });
    }

    const authHeader = getRazorpayAuthHeader(requestId);
    const paymentRes = await fetch(`${RAZORPAY_BASE_URL}/v1/payments/${paymentId}`, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!paymentRes.ok) {
      const errorText = await paymentRes.text();
      logger.error(`[${requestId}] Razorpay payment lookup failed`, {
        status: paymentRes.status,
        error: errorText,
      });
      return res.json({ success: true, verified: false });
    }

    const paymentData = await paymentRes.json();
    const status = String(paymentData?.status || "").toLowerCase();
    const currency = String(paymentData?.currency || "").toUpperCase();
    const amount = Number(paymentData?.amount);
    const matchesOrder = paymentData?.order_id === orderId;

    const resolved = resolveOrderAmount({ venue, currency: "USD" });
    const expectedAmount = resolved?.majorAmount ? toMinorUnits(resolved.majorAmount) : null;

    const verified =
      status === "captured" &&
      currency === "USD" &&
      matchesOrder &&
      (expectedAmount == null || expectedAmount === amount);

    logger.log(`[${requestId}] Razorpay verification result`, {
      orderId,
      paymentId,
      status,
      currency,
      amount,
      verified,
    });

    return res.json({
      success: true,
      verified,
      verificationToken: verified
        ? Buffer.from(`${paymentId}:${Date.now()}`).toString("base64")
        : null,
    });
  } catch (error) {
    logger.error(`[${requestId}] Razorpay verification failed`, error);
    return res.status(500).json({
      success: false,
      error: "Razorpay verification failed",
    });
  }
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

      // Generate Ghibli-style illustration using OpenAI
      const imageBase64 = await generateBabyIllustration(photo.buffer, requestId, {
        mimeType: photo.mimetype,
      });

      res.json({
        success: true,
        characterImage: `data:image/png;base64,${imageBase64}`,
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
      const { parentsName, date, time, venue } = req.body;
      const characterImage = req.file;

      if (!parentsName || !date || !venue) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: parentsName, date, venue",
        });
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-compose-"));
      const characterPath = path.join(tempDir, "character.png");
      const outputPath = path.join(tempDir, "output.mp4");

      const backgroundVideoPath = path.join(__dirname, "../frontend/public/assets/background.mp4");
      const fontsDir = path.join(__dirname, "../frontend/public/fonts");
      const brightwall = path.join(fontsDir, "Brightwall.ttf");
      const openSauce = path.join(fontsDir, "Opensauce.ttf");
      const roxborough = path.join(fontsDir, "Roxborough CF.ttf");
      const fontSources = {
        "Brightwall.ttf": brightwall,
        "Opensauce.ttf": openSauce,
        "Roxborough CF.ttf": roxborough,
      };

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
        for (const fontPath of Object.values(fontSources)) {
          await fs.access(fontPath);
        }
      } catch (err) {
        logger.error(`[${requestId}] Required assets NOT FOUND`, err);
        return res.status(500).json({
          success: false,
          error: `Required assets not found. Please check fonts`,
        });
      }

      if (characterImage) {
        await fs.writeFile(characterPath, characterImage.buffer);
      }

      // Video dimensions (1080x1920 portrait)
      const { width, height } = VIDEO_CONFIG.canvas;

      const elements = VIDEO_CONFIG.elements || {};
      const timingPresets = VIDEO_CONFIG.timings || {};
      const babyImageConfig = elements.babyImage || {};
      const babyImagePosition = babyImageConfig.position || {};

      // Helpers for element config lookup (reused for image + text)
      const getElement = (key) => elements?.[key] || {};
      const getTiming = (key) => {
        const element = getElement(key);
        const directTiming = element.timing;
        if (directTiming) return directTiming;
        const ref = element.timingRef;
        return ref ? timingPresets[ref] || {} : {};
      };

      // Character positioning (configured in VIDEO_CONFIG)
      const charMaxWidth = Math.round(babyImagePosition.width || 0);
      const charMaxHeight = Math.round(babyImagePosition.height || 0);
      const charCenterX = Math.round(babyImagePosition.x || 0);
      const charCenterY = Math.round(babyImagePosition.y || 0);
      const minTopPadding = 150;

      // Baby image timing (from VIDEO_CONFIG where available)
      const babyTiming = getTiming("babyImage") || {};
      const BABY_FADE_START = babyTiming.fadeInStart ?? 15;
      const BABY_FADE_DURATION = babyTiming.fadeInDuration ?? 1;
      const BABY_FADE_OUT_START = babyTiming.fadeOutStart ?? 28;
      const BABY_FADE_OUT_DURATION = babyTiming.fadeOutDuration ?? 2;

      const parseDateParts = (dateText) => {
        if (!dateText || typeof dateText !== "string") {
          return null;
        }

        const trimmed = dateText.trim();
        const monthNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ];
        const weekdayNames = [
          "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
        ];

        const match = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        let dateObj = null;
        let useUTC = false;

        if (match) {
          const day = Number.parseInt(match[1], 10);
          const monthIndex = monthNames.findIndex(
            (month) => month.toLowerCase() === match[2].toLowerCase()
          );
          const year = Number.parseInt(match[3], 10);

          if (!Number.isNaN(day) && !Number.isNaN(year) && monthIndex >= 0) {
            dateObj = new Date(Date.UTC(year, monthIndex, day));
            useUTC = true;
          }
        }

        if (!dateObj || Number.isNaN(dateObj.getTime())) {
          const fallback = new Date(trimmed);
          if (!Number.isNaN(fallback.getTime())) {
            dateObj = fallback;
            useUTC = false;
          }
        }

        if (!dateObj || Number.isNaN(dateObj.getTime())) {
          return null;
        }

        return {
          dayName: weekdayNames[useUTC ? dateObj.getUTCDay() : dateObj.getDay()],
          dateNumber: String(useUTC ? dateObj.getUTCDate() : dateObj.getDate()),
          month: monthNames[useUTC ? dateObj.getUTCMonth() : dateObj.getMonth()],
          year: String(useUTC ? dateObj.getUTCFullYear() : dateObj.getFullYear()),
        };
      };

      const toFFmpegColor = (hex) => `0x${hex.replace("#", "")}`;
      const alignX = (position, alignment) => {
        if (alignment === "center") return `${position.x}-(text_w/2)`;
        if (alignment === "right") return `${position.x}-(text_w)`;
        return `${position.x}`;
      };
      const alignY = (position) => `${position.y}-(text_h/2)`;

      // Escape special characters for FFmpeg drawtext (filtergraph parser)
      const escapeText = (text = "") => text
        .replace(/\\/g, "\\\\") // escape backslashes first
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");

      // Escape font file paths for FFmpeg drawtext (use forward slashes, escape filter separators)
      const escapeFontPath = (fontPath) => fontPath
        .replace(/\\/g, "/")
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:");

      const getVenueFontSize = (baseFontSize, rawVenue) => {
        const maxVenueLength = 28;
        const venueLength = (rawVenue || "").trim().length;
        if (!venueLength || venueLength <= maxVenueLength) {
          return baseFontSize;
        }
        return baseFontSize * (maxVenueLength / venueLength);
      };

      // Build text for baby shower
      const parentsNameText = escapeText(parentsName);
      const dateParts = parseDateParts(date);
      const dayNameText = escapeText((dateParts?.dayName || "").toUpperCase());
      const dateNumberText = escapeText(dateParts?.dateNumber || "");
      const monthText = escapeText((dateParts?.month || "").toUpperCase());
      const yearText = escapeText(dateParts?.year || "");
      const timeText = time ? escapeText(time.toUpperCase()) : "";
      const venueText = escapeText(venue);

      // Layers: scaled video → baby image overlay → text overlays
      let filterComplex = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];`;

      let inputIndex = 1;
      if (characterImage) {
        // Scale baby image, fade in/out based on VIDEO_CONFIG
        const babyFadeOutFilter = BABY_FADE_OUT_DURATION > 0
          ? `,fade=out:st=${BABY_FADE_OUT_START}:d=${BABY_FADE_OUT_DURATION}:alpha=1`
          : "";
        filterComplex += `[${inputIndex}:v]scale=${charMaxWidth}:${charMaxHeight}:force_original_aspect_ratio=decrease,format=rgba,fade=in:st=${BABY_FADE_START}:d=${BABY_FADE_DURATION}:alpha=1${babyFadeOutFilter}[char];`;
        // Escape comma in max() so FFmpeg doesn't treat it as a filter separator
        filterComplex += `[bg][char]overlay=${charCenterX}-(w/2):max(${minTopPadding}\\,${charCenterY}-(h/2))[vid];`;
        inputIndex++;
      } else {
        filterComplex += `[bg]copy[vid];`;
      }

      // Baby shower text layout (positions/styles/timing are in VIDEO_CONFIG)
      const getPosition = (key) => getElement(key).position || {};
      const getStyle = (key) => getElement(key).style || {};
      const getAlign = (key) => getElement(key).align || "center";

      const buildFadeInOnlyAlpha = (start, duration) => {
        if (!duration || duration <= 0) {
          return `if(lt(t,${start}),0,1)`;
        }
        return `if(lt(t,${start}),0,if(lt(t,${start + duration}),((t-${start})/${duration}),1))`;
      };

      const buildFadeAlpha = (timing = {}) => {
        const start = timing.fadeInStart ?? 0;
        const duration = timing.fadeInDuration ?? 0;
        const outStart = timing.fadeOutStart;
        const outDuration = timing.fadeOutDuration ?? 0;
        const fadeInExpr = buildFadeInOnlyAlpha(start, duration);
        if (outStart == null || !outDuration || outDuration <= 0) {
          return fadeInExpr;
        }
        return `if(lt(t,${start}),0,if(lt(t,${start + duration}),((t-${start})/${duration}),if(lt(t,${outStart}),1,if(lt(t,${outStart + outDuration}),1-((t-${outStart})/${outDuration}),0))))`;
      };

      // Escape font paths for FFmpeg drawtext filter
      const brightwallEsc = escapeFontPath(brightwall);
      const openSauceEsc = escapeFontPath(openSauce);
      const roxboroughEsc = escapeFontPath(roxborough);

      const fontMap = {
        "Brightwall.ttf": brightwallEsc,
        "Opensauce.ttf": openSauceEsc,
        "Roxborough CF.ttf": roxboroughEsc,
      };
      const resolveFont = (fontFamily) => fontMap[fontFamily] || openSauceEsc;

      const parentsStyle = getStyle("parentsName");
      const parentsFont = resolveFont(parentsStyle.fontFamily);
      const parentsPosition = getPosition("parentsName");
      const parentsAlpha = buildFadeAlpha(getTiming("parentsName"));

      // Parents name
      filterComplex += `[vid]drawtext=fontfile='${parentsFont}':text='${parentsNameText}':fontsize=${parentsStyle.fontSize}:fontcolor=${toFFmpegColor(parentsStyle.color)}:x=${alignX(parentsPosition, getAlign("parentsName"))}:y=${alignY(parentsPosition)}:alpha='${parentsAlpha}'[v1];`;

      let currentLayer = "v1";

      if (monthText) {
        const monthStyle = getStyle("month");
        const monthPosition = getPosition("month");
        const monthAlpha = buildFadeAlpha(getTiming("month"));
        filterComplex += `[${currentLayer}]drawtext=fontfile='${resolveFont(monthStyle.fontFamily)}':text='${monthText}':fontsize=${monthStyle.fontSize}:fontcolor=${toFFmpegColor(monthStyle.color)}:x=${alignX(monthPosition, getAlign("month"))}:y=${alignY(monthPosition)}:alpha='${monthAlpha}'[v2];`;
        currentLayer = "v2";
      }

      if (dayNameText) {
        const dayStyle = getStyle("dayName");
        const dayPosition = getPosition("dayName");
        const dayAlpha = buildFadeAlpha(getTiming("dayName"));
        filterComplex += `[${currentLayer}]drawtext=fontfile='${resolveFont(dayStyle.fontFamily)}':text='${dayNameText}':fontsize=${dayStyle.fontSize}:fontcolor=${toFFmpegColor(dayStyle.color)}:x=${alignX(dayPosition, getAlign("dayName"))}:y=${alignY(dayPosition)}:alpha='${dayAlpha}'[v3];`;
        currentLayer = "v3";
      }

      if (timeText) {
        const timeStyle = getStyle("time");
        const timePosition = getPosition("time");
        const timeAlpha = buildFadeAlpha(getTiming("time"));
        filterComplex += `[${currentLayer}]drawtext=fontfile='${resolveFont(timeStyle.fontFamily)}':text='${timeText}':fontsize=${timeStyle.fontSize}:fontcolor=${toFFmpegColor(timeStyle.color)}:x=${alignX(timePosition, getAlign("time"))}:y=${alignY(timePosition)}:alpha='${timeAlpha}'[v4];`;
        currentLayer = "v4";
      }

      if (dateNumberText) {
        const dateStyle = getStyle("dateNumber");
        const datePosition = getPosition("dateNumber");
        const dateAlpha = buildFadeAlpha(getTiming("dateNumber"));
        filterComplex += `[${currentLayer}]drawtext=fontfile='${resolveFont(dateStyle.fontFamily)}':text='${dateNumberText}':fontsize=${dateStyle.fontSize}:fontcolor=${toFFmpegColor(dateStyle.color)}:x=${alignX(datePosition, getAlign("dateNumber"))}:y=${alignY(datePosition)}:alpha='${dateAlpha}'[v5];`;
        currentLayer = "v5";
      }

      if (yearText) {
        const yearStyle = getStyle("year");
        const yearPosition = getPosition("year");
        const yearAlpha = buildFadeAlpha(getTiming("year"));
        filterComplex += `[${currentLayer}]drawtext=fontfile='${resolveFont(yearStyle.fontFamily)}':text='${yearText}':fontsize=${yearStyle.fontSize}:fontcolor=${toFFmpegColor(yearStyle.color)}:x=${alignX(yearPosition, getAlign("year"))}:y=${alignY(yearPosition)}:alpha='${yearAlpha}'[v6];`;
        currentLayer = "v6";
      }

      const venueStyle = getStyle("venue");
      const venuePosition = getPosition("venue");
      const venueAlpha = buildFadeAlpha(getTiming("venue"));
      const venueFontSize = getVenueFontSize(venueStyle.fontSize, venue);
      filterComplex += `[${currentLayer}]drawtext=fontfile='${resolveFont(venueStyle.fontFamily)}':text='${venueText}':fontsize=${venueFontSize}:fontcolor=${toFFmpegColor(venueStyle.color)}:x=${alignX(venuePosition, getAlign("venue"))}:y=${alignY(venuePosition)}:alpha='${venueAlpha}'[vout]`;

      // Build FFmpeg command
      // Use explicit -t on looped image input to avoid infinite stream + malformed moov atom
      let inputs = `-i "${backgroundVideoPath}"`;
      if (characterImage) {
        inputs += ` -loop 1 -t 30 -i "${characterPath}"`;
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
  console.log(`[Server] Image Generation Provider: ${process.env.IMAGE_GENERATION_PROVIDER || "NOT SET"}`);

  // Check critical assets
  const assetPaths = {
    backgroundVideo: path.join(__dirname, "../frontend/public/assets/background.mp4"),
    brightwall: path.join(__dirname, "../frontend/public/fonts/Brightwall.ttf"),
    openSauce: path.join(__dirname, "../frontend/public/fonts/Opensauce.ttf"),
    roxborough: path.join(__dirname, "../frontend/public/fonts/Roxborough CF.ttf"),
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
