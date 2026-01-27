/**
 * Canvas Composer - Royal Cursive Typography System
 *
 * Typography design:
 * - Royal cursive script (Alex Brush) for couple's names
 * - Names with first letter capitalized for elegant cursive flow
 * - Bride's name first, groom's name second
 * - Names in warm gold gradient, ampersand in copper color
 * - Clean serif (Playfair Display) for date and venue
 * - Precise vertical rhythm with generous whitespace
 */

// Canvas dimensions for the invite (9:16 aspect ratio)
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

// ============================================================================
// LAYOUT SPECIFICATION
// ============================================================================
const LAYOUT_V4 = {
  canvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  },

  // Character occupies 60% of vertical height
  character: {
    heightPercent: 0.60,
    marginXPercent: 0.08,     // 8% margin on each side
    topPercent: 0.22,         // Heads start at 22% from top (under arch)
    bottomPercent: 0.82,      // Feet end at 82% from top
    sizeMultiplier: 1.8,      // Scale factor for character size (1.8 = 90% of original 2.0)
  },

  // Ground shadow ellipse
  shadow: {
    yPercent: 0.82,           // Just below feet
    widthPercent: 0.45,       // 45% of canvas width
    heightPercent: 0.025,     // Thin ellipse
    blur: 30,
    opacity: 0.12,
    color: "rgba(30, 20, 15, 0.12)",
  },

  // =========================================================================
  // TYPOGRAPHY HIERARCHY (Premium Modern-Luxury)
  // =========================================================================
  
  // Names - Royal cursive script (Alex Brush)
  names: {
    yPercent: 0.115,          // Positioned at top with generous whitespace (1% higher)
    fontRatio: 2.04425,       // 85% of original 2.405 (2.405 * 0.85 = 2.04425)
    maxWidthPercent: 0.88,
    letterSpacing: 0.02,      // Minimal tracking for cursive script
    fontFamily: "AlexBrush, 'Alex Brush', 'Great Vibes', cursive",
    fontWeight: "400",        // Regular weight for elegant curves
  },

  // Ampersand - Decorative connector
  ampersand: {
    scale: 0.35,              // 35% of names size (50% smaller than before)
    yOffset: 0,               // Centered with names
  },

  // Date - Playfair Display with light brown
  date: {
    yPercent: 0.875,          // Below character, generous spacing
    fontRatio: 0.7,           // 30% smaller than base size (54px * 0.7 = ~38px)
    letterSpacing: 0.18,      // Moderate tracking (18%)
    fontFamily: "PlayfairDisplay, 'Playfair Display', Georgia, serif",
    fontWeight: "400",
    color: "#8B7355",         // Light brown
  },

  // Venue - Playfair Display with light brown
  venue: {
    yPercent: 0.915,          // Bottom area with breathing room
    fontRatio: 0.7,           // 30% smaller than base size (54px * 0.7 = ~38px)
    letterSpacing: 0.18,      // Moderate tracking (18%)
    fontFamily: "PlayfairDisplay, 'Playfair Display', Georgia, serif",
    fontWeight: "400",
    color: "#8B7355",         // Light brown
  },

  // Base font size (N)
  baseFontSize: 50,
};

// ============================================================================
// PREMIUM COLOR PALETTE - Warm Metallic Gold with Foil Texture
// ============================================================================
const COLORS = {
  // Warm metallic gold palette (richer, warmer tones)
  goldPrimary: "#D4A853",       // Rich warm gold base
  goldHighlight: "#F8E8B0",     // Warm champagne highlight (foil specular)
  goldDeep: "#A67C3D",          // Deep amber shadow tone
  goldMid: "#E6C066",           // Warm mid-tone gold
  goldRich: "#C9942B",          // Rich saturated gold
  goldBright: "#F0D78C",        // Bright warm gold for highlights
  
  // Warm ivory for supporting text
  ivoryWarm: "#F5EDE0",         // Warm ivory primary
  ivoryLight: "#FFFEF8",        // Light ivory highlight
  ivoryMuted: "#E8DFD0",        // Muted ivory for subtle contrast
  
  // Copper for ampersand
  copperBrown: "#B87333",       // Rich copper base
  copperBrownLight: "#CD8544",  // Lighter copper highlight
  copperBrownDark: "#8B5A2B",   // Dark copper shadow
  
  // Legacy ampersand gold colors (no longer used for ampersand)
  ampersandGold: "#CFB53B",     // Warm metallic gold
  ampersandGoldLight: "#E6CC66", // Light gold highlight
  ampersandGoldDark: "#B8960B",  // Dark gold shadow
  
  // Legacy support
  goldGradientStart: "#D4B978",
  goldGradientMid: "#F5E6C8",
  goldGradientEnd: "#8B7355",
  detailsText: "#C9A961",
};

