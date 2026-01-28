/**
 * Video Composer - Compose character and text overlays on video background
 * 
 * Takes a 30-second background video and overlays:
 * - Character image at fixed position (same as static composer)
 * - Names, date, venue text with premium typography
 * 
 * Uses MediaRecorder API to record, then FFmpeg.wasm to convert to MP4
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { createDevLogger } from "./devLogger";

const logger = createDevLogger("VideoComposer");

// API URL - uses environment variable in production, empty string (relative) in dev
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

// FFmpeg instance (lazy loaded)
let ffmpeg = null;
let ffmpegLoaded = false;

/**
 * Check if running on Chrome iOS (CriOS).
 * Chrome iOS uses WebKit but has broken MediaRecorder/canvas.captureStream()
 * that causes video composition to hang or lag severely.
 */
export function isChromeIOS() {
  const ua = navigator.userAgent;
  return /CriOS/.test(ua);
}

/**
 * Check if client-side video composition is supported.
 * Requires SharedArrayBuffer for FFmpeg.wasm and working MediaRecorder.
 *
 * Chrome iOS is explicitly excluded because:
 * - MediaRecorder + canvas.captureStream() is broken/laggy
 * - Video composition hangs during the recording phase
 */
export function isFFmpegSupported() {
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const chromeIOS = isChromeIOS();
  const supported = hasSharedArrayBuffer && !chromeIOS;

  logger.log("FFmpeg support check", {
    sharedArrayBufferAvailable: hasSharedArrayBuffer,
    isChromeIOS: chromeIOS,
    clientCompositionSupported: supported,
    userAgent: navigator.userAgent.slice(0, 100)
  });
  return supported;
}

/**
 * Load FFmpeg.wasm (only loads once)
 */
async function loadFFmpeg(onProgress) {
  if (ffmpegLoaded && ffmpeg) {
    logger.log("FFmpeg already loaded, reusing instance");
    return ffmpeg;
  }

  logger.log("Initializing FFmpeg.wasm");
  const loadStartTime = performance.now();

  ffmpeg = new FFmpeg();
  
  ffmpeg.on("log", ({ message }) => {
    logger.log("FFmpeg log", { message });
  });

  ffmpeg.on("progress", ({ progress, time }) => {
    logger.log("FFmpeg progress", { 
      progress: `${(progress * 100).toFixed(1)}%`,
      time: time ? `${(time / 1000000).toFixed(2)}s` : 'N/A'
    });
    if (onProgress) {
      // Progress is 0-1, we want to report 90-100 during conversion
      const percent = 90 + Math.round(progress * 10);
      onProgress(Math.min(percent, 99));
    }
  });

  // Load FFmpeg with UMD build (more compatible, simpler loading)
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  
  logger.log("Fetching FFmpeg core files", { baseURL });
  
  try {
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    ]);

    logger.log("FFmpeg core files fetched, loading WASM");

    // Add timeout to detect if load hangs
    const loadPromise = ffmpeg.load({ coreURL, wasmURL });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('FFmpeg load timeout after 30s - likely missing SharedArrayBuffer/COOP/COEP headers'));
      }, 30000);
    });
    
    await Promise.race([loadPromise, timeoutPromise]);

    ffmpegLoaded = true;
    const loadTime = performance.now() - loadStartTime;
    logger.log("FFmpeg loaded successfully", { loadTime: `${loadTime.toFixed(0)}ms` });
    return ffmpeg;
  } catch (error) {
    logger.error("FFmpeg load failed", error);
    throw error;
  }
}

/**
 * Preload FFmpeg.wasm in the background.
 * Call this early (e.g., when user enters the input form) to reduce latency
 * when video generation starts.
 *
 * Note: Only preloads if FFmpeg is supported (SharedArrayBuffer available).
 */
export async function preloadFFmpeg() {
  // Don't try to preload if FFmpeg is not supported
  if (!isFFmpegSupported()) {
    logger.log("FFmpeg preload skipped - SharedArrayBuffer not available (will use server fallback)");
    return;
  }

  if (ffmpegLoaded && ffmpeg) {
    logger.log("FFmpeg already loaded, skipping preload");
    return;
  }

  logger.log("Preloading FFmpeg.wasm in background...");
  try {
    await loadFFmpeg();
    logger.log("FFmpeg preload complete");
  } catch (error) {
    // Silently fail - will retry when actually needed
    logger.warn("FFmpeg preload failed (will retry on use)", error.message);
  }
}

/**
 * Compress character image to reduce upload time
 */
