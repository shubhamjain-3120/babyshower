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

// FFmpeg instance (lazy loaded)
let ffmpeg = null;
let ffmpegLoaded = false;

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
 */
export async function preloadFFmpeg() {
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
 * Convert WebM blob to MP4 using FFmpeg.wasm
 */
async function convertWebMToMP4(webmBlob, onProgress) {
  const conversionStartTime = performance.now();
  logger.log("Starting WebM to MP4 conversion", { 
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
  const data = await ffmpegInstance.readFile("output.mp4");
  logger.log("Output file read", { outputBytes: data.byteLength });
  
  // Cleanup
  logger.log("Cleaning up FFmpeg virtual filesystem");
  await ffmpegInstance.deleteFile("input.webm");
  await ffmpegInstance.deleteFile("output.mp4");
  
  const mp4Blob = new Blob([data.buffer], { type: "video/mp4" });
  const totalConversionTime = performance.now() - conversionStartTime;
  const compressionRatio = ((1 - mp4Blob.size / webmBlob.size) * 100).toFixed(1);
  
  logger.log("MP4 conversion complete", { 
    outputSize: `${(mp4Blob.size / 1024 / 1024).toFixed(2)} MB`,
    compressionRatio: `${compressionRatio}%`,
    totalTime: `${totalConversionTime.toFixed(0)}ms`
  });
  
  return mp4Blob;
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

function resetAnimationStates() {
  Object.keys(ANIMATION_STATES).forEach(key => {
    ANIMATION_STATES[key] = { logged25: false, logged50: false, logged100: false };
  });
}

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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

// ============================================================================
// CHARACTER PLACEMENT
// ============================================================================

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

// ============================================================================
// DRAWING FUNCTIONS
// ============================================================================

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

// ============================================================================
// FRAME RENDERING
// ============================================================================

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

// ============================================================================
// MAIN VIDEO COMPOSITION FUNCTION
// ============================================================================

/**
 * Compose a video invite with character and text overlays
 * 
 * @param {Object} params
 * @param {string} params.characterImage - Data URL of character (with transparent bg)
 * @param {string} params.brideName
 * @param {string} params.groomName
 * @param {string} params.date
 * @param {string} params.venue
 * @param {function} params.onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>} - Video blob (MP4 format)
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
  let stepTimings = {};
  
  // Reset animation state tracking for fresh logging
  resetAnimationStates();
  
  // Get memory info if available (Chrome only)
  const getMemoryInfo = () => {
    if (performance.memory) {
      return {
        usedJSHeap: `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB`,
        totalJSHeap: `${(performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`,
        limit: `${(performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB`,
      };
    }
    return null;
  };
  
  logger.log("=== VIDEO COMPOSITION STARTED ===", {
    brideName,
    groomName,
    date,
    venue,
    characterImageSize: characterImage ? `${(characterImage.length / 1024).toFixed(1)}KB` : 'N/A',
    timestamp: new Date().toISOString(),
    memory: getMemoryInfo(),
  });
  
  onProgress(5);
  
  try {
    // Step 1: Load fonts
    logger.log("Step 1/8: Loading fonts");
    const fontStartTime = performance.now();
    await loadFonts();
    stepTimings.fonts = performance.now() - fontStartTime;
    logger.log("Step 1/8 complete", { duration: `${stepTimings.fonts.toFixed(0)}ms` });
    onProgress(10);
    
    // Step 2: Load assets in parallel
    logger.log("Step 2/8: Loading video and character assets");
    const assetStartTime = performance.now();
    const [video, characterImg] = await Promise.all([
      loadVideo("/assets/background.mp4"),
      loadImage(characterImage),
    ]);
    stepTimings.assets = performance.now() - assetStartTime;
    
    logger.log("Step 2/8 complete: Assets loaded", {
      duration: `${stepTimings.assets.toFixed(0)}ms`,
      video: {
        dimensions: `${video.videoWidth}x${video.videoHeight}`,
        duration: `${video.duration.toFixed(2)}s`,
        aspectRatio: (video.videoWidth / video.videoHeight).toFixed(2),
      },
      character: {
        dimensions: `${characterImg.width}x${characterImg.height}`,
        aspectRatio: (characterImg.width / characterImg.height).toFixed(2),
      },
      memory: getMemoryInfo(),
    });
    onProgress(20);
    
    // Step 3: Calculate character bounds
    logger.log("Step 3/8: Calculating character placement");
    const characterBounds = calculateCharacterBounds(characterImg);
    logger.log("Step 3/8 complete: Character bounds", {
      position: `(${characterBounds.x.toFixed(0)}, ${characterBounds.y.toFixed(0)})`,
      size: `${characterBounds.width.toFixed(0)}x${characterBounds.height.toFixed(0)}`,
      feetY: characterBounds.feetY.toFixed(0),
    });
    
    // Step 4: Setup canvas and media recording
    logger.log("Step 4/8: Setting up canvas and MediaRecorder");
    const setupStartTime = performance.now();
    
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d");
    logger.log("Canvas created", { dimensions: `${CANVAS_WIDTH}x${CANVAS_HEIGHT}` });
    
    // Setup MediaRecorder for video capture
    const targetFPS = 30;
    const canvasStream = canvas.captureStream(targetFPS);
    logger.log("Canvas stream created", { fps: targetFPS });
    
    // Create audio context to capture audio from the source video
    logger.log("Setting up audio capture");
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    logger.log("Audio context configured", { 
      sampleRate: audioContext.sampleRate,
      state: audioContext.state 
    });
    
    // Combine canvas video stream with audio stream
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks()
    ]);
    logger.log("Combined stream created", {
      videoTracks: combinedStream.getVideoTracks().length,
      audioTracks: combinedStream.getAudioTracks().length,
    });
    
    // Detect best supported codec
    const codecOptions = [
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
    ];
    let mimeType = 'video/webm;codecs=vp8,opus';
    for (const codec of codecOptions) {
      if (MediaRecorder.isTypeSupported(codec)) {
        mimeType = codec;
        break;
      }
    }
    
    const videoBitrate = 4000000; // 4 Mbps (optimized - same perceived quality, faster processing)
    const audioBitrate = 96000;   // 96 kbps (sufficient for this use case)
    
    const mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: audioBitrate,
    });
    
    stepTimings.setup = performance.now() - setupStartTime;
    logger.log("Step 4/8 complete: MediaRecorder configured", {
      duration: `${stepTimings.setup.toFixed(0)}ms`,
      mimeType,
      videoBitrate: `${(videoBitrate / 1000000).toFixed(1)} Mbps`,
      audioBitrate: `${(audioBitrate / 1000)} kbps`,
    });
    
    const chunks = [];
    let chunkCount = 0;
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
        chunkCount++;
        if (chunkCount % 10 === 0) {
          const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);
          logger.log("Recording data chunk", { 
            chunkCount, 
            totalSize: `${(totalSize / 1024 / 1024).toFixed(2)}MB` 
          });
        }
      }
    };
    
    mediaRecorder.onerror = (e) => {
      logger.error("MediaRecorder error", {
        error: e.error?.message || 'Unknown error',
        name: e.error?.name,
      });
    };
    
    mediaRecorder.onwarning = (e) => {
      logger.warn("MediaRecorder warning", e.message || 'Unknown warning');
    };
    
    // Create promise for recording completion
    const recordingComplete = new Promise((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        logger.log("Recording stopped, blob created", { 
          chunks: chunks.length,
          size: `${(blob.size / 1024 / 1024).toFixed(2)}MB`,
          state: mediaRecorder.state,
        });
        resolve(blob);
      };
    });
    
    // Step 5: Start recording and playback
    logger.log("Step 5/8: Starting recording");
    const recordingStartTime = performance.now();
    
    mediaRecorder.start(1000); // Request data every 1 second
    logger.log("MediaRecorder started", { timeslice: "1000ms" });
    
    // Play video and render frames
    video.currentTime = 0;
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    logger.log("Video seeked to start");
    
    // Step 6: Render frames
    logger.log("Step 6/8: Rendering frames", {
      targetDuration: `${video.duration.toFixed(2)}s`,
      targetFPS,
      canvasDimensions: `${CANVAS_WIDTH}x${CANVAS_HEIGHT}`,
    });
    const videoDuration = video.duration;
    let lastProgressUpdate = 20;
    let frameCount = 0;
    let lastFrameLogTime = 0;
    let renderStartTime = null;
    let lastFpsCheckTime = 0;
    let framesSinceLastCheck = 0;
    
    await new Promise((resolve) => {
      const renderLoop = () => {
        if (renderStartTime === null) {
          renderStartTime = performance.now();
        }
        
        if (video.ended || video.currentTime >= videoDuration) {
          const totalRenderTime = performance.now() - renderStartTime;
          logger.log("Render loop complete", { 
            totalFrames: frameCount,
            videoDuration: `${videoDuration.toFixed(2)}s`,
            actualRenderTime: `${totalRenderTime.toFixed(0)}ms`,
            avgFPS: (frameCount / (totalRenderTime / 1000)).toFixed(1),
            playbackSpeed: `${(videoDuration / (totalRenderTime / 1000)).toFixed(2)}x`,
            memory: getMemoryInfo(),
          });
          resolve();
          return;
        }
        
        // Draw current frame with animation timing based on video.currentTime
        drawFrame(ctx, video, characterImg, characterBounds, brideName, groomName, date, venue, video.currentTime);
        frameCount++;
        framesSinceLastCheck++;
        
        // Calculate real-time FPS every second
        const now = performance.now();
        if (now - lastFpsCheckTime >= 1000) {
          const realtimeFPS = framesSinceLastCheck / ((now - lastFpsCheckTime) / 1000);
          if (video.currentTime > 0) {
            logger.log("Real-time FPS", {
              fps: realtimeFPS.toFixed(1),
              videoTime: `${video.currentTime.toFixed(1)}s`,
            });
          }
          lastFpsCheckTime = now;
          framesSinceLastCheck = 0;
        }
        
        // Log frame progress every 5 seconds of video time
        if (video.currentTime - lastFrameLogTime >= 5) {
          logger.log("Frame rendering progress", {
            videoTime: `${video.currentTime.toFixed(1)}s`,
            frames: frameCount,
            progress: `${((video.currentTime / videoDuration) * 100).toFixed(1)}%`,
            elapsedReal: `${((performance.now() - renderStartTime) / 1000).toFixed(1)}s`,
          });
          lastFrameLogTime = video.currentTime;
        }
        
        // Update progress (20% to 85% during rendering)
        const renderProgress = 20 + (video.currentTime / videoDuration) * 65;
        if (renderProgress - lastProgressUpdate >= 2) {
          onProgress(Math.round(renderProgress));
          lastProgressUpdate = renderProgress;
        }
        
        requestAnimationFrame(renderLoop);
      };
      
      video.onended = resolve;
      logger.log("Starting video playback");
      lastFpsCheckTime = performance.now();
      video.play();
      renderLoop();
    });
    
    stepTimings.recording = performance.now() - recordingStartTime;
    logger.log("Step 6/8 complete: Rendering finished", { 
      duration: `${stepTimings.recording.toFixed(0)}ms`,
      frames: frameCount 
    });
    onProgress(85);
    
    // Step 7: Finalize recording
    logger.log("Step 7/8: Finalizing recording");
    const finalizeStartTime = performance.now();
    
    mediaRecorder.stop();
    logger.log("MediaRecorder stop requested");
    
    const webmBlob = await recordingComplete;
    
    // Cleanup audio context
    await audioContext.close();
    logger.log("Audio context closed");
    
    stepTimings.finalize = performance.now() - finalizeStartTime;
    logger.log("Step 7/8 complete: Recording finalized", { 
      duration: `${stepTimings.finalize.toFixed(0)}ms`,
      webmSize: `${(webmBlob.size / 1024 / 1024).toFixed(2)}MB` 
    });
    
    // Step 8: Convert WebM to MP4 for QuickTime/iOS compatibility
    logger.log("Step 8/8: Converting WebM to MP4 using FFmpeg.wasm");
    const conversionStartTime = performance.now();

    let mp4Blob;
    try {
      mp4Blob = await convertWebMToMP4(webmBlob, onProgress);
      stepTimings.conversion = performance.now() - conversionStartTime;

      logger.log("Step 8/8 complete: MP4 conversion finished", {
        duration: `${stepTimings.conversion.toFixed(0)}ms`,
        outputSize: `${(mp4Blob.size / 1024 / 1024).toFixed(2)}MB`,
      });
    } catch (conversionError) {
      logger.warn("MP4 conversion failed, falling back to WebM", conversionError.message);
      mp4Blob = webmBlob; // Fallback to WebM if conversion fails
    }
    
    onProgress(100);
    
    // Final summary
    const totalTime = performance.now() - compositionStartTime;
    logger.log("=== VIDEO COMPOSITION COMPLETE ===", {
      totalDuration: `${totalTime.toFixed(0)}ms`,
      totalDurationHuman: `${(totalTime / 1000).toFixed(1)}s`,
      output: {
        size: `${(mp4Blob.size / 1024 / 1024).toFixed(2)}MB`,
        type: mp4Blob.type,
      },
      stepTimings: {
        fonts: `${stepTimings.fonts?.toFixed(0) || 'N/A'}ms`,
        assets: `${stepTimings.assets?.toFixed(0) || 'N/A'}ms`,
        setup: `${stepTimings.setup?.toFixed(0) || 'N/A'}ms`,
        recording: `${stepTimings.recording?.toFixed(0) || 'N/A'}ms`,
        finalize: `${stepTimings.finalize?.toFixed(0) || 'N/A'}ms`,
        conversion: `${stepTimings.conversion?.toFixed(0) || 'N/A'}ms`,
      },
      timestamp: new Date().toISOString(),
      memory: getMemoryInfo(),
    });
    
    return mp4Blob;
    
  } catch (error) {
    const failTime = performance.now() - compositionStartTime;
    logger.error("=== VIDEO COMPOSITION FAILED ===", {
      error: error.message,
      stack: error.stack?.slice(0, 500),
      failedAfter: `${failTime.toFixed(0)}ms`,
      stepTimings,
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

export { LAYOUT_V4 };