/**
 * Capitalize the first letter of a string
 */
function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Loads an image from a URL with CORS support
 * @param {string} src - Image source URL or data URL
 * @returns {Promise<HTMLImageElement>} Promise that resolves to loaded image
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Loads all required fonts for canvas rendering
 * Includes AlexBrush, Playfair Display, Inter, and fallback fonts
 * @returns {Promise<void>} Promise that resolves when fonts are loaded
 */
async function loadFonts() {
  // Premium typography fonts
  const alexBrush = new FontFace(
    "AlexBrush",
    "url(/fonts/AlexBrush-Regular.ttf)"
  );
  const playfair = new FontFace(
    "PlayfairDisplay",
    "url(/fonts/PlayfairDisplay-Regular.ttf)"
  );
  const inter = new FontFace(
    "Inter",
    "url(/fonts/Inter-Regular.ttf)"
  );
  const interMedium = new FontFace(
    "InterMedium",
    "url(/fonts/Inter-Medium.ttf)"
  );
  // Legacy font for fallback
  const greatVibes = new FontFace(
    "GreatVibes",
    "url(/fonts/GreatVibes-Regular.ttf)"
  );

  try {
    const loadedFonts = await Promise.all([
      alexBrush.load(),
      playfair.load(),
      inter.load(),
      interMedium.load(),
      greatVibes.load().catch(() => null), // Optional fallback
    ]);
    
    loadedFonts.forEach(font => {
      if (font) document.fonts.add(font);
    });

    console.log("[Composer] Premium fonts loaded successfully");
  } catch (err) {
    console.warn("[Composer] Font loading failed, using fallbacks:", err);
  }
}

// ============================================================================
// TEXT RENDERING WITH PREMIUM TYPOGRAPHY HIERARCHY
// ============================================================================

/**
 * Calculate font size to fit text within max width
 * Includes letter-spacing compensation for accurate measurement
 */
