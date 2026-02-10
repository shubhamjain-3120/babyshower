/**
 * Video Composition Configuration
 *
 * Centralized configuration for video timing, positioning, and styling.
 * All values are configurable here instead of being hardcoded in the composer.
 */

export const VIDEO_CONFIG = {
  // Canvas dimensions
  canvas: {
    width: 1080,
    height: 1920,
  },

  // Timing Configuration (in seconds)
  timing: {
    babyImage: {
      fadeInStart: 20,
      fadeInDuration: 1,
      fadeOutStart: 30, // never fades out if > video duration
      fadeOutDuration: 0
    },
    eventDetails: {
      fadeInStart: 25,
      fadeInDuration: 2,
      fadeOutStart: 30,
      fadeOutDuration: 0
    }
  },

  // Position Configuration (x, y in pixels, 1080x1920 canvas)
  positions: {
    babyImage: {
      x: 540, // centered
      y: 800, // middle-ish
      width: 400, // max width
      height: 600 // max height
    },
    parentsName: { x: 540, y: 200 },
    dayName: { x: 540, y: 1200 }, // "Thursday"
    dateNumber: { x: 540, y: 1280 }, // "19"
    month: { x: 540, y: 1360 }, // "February"
    year: { x: 540, y: 1440 }, // "2026"
    time: { x: 540, y: 1520 }, // "7:00 PM"
    venue: { x: 540, y: 1600 } // "Hotel Name"
  },

  // Styling Configuration
  styles: {
    parentsName: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 48,
      fontWeight: 700,
      color: '#4A6B8A' // blue-gray
    },
    dayName: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#FFFFFF'
    },
    dateNumber: {
      fontFamily: 'Roxborough CF.ttf',
      fontSize: 72,
      fontWeight: 700,
      color: '#87CEEB' // sky blue
    },
    month: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#FFFFFF'
    },
    year: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#FFFFFF'
    },
    time: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#FFFFFF'
    },
    venue: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#FFFFFF'
    }
  }
};

/**
 * Calculate opacity for fade in/out animations
 *
 * @param {number} currentTime - Current time in seconds
 * @param {Object} timing - Timing configuration for the element
 * @returns {number} - Opacity value (0-1)
 */
export function calculateOpacity(currentTime, timing) {
  const { fadeInStart, fadeInDuration, fadeOutStart, fadeOutDuration } = timing;

  // Before fade in starts
  if (currentTime < fadeInStart) {
    return 0;
  }

  // During fade in
  if (currentTime < fadeInStart + fadeInDuration) {
    return (currentTime - fadeInStart) / fadeInDuration;
  }

  // Fully visible (between fade in and fade out)
  if (currentTime < fadeOutStart) {
    return 1;
  }

  // During fade out
  if (currentTime < fadeOutStart + fadeOutDuration) {
    return 1 - ((currentTime - fadeOutStart) / fadeOutDuration);
  }

  // After fade out
  return 0;
}