async function compressCharacterImage(dataURL, maxWidth = 1080) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.85);
    };
    img.src = dataURL;
  });
}

/**
 * Compose video entirely on the server.
 * Used for Chrome iOS where client-side MediaRecorder/canvas.captureStream() is broken.
 *
 * Progress distribution:
 * - 0-30%: Uploading assets to server
 * - 30-90%: Server-side video composition
 * - 90-100%: Downloading MP4
 */
async function serverComposeVideo({ characterImage, brideName, groomName, date, venue, onProgress }) {
  const startTime = performance.now();
  logger.log("Starting server-side video composition", {
    characterImageLength: characterImage?.length,
    brideName,
    groomName,
    date,
    venue,
  });

  const formData = new FormData();

  // Convert base64 character image to blob (compressed to reduce upload time)
  if (characterImage) {
    const characterBlob = await compressCharacterImage(characterImage);
    formData.append("characterImage", characterBlob, "character.png");
  }

  formData.append("brideName", brideName);
  formData.append("groomName", groomName);
  formData.append("date", date);
  formData.append("venue", venue);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress (0-30%)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const uploadProgress = Math.round((e.loaded / e.total) * 30);
        logger.log("Server compose upload progress", { progress: `${uploadProgress}%` });
        onProgress(uploadProgress);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        // Defensive check: ensure response is video/mp4 before processing
        const contentType = xhr.getResponseHeader("Content-Type");
        if (!contentType || !contentType.includes("video/mp4")) {
          logger.error("Server compose returned non-video response", { contentType });
          reject(new Error("Server returned non-video response. Check API URL configuration."));
          return;
        }
        const totalTime = performance.now() - startTime;
        const mp4Blob = xhr.response;
        logger.log("Server-side video composition complete", {
          totalTime: `${totalTime.toFixed(0)}ms`,
          outputSize: `${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`,
        });
        onProgress(100);
        resolve(mp4Blob);
      } else {
        logger.error("Server compose failed", {
          status: xhr.status,
          statusText: xhr.statusText,
        });
        try {
          const text = xhr.responseText;
          const errorData = JSON.parse(text);
          reject(new Error(errorData.error || "Server composition failed"));
        } catch (parseError) {
          const rawResponse = xhr.responseText || "(empty response)";
          const contentType = xhr.getResponseHeader("Content-Type") || "(not set)";
          const contentLength = xhr.getResponseHeader("Content-Length") || "(not set)";
          logger.error("Server compose response unparseable", {
            status: xhr.status,
            statusText: xhr.statusText,
            contentType: contentType,
            contentLength: contentLength,
            responseLength: rawResponse.length,
            firstChars: rawResponse.slice(0, 300),
            parseError: parseError.message,
          });
          reject(new Error("Server composition failed: unexpected response"));
        }
      }
    };

    xhr.onerror = () => {
      const totalTime = performance.now() - startTime;
      logger.error("Server compose network error", { totalTime: `${totalTime.toFixed(0)}ms` });
      reject(new Error("Network error during video composition"));
    };

    xhr.ontimeout = () => {
      logger.error("Server compose timeout");
      reject(new Error("Video composition timed out"));
    };

    // Simulate progress during server processing
    let serverProgress = 30;
    const progressInterval = setInterval(() => {
      if (serverProgress < 85) {
        serverProgress += 2;
        onProgress(serverProgress);
      }
    }, 1000);

    xhr.onloadend = () => {
      clearInterval(progressInterval);
    };

    xhr.open("POST", `${API_URL}/api/compose-video`);
    xhr.responseType = "blob";
    xhr.timeout = 300000; // 5 minute timeout for full composition
    xhr.send(formData);
  });
}

/**
 * Convert WebM blob to MP4 using server-side FFmpeg.
 * Used as fallback when client-side FFmpeg.wasm is not supported (iOS/mobile).
 *
 * Progress distribution for server conversion:
 * - 70-85%: Uploading WebM to server
 * - 85-95%: Server conversion (indeterminate, we just set milestones)
 * - 95-100%: Downloading MP4
 */