function calculateFontSize(ctx, text, maxWidth, idealSize, minSize, fontFamily, letterSpacing = 0) {
  let fontSize = idealSize;

  while (fontSize > minSize) {
    ctx.font = `${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    // Account for letter-spacing in width calculation
    const spacingWidth = (text.length - 1) * (fontSize * letterSpacing);
    const totalWidth = metrics.width + spacingWidth;
    
    if (totalWidth <= maxWidth) {
      return fontSize;
    }
    fontSize -= 2;
  }

  return minSize;
}

/**
 * Draw text with letter-spacing (tracking)
 * Canvas doesn't natively support letter-spacing, so we draw character by character
 */
function drawTextWithTracking(ctx, text, x, y, letterSpacing) {
  if (letterSpacing <= 0) {
    ctx.fillText(text, x, y);
    return;
  }

  const chars = text.split('');
  const fontSize = parseFloat(ctx.font);
  const spacing = fontSize * letterSpacing;
  
  // Calculate total width for centering
  let totalWidth = 0;
  chars.forEach(char => {
    totalWidth += ctx.measureText(char).width;
  });
  totalWidth += (chars.length - 1) * spacing;
  
  // Start position (centered)
  let currentX = x - totalWidth / 2;

  chars.forEach((char, i) => {
    const charWidth = ctx.measureText(char).width;
    ctx.fillText(char, currentX + charWidth / 2, y);
    currentX += charWidth + spacing;
  });
}

/**
 * Draw text with small caps styling
 * First letter of each word is full size, remaining letters are smaller uppercase
 */
function drawTextWithSmallCaps(ctx, text, x, y, letterSpacing, fontFamily, fontWeight) {
  const baseFontSize = parseFloat(ctx.font);
  const smallCapScale = 0.75; // Small caps letters are 75% of the size
  const smallCapFontSize = baseFontSize * smallCapScale;
  const spacing = baseFontSize * letterSpacing;
  
  // Parse text into segments with size info
  const segments = [];
  const words = text.split(' ');
  
  words.forEach((word, wordIndex) => {
    if (wordIndex > 0) {
      segments.push({ char: ' ', isFirstLetter: false });
    }
    word.split('').forEach((char, charIndex) => {
      const isFirstLetter = charIndex === 0;
      segments.push({ 
        char: char.toUpperCase(), 
        isFirstLetter,
        fontSize: isFirstLetter ? baseFontSize : smallCapFontSize
      });
    });
  });
  
  // Calculate total width for centering
  let totalWidth = 0;
  segments.forEach((seg, i) => {
    ctx.font = `${fontWeight} ${seg.fontSize || baseFontSize}px ${fontFamily}`;
    totalWidth += ctx.measureText(seg.char).width;
    if (i < segments.length - 1) {
      totalWidth += spacing;
    }
  });
  
  // Start position (centered)
  let currentX = x - totalWidth / 2;
  
  // Draw each character
  segments.forEach((seg, i) => {
    ctx.font = `${fontWeight} ${seg.fontSize || baseFontSize}px ${fontFamily}`;
    const charWidth = ctx.measureText(seg.char).width;
    ctx.fillText(seg.char, currentX + charWidth / 2, y);
    currentX += charWidth + spacing;
  });
}

/**
 * Create warm metallic gold gradient with subtle foil-like appearance
 * Very subtle gradient transitions for elegant, non-flat fill
 */
function createPremiumGoldGradient(ctx, x, y, width, height) {
  // Diagonal gradient for subtle metallic sheen
  const gradient = ctx.createLinearGradient(
    x - width / 2,
    y - height * 0.3,
    x + width / 2,
    y + height * 0.3
  );
  
  // Very subtle gradient: warm gold base with gentle highlights
  // Creates foil-like appearance without harsh color changes
  gradient.addColorStop(0, COLORS.goldRich);        // Rich saturated gold
  gradient.addColorStop(0.15, COLORS.goldPrimary);  // Warm gold base
  gradient.addColorStop(0.35, COLORS.goldMid);      // Warm mid-tone
  gradient.addColorStop(0.5, COLORS.goldBright);    // Subtle bright highlight (foil specular)
  gradient.addColorStop(0.65, COLORS.goldMid);      // Back to mid-tone
  gradient.addColorStop(0.85, COLORS.goldPrimary);  // Warm gold base
  gradient.addColorStop(1, COLORS.goldRich);        // Rich saturated gold
  
  return gradient;
}

/**
 * Draw foil texture overlay for metallic simulation
 * Creates subtle noise pattern that simulates foil/metallic finish
 */
function drawFoilTexture(ctx, x, y, width, height, intensity = 0.08) {
  // Create offscreen canvas for texture
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = width;
  textureCanvas.height = height;
  const textureCtx = textureCanvas.getContext('2d');
  
  // Create subtle noise pattern
  const imageData = textureCtx.createImageData(width, height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    // Random value for each pixel with gold-tinted noise
    const noise = Math.random();
    // Very subtle variation - mostly transparent with occasional bright spots
    if (noise > 0.97) {
      // Rare bright specular highlight (foil glint)
      data[i] = 255;     // R - gold tint
      data[i + 1] = 235; // G
      data[i + 2] = 180; // B
      data[i + 3] = Math.floor(40 * intensity * 10); // A - subtle
    } else if (noise > 0.85) {
      // Subtle texture variation
      const brightness = 180 + Math.floor(noise * 75);
      data[i] = brightness;
      data[i + 1] = brightness * 0.85;
      data[i + 2] = brightness * 0.6;
      data[i + 3] = Math.floor(15 * intensity * 10); // Very subtle
    } else {
      // Transparent (no noise)
      data[i + 3] = 0;
    }
  }
  
  textureCtx.putImageData(imageData, 0, 0);
  
  // Apply slight blur for smoother texture
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.filter = 'blur(0.5px)';
  ctx.drawImage(textureCanvas, x - width / 2, y - height / 2, width, height);
  ctx.restore();
}

/**
 * Create warm ivory gradient for supporting text
 */
function createWarmIvoryGradient(ctx, x, y, width, height) {
  const gradient = ctx.createLinearGradient(
    x - width / 2,
    y - height / 2,
    x + width / 2,
    y + height / 2
  );
  
  gradient.addColorStop(0, COLORS.ivoryMuted);
  gradient.addColorStop(0.5, COLORS.ivoryWarm);
  gradient.addColorStop(1, COLORS.ivoryMuted);
  
  return gradient;
}

/**
 * Create copper brown gradient for names
 */
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

/**
 * Create warm metallic gold gradient for ampersand
 */
function createAmpersandGoldGradient(ctx, x, y, width, height) {
  const gradient = ctx.createLinearGradient(
    x - width / 2,
    y - height * 0.3,
    x + width / 2,
    y + height * 0.3
  );
  
  gradient.addColorStop(0, COLORS.ampersandGoldDark);
  gradient.addColorStop(0.15, COLORS.ampersandGold);
  gradient.addColorStop(0.35, COLORS.ampersandGoldLight);
  gradient.addColorStop(0.5, "#F0DC82"); // Bright highlight
  gradient.addColorStop(0.65, COLORS.ampersandGoldLight);
  gradient.addColorStop(0.85, COLORS.ampersandGold);
  gradient.addColorStop(1, COLORS.ampersandGoldDark);
  
  return gradient;
}

/**
 * Draw names with royal cursive Alex Brush font and pink roses
 * Bride's name first, groom's name second, with first letter capitalized
 * Names in warm gold gradient, ampersand in copper
 */
function drawNamesText(ctx, brideName, groomName, pinkRoseImg) {
  const layout = LAYOUT_V4.names;
  const y = CANVAS_HEIGHT * layout.yPercent;
  const maxWidth = CANVAS_WIDTH * layout.maxWidthPercent;
  const idealSize = LAYOUT_V4.baseFontSize * layout.fontRatio;
  const baseFontSize = LAYOUT_V4.baseFontSize;

  // Reference combined character count for ideal font size (bride + groom names including spaces)
  const IDEAL_COMBINED_LENGTH = 10;
  const MIN_FONT_SCALE = 0.35; // Allow fonts to shrink to 35% of base for very long names

  // Format names with first letter capitalized for cursive elegance
  const brideNameFormatted = capitalizeFirst(brideName);
  const groomNameFormatted = capitalizeFirst(groomName);
  const ampersand = " & ";
  const fullText = `${brideNameFormatted}${ampersand}${groomNameFormatted}`;

  // Combined length (spaces included) with zero guard
  const combinedNameLength = Math.max(brideNameFormatted.length + groomNameFormatted.length + 3, 1);

  // Scale down based on combined name length while keeping a sensible minimum scale
  const lengthScale = Math.min(1, IDEAL_COMBINED_LENGTH / combinedNameLength);
  const scaledIdealFactor = Math.max(lengthScale, MIN_FONT_SCALE);
  const adjustedIdealSize = idealSize * scaledIdealFactor;

  const minSize = Math.max(baseFontSize * MIN_FONT_SCALE, 32);

  const fontSize = calculateFontSize(
    ctx,
    fullText,
    maxWidth,
    adjustedIdealSize,
    minSize,
    layout.fontFamily,
    layout.letterSpacing
  );

  ctx.font = `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Calculate individual text widths
  const brideWidth = ctx.measureText(brideNameFormatted).width;
  const ampersandWidth = ctx.measureText(ampersand).width;
  const groomWidth = ctx.measureText(groomNameFormatted).width;
  const totalTextWidth = brideWidth + ampersandWidth + groomWidth;
  
  // Starting X position (centered)
  let currentX = (CANVAS_WIDTH - totalTextWidth) / 2;
  
  // Draw bride's name in warm gold gradient
  const goldGradient = createPremiumGoldGradient(
    ctx,
    currentX + brideWidth / 2,
    y,
    brideWidth,
    fontSize * 1.5
  );
  
  ctx.shadowColor = "rgba(166, 124, 61, 0.35)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  
  ctx.fillStyle = goldGradient;
  ctx.fillText(brideNameFormatted, currentX, y);
  currentX += brideWidth;
  
  // Draw ampersand in copper
  const copperGradient = createCopperBrownGradient(
    ctx,
    currentX + ampersandWidth / 2,
    y,
    ampersandWidth,
    fontSize * 1.5
  );
  
  ctx.shadowColor = "rgba(139, 90, 43, 0.35)";
  ctx.fillStyle = copperGradient;
  ctx.fillText(ampersand, currentX, y);
  currentX += ampersandWidth;
  
  // Draw groom's name in warm gold gradient
  const goldGradient2 = createPremiumGoldGradient(
    ctx,
    currentX + groomWidth / 2,
    y,
    groomWidth,
    fontSize * 1.5
  );
  
  ctx.shadowColor = "rgba(166, 124, 61, 0.35)";
  ctx.fillStyle = goldGradient2;
  ctx.fillText(groomNameFormatted, currentX, y);
  
  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  // Apply subtle foil texture overlay for metallic simulation
  drawFoilTexture(ctx, CANVAS_WIDTH / 2, y, maxWidth, fontSize * 1.8, 0.06);
}

/**
 * Format date string to elegant "DD MMMM YYYY" format
 * Uses refined typography with proper spacing
 */
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

/**
 * Draw date text with Inter Medium - restrained subline
 * Clean humanist sans-serif with warm metallic gold
 */
function drawDateText(ctx, dateStr) {
  const layout = LAYOUT_V4.date;
  const y = CANVAS_HEIGHT * layout.yPercent;
  const fontSize = LAYOUT_V4.baseFontSize * layout.fontRatio;

  const formattedDate = formatDateDisplay(dateStr);
  const displayText = `Date: ${formattedDate}`;

  // Playfair Display for elegant date text
  ctx.font = `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Subtle shadow for depth
  ctx.shadowColor = "rgba(139, 115, 85, 0.2)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  // Light brown color
  ctx.fillStyle = layout.color;

  // Draw with moderate letter-spacing
  drawTextWithTracking(ctx, displayText, CANVAS_WIDTH / 2, y, layout.letterSpacing);

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Draw venue text with Playfair Display - light brown color
 */
function drawVenueText(ctx, venue) {
  const layout = LAYOUT_V4.venue;
  const y = CANVAS_HEIGHT * layout.yPercent;
  const fontSize = LAYOUT_V4.baseFontSize * layout.fontRatio;

  const displayText = `Venue: ${venue}`;

  // Playfair Display for elegant venue text
  ctx.font = `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Subtle shadow for depth
  ctx.shadowColor = "rgba(139, 115, 85, 0.2)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  // Light brown color
  ctx.fillStyle = layout.color;

  // Draw with moderate letter-spacing
  drawTextWithTracking(ctx, displayText, CANVAS_WIDTH / 2, y, layout.letterSpacing);

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// ============================================================================
// CHARACTER PLACEMENT (Fixed Geometry)
// ============================================================================

/**
 * Calculate character bounds using fixed layout percentages
 */
function calculateCharacterBounds(characterImg) {
  // Target area based on fixed percentages
  const targetTop = CANVAS_HEIGHT * LAYOUT_V4.character.topPercent;
  const targetBottom = CANVAS_HEIGHT * LAYOUT_V4.character.bottomPercent;
  const targetHeight = targetBottom - targetTop;

  const marginX = CANVAS_WIDTH * LAYOUT_V4.character.marginXPercent;
  const maxWidth = CANVAS_WIDTH - (marginX * 2);

  // Calculate dimensions preserving aspect ratio
  const charAspect = characterImg.width / characterImg.height;

  let charWidth, charHeight;

  // Fit to height first, then check width
  charHeight = targetHeight;
  charWidth = charHeight * charAspect;

  // If too wide, fit to width instead
  if (charWidth > maxWidth) {
    charWidth = maxWidth;
    charHeight = charWidth / charAspect;
  }

  // Apply size multiplier (e.g., 2.0 = 100% bigger)
  const multiplier = LAYOUT_V4.character.sizeMultiplier || 1.0;
  charWidth *= multiplier;
  charHeight *= multiplier;

  // Center horizontally
  const charX = (CANVAS_WIDTH - charWidth) / 2;

  // Align feet to bottom of target area (keep feet position stable)
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
// GROUND SHADOW
// ============================================================================

/**
 * Draw soft elliptical shadow under character's feet
 */
function drawGroundShadow(ctx, characterBounds) {
  const shadow = LAYOUT_V4.shadow;

  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT * shadow.yPercent;
  const radiusX = (CANVAS_WIDTH * shadow.widthPercent) / 2;
  const radiusY = (CANVAS_HEIGHT * shadow.heightPercent) / 2;

  // Create radial gradient for soft falloff
  const gradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, Math.max(radiusX, radiusY)
  );

  gradient.addColorStop(0, `rgba(30, 20, 15, ${shadow.opacity})`);
  gradient.addColorStop(0.6, `rgba(30, 20, 15, ${shadow.opacity * 0.4})`);
  gradient.addColorStop(1, "rgba(30, 20, 15, 0)");

  ctx.save();

  // Draw blurred ellipse
  ctx.filter = `blur(${shadow.blur}px)`;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ============================================================================
// BACKGROUND CANVAS
// ============================================================================

/**
 * Creates a canvas with the background image
 * @param {HTMLImageElement} backgroundImg - Background image to draw
 * @returns {HTMLCanvasElement} Canvas with background rendered
 */
function createBackgroundCanvas(backgroundImg) {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (backgroundImg) {
    ctx.drawImage(backgroundImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else {
    // Fallback: cream/gold gradient
    const bgGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    bgGradient.addColorStop(0, "#FFF8DC");
    bgGradient.addColorStop(0.5, "#FFE4B5");
    bgGradient.addColorStop(1, "#DEB887");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Decorative border
    ctx.strokeStyle = "#B8860B";
    ctx.lineWidth = 20;
    ctx.strokeRect(30, 30, CANVAS_WIDTH - 60, CANVAS_HEIGHT - 60);
  }

  return canvas;
}

// ============================================================================
// MAIN COMPOSITION FUNCTION
// ============================================================================

/**
 * Compose the final wedding invite
 *
 * @param {Object} params
 * @param {string} params.characterImage - Data URL of character (with transparent bg)
 * @param {string} params.brideName
 * @param {string} params.groomName
 * @param {string} params.date
 * @param {string} params.venue
 * @returns {Promise<string>} - Data URL of final PNG
 */
export async function composeInvite({ characterImage, brideName, groomName, date, venue }) {
  console.log("[Composer] Starting Phase 4 composition...");
  const startTime = performance.now();

  // Load fonts
  await loadFonts();

  // Load images in parallel
  const [backgroundImg, characterImg, pinkRoseImg] = await Promise.all([
    loadImage("/assets/background.png").catch(() => null),
    loadImage(characterImage),
    loadImage("/assets/pink-rose.svg").catch(() => null),
  ]);

  console.log(`[Composer] Images loaded: ${(performance.now() - startTime).toFixed(0)}ms`);

  // Calculate character placement using fixed layout
  const characterBounds = calculateCharacterBounds(characterImg);

  console.log(`[Composer] Character bounds:`, characterBounds);

  // Create final canvas
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");

  // =========================================================================
  // LAYER 1: Background
  // =========================================================================
  const backgroundCanvas = createBackgroundCanvas(backgroundImg);
  ctx.drawImage(backgroundCanvas, 0, 0);

  // =========================================================================
  // LAYER 2: Ground Shadow
  // =========================================================================
  drawGroundShadow(ctx, characterBounds);

  // =========================================================================
  // LAYER 3: Character
  // =========================================================================
  ctx.drawImage(
    characterImg,
    characterBounds.x,
    characterBounds.y,
    characterBounds.width,
    characterBounds.height
  );

  // =========================================================================
  // LAYER 4: Premium Typography Overlays
  // =========================================================================

  // Names - Royal cursive Alex Brush font with pink roses
  // Bride's name first, groom's second, both in lowercase
  // Pink rose before bride's name, pink rose after groom's name
  // Names in warm gold gradient, ampersand in copper
  drawNamesText(ctx, brideName, groomName, pinkRoseImg);

  // Date - Restrained subline (Inter Medium, soft gold)
  // Clean humanist sans-serif with wide letter-spacing
  drawDateText(ctx, date);

  // Venue - Minimal supporting text (Inter Regular, warm ivory-gold)
  // Subtle presence with refined tracking
  drawVenueText(ctx, venue);

  const totalTime = performance.now() - startTime;
  console.log(`[Composer] Composition complete: ${totalTime.toFixed(0)}ms`);

  // Export as PNG
  return canvas.toDataURL("image/png", 1.0);
}

// Export layout config for debugging
export { LAYOUT_V4 };