async function serverConvertWebMToMP4(webmBlob, onProgress) {
  const startTime = performance.now();
  logger.log("Starting server-side WebM to MP4 conversion", {
    inputSize: `${(webmBlob.size / 1024 / 1024).toFixed(2)} MB`,
    inputType: webmBlob.type,
  });

  const formData = new FormData();
  formData.append("video", webmBlob, "input.webm");

  // Use XMLHttpRequest for upload progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress (70-85%)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const uploadProgress = 70 + (e.loaded / e.total) * 15;
        logger.log("Server upload progress", {
          uploaded: `${(e.loaded / 1024 / 1024).toFixed(2)} MB`,
          total: `${(e.total / 1024 / 1024).toFixed(2)} MB`,
          progress: `${uploadProgress.toFixed(1)}%`,
        });
        if (onProgress) {
          onProgress(Math.round(uploadProgress));
        }
      }
    };

    xhr.upload.onloadend = () => {
      logger.log("Upload complete, waiting for server conversion");
      // Server is now converting - set progress to 85%
      if (onProgress) {
        onProgress(85);
      }
    };

    xhr.onload = async () => {
      const totalTime = performance.now() - startTime;

      if (xhr.status === 200) {
        // Check content type
        const contentType = xhr.getResponseHeader("Content-Type");
        if (contentType && contentType.includes("video/mp4")) {
          // Success - we got an MP4 back
          const mp4Blob = xhr.response;
          logger.log("Server conversion complete", {
            outputSize: `${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`,
            compressionRatio: `${((1 - mp4Blob.size / webmBlob.size) * 100).toFixed(1)}%`,
            totalTime: `${totalTime.toFixed(0)}ms`,
          });

          if (onProgress) {
            onProgress(95);
          }

          resolve(mp4Blob);
        } else {
          // Got a non-video response (probably an error JSON)
          try {
            const text = await new Blob([xhr.response]).text();
            const errorData = JSON.parse(text);
            reject(new Error(errorData.error || "Server conversion failed"));
          } catch {
            reject(new Error("Server conversion failed: unexpected response"));
          }
        }
      } else {
        // HTTP error
        logger.error("Server conversion failed", {
          status: xhr.status,
          statusText: xhr.statusText,
        });
        reject(new Error(`Server conversion failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      const totalTime = performance.now() - startTime;
      logger.error("Server conversion network error", {
        totalTime: `${totalTime.toFixed(0)}ms`,
      });
      reject(new Error("Network error during video conversion"));
    };

    xhr.ontimeout = () => {
      logger.error("Server conversion timeout");
      reject(new Error("Video conversion timed out"));
    };

    // Open connection and send
    xhr.open("POST", `${API_URL}/api/convert-video`);
    xhr.responseType = "blob";
    xhr.timeout = 180000; // 3 minute timeout for large videos
    xhr.send(formData);
  });
}

/**
 * Convert WebM blob to MP4 using client-side FFmpeg.wasm
 */
async function clientConvertWebMToMP4(webmBlob, onProgress) {
  const conversionStartTime = performance.now();
  logger.log("Starting client-side WebM to MP4 conversion", {
    inputSize: `${(webmBlob.size / 1024 / 1024).toFixed(2)} MB`,
    inputType: webmBlob.type
  });

  const ffmpegInstance = await loadFFmpeg(onProgress);

  // Write input file
  logger.log("Writing input file to FFmpeg virtual filesystem");
  const writeStartTime = performance.now();
  await ffmpegInstance.writeFile("input.webm", await fetchFile(webmBlob));
  logger.log("Input file written", { writeTime: `${(performance.now() - writeStartTime).toFixed(0)}ms` });

  // Convert to MP4 with H.264 codec for maximum compatibility
  // Using -c:v libx264 for video, -c:a aac for audio
  // -movflags +faststart enables progressive download
  // NOTE: Using "ultrafast" preset for speed - CRF 23 still controls quality
  const ffmpegArgs = [
    "-i", "input.webm",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    "-pix_fmt", "yuv420p",
    "output.mp4"
  ];

  logger.log("Executing FFmpeg conversion", {
    command: `ffmpeg ${ffmpegArgs.join(" ")}`,
    codec: "H.264 (libx264)",
    preset: "ultrafast",
    crf: 23,
    audioCodec: "AAC",
    audioBitrate: "96k"
  });

  const execStartTime = performance.now();
  try {
    await ffmpegInstance.exec(ffmpegArgs);
    logger.log("FFmpeg execution complete", { execTime: `${(performance.now() - execStartTime).toFixed(0)}ms` });
  } catch (error) {
    logger.error("FFmpeg execution failed", error);
    throw error;
  }

  // Read output file
  logger.log("Reading output file from FFmpeg virtual filesystem");
  const mp4FileData = await ffmpegInstance.readFile("output.mp4");
  logger.log("Output file read", { outputBytes: mp4FileData.byteLength });

  // Cleanup
  logger.log("Cleaning up FFmpeg virtual filesystem");
  await ffmpegInstance.deleteFile("input.webm");
  await ffmpegInstance.deleteFile("output.mp4");

  const mp4Blob = new Blob([mp4FileData.buffer], { type: "video/mp4" });
  const totalConversionTime = performance.now() - conversionStartTime;
  const compressionRatio = ((1 - mp4Blob.size / webmBlob.size) * 100).toFixed(1);

  logger.log("Client-side MP4 conversion complete", {
    outputSize: `${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`,
    compressionRatio: `${compressionRatio}%`,
    totalTime: `${totalConversionTime.toFixed(0)}ms`
  });

  return mp4Blob;
}

/**
 * Convert WebM blob to MP4.
 * Uses client-side FFmpeg.wasm if supported, otherwise falls back to server-side conversion.
 */
async function convertWebMToMP4(webmBlob, onProgress, useServerFallback = false) {
  // Check if we should use server-side conversion
  if (useServerFallback || !isFFmpegSupported()) {
    logger.log("Using server-side conversion", {
      reason: useServerFallback ? "explicit fallback" : "SharedArrayBuffer not available"
    });
    return serverConvertWebMToMP4(webmBlob, onProgress);
  }

  // Try client-side first
  try {
    return await clientConvertWebMToMP4(webmBlob, onProgress);
  } catch (error) {
    logger.warn("Client-side FFmpeg failed, falling back to server", error.message);
    // Fallback to server if client fails
    return serverConvertWebMToMP4(webmBlob, onProgress);
  }
}

// Canvas dimensions for the invite (9:16 aspect ratio)
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

// Layout specification (same as canvasComposer.js)
const LAYOUT_V4 = {
  canvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  },

  character: {
    heightPercent: 0.60,
    marginXPercent: 0.08,
    topPercent: 0.22,
    bottomPercent: 0.82,
    sizeMultiplier: 2.0,
  },

  shadow: {
    yPercent: 0.82,
    widthPercent: 0.45,
    heightPercent: 0.025,
    blur: 30,
    opacity: 0.12,
    color: "rgba(30, 20, 15, 0.12)",
  },

  names: {
    yPercent: 0.1,
    fontRatio: 2.405,
    maxWidthPercent: 0.88,
    letterSpacing: 0.02,
    fontFamily: "AlexBrush, 'Alex Brush', 'Great Vibes', cursive",
    fontWeight: "400",
  },

  ampersand: {
    scale: 0.35,
    yOffset: 0,
  },

  date: {
    yPercent: 0.875,
    fontRatio: 0.9,
    letterSpacing: 0.02,
    fontFamily: "PlayfairDisplay, 'Playfair Display', Georgia, serif",
    fontWeight: "500",
    color: "#8B7355",
  },

  venue: {
    yPercent: 0.915,
    fontRatio: 0.9,
    letterSpacing: 0.02,
    fontFamily: "PlayfairDisplay, 'Playfair Display', Georgia, serif",
    fontWeight: "500",
    color: "#8B7355",
  },

  baseFontSize: 54,
};

// Color palette (same as canvasComposer.js)
const COLORS = {
  goldPrimary: "#D4A853",
  goldHighlight: "#F8E8B0",
  goldDeep: "#A67C3D",
  goldMid: "#E6C066",
  goldRich: "#C9942B",
  goldBright: "#F0D78C",
  copperBrown: "#B87333",
  copperBrownLight: "#CD8544",
  copperBrownDark: "#8B5A2B",
};

// Animation timing for staggered fade-in (in seconds)
// Total animation sequence: 7 seconds
const ANIMATION = {
  names: { start: 2.5, end: 3 },        // 2-3s: Names fade in (1s duration)
  date: { start: 2.5, end: 3 },         // 3-4s: Date fades in (1s duration)
  venue: { start: 2.5, end: 3 },        // 4-5s: Venue fades in (1s duration)
  character: { start: 5, end: 6 }     // 5-7s: Character fades in (2s duration)
};

// Track animation states for logging
const ANIMATION_STATES = {
  names: { logged25: false, logged50: false, logged100: false },
  date: { logged25: false, logged50: false, logged100: false },
  venue: { logged25: false, logged50: false, logged100: false },
  character: { logged25: false, logged50: false, logged100: false },
};

/**
 * Resets all animation state tracking to initial values
 * Called at the start of video composition to ensure clean state
 */
function resetAnimationStates() {
  Object.keys(ANIMATION_STATES).forEach(key => {
    ANIMATION_STATES[key] = { logged25: false, logged50: false, logged100: false };
  });
}

/**
 * Logs animation progress at key opacity milestones (25%, 50%, 100%)
 * Used for debugging and monitoring fade-in animations during video composition
 * @param {string} elementName - Name of the animated element (names, date, venue, character)
 * @param {number} opacity - Current opacity value (0-1)
 */
function logAnimationProgress(elementName, opacity) {
  const state = ANIMATION_STATES[elementName];
  if (!state) return;
  
  if (opacity >= 0.25 && !state.logged25) {
    state.logged25 = true;
    logger.log(`Animation: ${elementName} reached 25% opacity`);
  }
  if (opacity >= 0.50 && !state.logged50) {
    state.logged50 = true;
    logger.log(`Animation: ${elementName} reached 50% opacity`);
  }
  if (opacity >= 1.0 && !state.logged100) {
    state.logged100 = true;
    logger.log(`Animation: ${elementName} fully visible (100% opacity)`);
  }
}

// --- Utility Functions ---

function loadImage(src) {
  const startTime = performance.now();
  const isDataUrl = src.startsWith("data:");
  logger.log("Loading image", { 
    source: isDataUrl ? `data URL (${(src.length / 1024).toFixed(1)}KB)` : src 
  });
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      logger.log("Image loaded", { 
        width: img.width, 
        height: img.height,
        loadTime: `${(performance.now() - startTime).toFixed(0)}ms`
      });
      resolve(img);
    };
    img.onerror = (e) => {
      logger.error("Image load failed", e);
      reject(e);
    };
    img.src = src;
  });
}

function loadVideo(src) {
  const startTime = performance.now();
  logger.log("Loading video", { source: src });
  
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.preload = "auto";
    
    video.onloadeddata = () => {
      logger.log("Video loaded", { 
        width: video.videoWidth, 
        height: video.videoHeight,
        duration: `${video.duration.toFixed(2)}s`,
        loadTime: `${(performance.now() - startTime).toFixed(0)}ms`
      });
      resolve(video);
    };
    video.onerror = (e) => {
      const error = new Error(`Failed to load video: ${e.message || 'Unknown error'}`);
      logger.error("Video load failed", error);
      reject(error);
    };
    video.src = src;
    video.load();
  });
}

async function loadFonts() {
  const startTime = performance.now();
  logger.log("Loading fonts", {
    fonts: ["AlexBrush", "PlayfairDisplay", "Inter", "InterMedium"]
  });
  
  const alexBrush = new FontFace("AlexBrush", "url(/fonts/AlexBrush-Regular.ttf)");
  const playfair = new FontFace("PlayfairDisplay", "url(/fonts/PlayfairDisplay-Regular.ttf)");
  const inter = new FontFace("Inter", "url(/fonts/Inter-Regular.ttf)");
  const interMedium = new FontFace("InterMedium", "url(/fonts/Inter-Medium.ttf)");

  try {
    const loadedFonts = await Promise.all([
      alexBrush.load(),
      playfair.load(),
      inter.load(),
      interMedium.load(),
    ]);
    
    loadedFonts.forEach(font => {
      if (font) document.fonts.add(font);
    });
    
    logger.log("Fonts loaded successfully", { 
      loadTime: `${(performance.now() - startTime).toFixed(0)}ms`,
      fontsLoaded: loadedFonts.length
    });
  } catch (err) {
    logger.warn("Font loading failed, using fallbacks", err.message);
  }
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Calculate opacity for fade-in animation based on current time
 * @param {number} currentTime - Current video time in seconds
 * @param {number} startTime - When fade starts (opacity 0)
 * @param {number} endTime - When fade ends (opacity 1)
 * @returns {number} - Opacity value between 0 and 1
 */
function calculateOpacity(currentTime, startTime, endTime) {
  if (currentTime < startTime) return 0;
  if (currentTime >= endTime) return 1;
  return (currentTime - startTime) / (endTime - startTime);
}

// --- Character Placement ---
function calculateCharacterBounds(characterImg) {
  const targetTop = CANVAS_HEIGHT * LAYOUT_V4.character.topPercent;
  const targetBottom = CANVAS_HEIGHT * LAYOUT_V4.character.bottomPercent;
  const targetHeight = targetBottom - targetTop;

  const marginX = CANVAS_WIDTH * LAYOUT_V4.character.marginXPercent;
  const maxWidth = CANVAS_WIDTH - (marginX * 2);

  const charAspect = characterImg.width / characterImg.height;

  let charWidth, charHeight;

  charHeight = targetHeight;
  charWidth = charHeight * charAspect;

  if (charWidth > maxWidth) {
    charWidth = maxWidth;
    charHeight = charWidth / charAspect;
  }

  const multiplier = LAYOUT_V4.character.sizeMultiplier || 1.0;
  charWidth *= multiplier;
  charHeight *= multiplier;

  const charX = (CANVAS_WIDTH - charWidth) / 2;
  const charY = targetBottom - charHeight;

  return {
    x: charX,
    y: charY,
    width: charWidth,
    height: charHeight,
    feetY: targetBottom,
  };
}

// --- Drawing Functions ---
function drawGroundShadow(ctx, characterBounds) {
  const shadow = LAYOUT_V4.shadow;

  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT * shadow.yPercent;
  const radiusX = (CANVAS_WIDTH * shadow.widthPercent) / 2;
  const radiusY = (CANVAS_HEIGHT * shadow.heightPercent) / 2;

  const gradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, Math.max(radiusX, radiusY)
  );

  gradient.addColorStop(0, `rgba(30, 20, 15, ${shadow.opacity})`);
  gradient.addColorStop(0.6, `rgba(30, 20, 15, ${shadow.opacity * 0.4})`);
  gradient.addColorStop(1, "rgba(30, 20, 15, 0)");

  ctx.save();
  ctx.filter = `blur(${shadow.blur}px)`;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function createPremiumGoldGradient(ctx, x, y, width, height) {
  const gradient = ctx.createLinearGradient(
    x - width / 2,
    y - height * 0.3,
    x + width / 2,
    y + height * 0.3
  );
  
  gradient.addColorStop(0, COLORS.goldRich);
  gradient.addColorStop(0.15, COLORS.goldPrimary);
  gradient.addColorStop(0.35, COLORS.goldMid);
  gradient.addColorStop(0.5, COLORS.goldBright);
  gradient.addColorStop(0.65, COLORS.goldMid);
  gradient.addColorStop(0.85, COLORS.goldPrimary);
  gradient.addColorStop(1, COLORS.goldRich);
  
  return gradient;
}

function createCopperBrownGradient(ctx, x, y, width, height) {
  const gradient = ctx.createLinearGradient(
    x - width / 2,
    y - height * 0.3,
    x + width / 2,
    y + height * 0.3
  );
  
  gradient.addColorStop(0, COLORS.copperBrownDark);
  gradient.addColorStop(0.2, COLORS.copperBrown);
  gradient.addColorStop(0.4, COLORS.copperBrownLight);
  gradient.addColorStop(0.6, COLORS.copperBrownLight);
  gradient.addColorStop(0.8, COLORS.copperBrown);
  gradient.addColorStop(1, COLORS.copperBrownDark);
  
  return gradient;
}

function calculateFontSize(ctx, text, maxWidth, idealSize, minSize, fontFamily, letterSpacing = 0) {
  let fontSize = idealSize;

  while (fontSize > minSize) {
    ctx.font = `${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const spacingWidth = (text.length - 1) * (fontSize * letterSpacing);
    const totalWidth = metrics.width + spacingWidth;
    
    if (totalWidth <= maxWidth) {
      return fontSize;
    }
    fontSize -= 2;
  }

  return minSize;
}

function drawTextWithTracking(ctx, text, x, y, letterSpacing) {
  if (letterSpacing <= 0) {
    ctx.fillText(text, x, y);
    return;
  }

  const chars = text.split('');
  const fontSize = parseFloat(ctx.font);
  const spacing = fontSize * letterSpacing;
  
  let totalWidth = 0;
  chars.forEach(char => {
    totalWidth += ctx.measureText(char).width;
  });
  totalWidth += (chars.length - 1) * spacing;
  
  let currentX = x - totalWidth / 2;

  chars.forEach((char) => {
    const charWidth = ctx.measureText(char).width;
    ctx.fillText(char, currentX + charWidth / 2, y);
    currentX += charWidth + spacing;
  });
}

function drawNamesText(ctx, brideName, groomName, opacity = 1) {
  if (opacity <= 0) return;
  
  const layout = LAYOUT_V4.names;
  const y = CANVAS_HEIGHT * layout.yPercent;
  const maxWidth = CANVAS_WIDTH * layout.maxWidthPercent;
  const idealSize = LAYOUT_V4.baseFontSize * layout.fontRatio;
  const minSize = LAYOUT_V4.baseFontSize * 1.2;
  
  const IDEAL_COMBINED_LENGTH = 13;

  const brideNameFormatted = capitalizeFirst(brideName);
  const groomNameFormatted = capitalizeFirst(groomName);
  const ampersand = " & ";
  const fullText = `${brideNameFormatted}${ampersand}${groomNameFormatted}`;

  const combinedNameLength = brideNameFormatted.length + groomNameFormatted.length;
  let adjustedIdealSize = idealSize;
  
  if (combinedNameLength > IDEAL_COMBINED_LENGTH) {
    const scaleFactor = IDEAL_COMBINED_LENGTH / combinedNameLength;
    adjustedIdealSize = idealSize * scaleFactor;
    adjustedIdealSize = Math.max(adjustedIdealSize, minSize);
  }

  const fontSize = calculateFontSize(
    ctx,
    fullText,
    maxWidth,
    adjustedIdealSize,
    minSize,
    layout.fontFamily,
    layout.letterSpacing
  );

  // Save context and apply opacity
  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.font = `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const brideWidth = ctx.measureText(brideNameFormatted).width;
  const ampersandWidth = ctx.measureText(ampersand).width;
  const groomWidth = ctx.measureText(groomNameFormatted).width;
  const totalTextWidth = brideWidth + ampersandWidth + groomWidth;
  
  let currentX = (CANVAS_WIDTH - totalTextWidth) / 2;
  
  // Draw bride's name in warm gold gradient
  const goldGradient = createPremiumGoldGradient(ctx, currentX + brideWidth / 2, y, brideWidth, fontSize * 1.5);
  
  ctx.shadowColor = "rgba(166, 124, 61, 0.35)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  
  ctx.fillStyle = goldGradient;
  ctx.fillText(brideNameFormatted, currentX, y);
  currentX += brideWidth;
  
  // Draw ampersand in copper
  const copperGradient = createCopperBrownGradient(ctx, currentX + ampersandWidth / 2, y, ampersandWidth, fontSize * 1.5);
  
  ctx.shadowColor = "rgba(139, 90, 43, 0.35)";
  ctx.fillStyle = copperGradient;
  ctx.fillText(ampersand, currentX, y);
  currentX += ampersandWidth;
  
  // Draw groom's name in warm gold gradient
  const goldGradient2 = createPremiumGoldGradient(ctx, currentX + groomWidth / 2, y, groomWidth, fontSize * 1.5);
  
  ctx.shadowColor = "rgba(166, 124, 61, 0.35)";
  ctx.fillStyle = goldGradient2;
  ctx.fillText(groomNameFormatted, currentX, y);
  
  // Restore context (resets globalAlpha and shadow)
  ctx.restore();
}

function formatDateDisplay(dateStr) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return dateStr;
  }
}

function drawDateText(ctx, dateStr, opacity = 1) {
  if (opacity <= 0) return;
  
  const layout = LAYOUT_V4.date;
  const y = CANVAS_HEIGHT * layout.yPercent;
  const fontSize = LAYOUT_V4.baseFontSize * layout.fontRatio;

  const formattedDate = formatDateDisplay(dateStr);
  const displayText = `Date: ${formattedDate}`;

  // Save context and apply opacity
  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.font = `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.shadowColor = "rgba(139, 115, 85, 0.2)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  ctx.fillStyle = layout.color;
  
  drawTextWithTracking(ctx, displayText, CANVAS_WIDTH / 2, y, layout.letterSpacing);

  // Restore context (resets globalAlpha and shadow)
  ctx.restore();
}

function drawVenueText(ctx, venue, opacity = 1) {
  if (opacity <= 0) return;
  
  const layout = LAYOUT_V4.venue;
  const y = CANVAS_HEIGHT * layout.yPercent;
  const baseFontSize = LAYOUT_V4.baseFontSize * layout.fontRatio;

  const displayText = `Venue: ${venue}`;
  
  // Scale font size proportionally if text exceeds ideal length (20 chars)
  const IDEAL_VENUE_LENGTH = 20;
  const minFontScale = 0.5; // Don't go smaller than 50% of base size
  let fontSize = baseFontSize;
  
  if (displayText.length > IDEAL_VENUE_LENGTH) {
    const scaleFactor = IDEAL_VENUE_LENGTH / displayText.length;
    fontSize = baseFontSize * Math.max(scaleFactor, minFontScale);
  }

  // Save context and apply opacity
  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.font = `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.shadowColor = "rgba(139, 115, 85, 0.2)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  ctx.fillStyle = layout.color;
  
  drawTextWithTracking(ctx, displayText, CANVAS_WIDTH / 2, y, layout.letterSpacing);

  // Restore context (resets globalAlpha and shadow)
  ctx.restore();
}

// --- Frame Rendering ---

/**
 * Draw a single frame with video background, character, and text overlays
 * Elements fade in based on currentTime using ANIMATION timings
 * 
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} video
 * @param {HTMLImageElement} characterImg
 * @param {Object} characterBounds
 * @param {string} brideName
 * @param {string} groomName
 * @param {string} date
 * @param {string} venue
 * @param {number} currentTime - Current video time in seconds for animation timing
 */
function drawFrame(ctx, video, characterImg, characterBounds, brideName, groomName, date, venue, currentTime) {
  // Clear canvas
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Layer 1: Video background (scaled to fit canvas) - always visible
  const videoAspect = video.videoWidth / video.videoHeight;
  const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
  
  let drawWidth, drawHeight, drawX, drawY;
  
  if (videoAspect > canvasAspect) {
    // Video is wider - fit to height, crop sides
    drawHeight = CANVAS_HEIGHT;
    drawWidth = drawHeight * videoAspect;
    drawX = (CANVAS_WIDTH - drawWidth) / 2;
    drawY = 0;
  } else {
    // Video is taller - fit to width, crop top/bottom
    drawWidth = CANVAS_WIDTH;
    drawHeight = drawWidth / videoAspect;
    drawX = 0;
    drawY = (CANVAS_HEIGHT - drawHeight) / 2;
  }
  
  ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  
  // Calculate opacity for each element based on animation timing
  const namesOpacity = calculateOpacity(currentTime, ANIMATION.names.start, ANIMATION.names.end);
  const dateOpacity = calculateOpacity(currentTime, ANIMATION.date.start, ANIMATION.date.end);
  const venueOpacity = calculateOpacity(currentTime, ANIMATION.venue.start, ANIMATION.venue.end);
  const characterOpacity = calculateOpacity(currentTime, ANIMATION.character.start, ANIMATION.character.end);
  
  // Log animation progress at key milestones
  logAnimationProgress('names', namesOpacity);
  logAnimationProgress('date', dateOpacity);
  logAnimationProgress('venue', venueOpacity);
  logAnimationProgress('character', characterOpacity);
  
  // Layer 2: Ground shadow (fades in with character)
  if (characterOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = characterOpacity;
    drawGroundShadow(ctx, characterBounds);
    ctx.restore();
  }
  
  // Layer 3: Character (fades in last, after 4-5s)
  if (characterOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = characterOpacity;
    ctx.drawImage(
      characterImg,
      characterBounds.x,
      characterBounds.y,
      characterBounds.width,
      characterBounds.height
    );
    ctx.restore();
  }
  
  // Layer 4: Text overlays (fade in sequentially: names -> date -> venue)
  drawNamesText(ctx, brideName, groomName, namesOpacity);
  drawDateText(ctx, date, dateOpacity);
  drawVenueText(ctx, venue, venueOpacity);
}

// --- Main Video Composition ---

/**
 * Compose a video invite with character and text overlays.
 * Uses server-side composition for consistent quality across all devices.
 */
export async function composeVideoInvite({
  characterImage,
  brideName,
  groomName,
  date,
  venue,
  onProgress = () => {}
}) {
  const compositionStartTime = performance.now();

  logger.log("=== VIDEO COMPOSITION STARTED (SERVER-SIDE) ===", {
    brideName,
    groomName,
    date,
    venue,
    characterImageSize: characterImage ? `${(characterImage.length / 1024).toFixed(1)}KB` : 'N/A',
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent.slice(0, 100),
  });

  onProgress(5);

  // Server-side composition for consistent quality across all devices
  try {
    const mp4Blob = await serverComposeVideo({
      characterImage,
      brideName,
      groomName,
      date,
      venue,
      onProgress,
    });

    const totalTime = performance.now() - compositionStartTime;
    logger.log("=== VIDEO COMPOSITION COMPLETE (SERVER) ===", {
      totalTime: `${totalTime.toFixed(0)}ms`,
      totalTimeHuman: `${(totalTime / 1000).toFixed(1)}s`,
      outputSize: `${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`,
    });

    return mp4Blob;
  } catch (error) {
    const failTime = performance.now() - compositionStartTime;
    logger.error("=== VIDEO COMPOSITION FAILED ===", {
      error: error.message,
      failedAfter: `${failTime.toFixed(0)}ms`,
    });
    throw error;
  }
}

/**
 * Convert video blob to data URL for preview
 */
export function videoBlobToDataURL(blob) {
  return URL.createObjectURL(blob);
}
