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
      fadeInStart: 15,
      fadeInDuration: 1,
      fadeOutStart: 28,
      fadeOutDuration: 2
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
      y: 620, // center anchor
      width: 520, // max width
      height: 650 // max height
    },
    parentsName: { x: 540, y: 980 },
    month: { x: 540, y: 720 }, // "February"
    dayName: { x: 380, y: 810 }, // "Thursday"
    time: { x: 700, y: 810 }, // "7:00 PM"
    dateNumber: { x: 540, y: 830 }, // "19"
    year: { x: 540, y: 900 }, // "2026"
    venue: { x: 540, y: 1600 } // "Hotel Name"
  },

  // Styling Configuration
  styles: {
    parentsName: {
      fontFamily: 'Brightwall.ttf',
      fontSize: 70,
      fontWeight: 400,
      color: '#af7f54',
      tracking: 0
    },
    dayName: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#4b4a4a',
      tracking: 40
    },
    dateNumber: {
      fontFamily: 'Roxborough CF.ttf',
      fontSize: 65,
      fontWeight: 400,
      color: '#705e3c',
      tracking: 0
    },
    month: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 500,
      color: '#4b4a4a',
      tracking: 60
    },
    year: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#4b4a4a',
      tracking: 80
    },
    time: {
      fontFamily: 'Opensauce.ttf',
      fontSize: 35,
      fontWeight: 400,
      color: '#4b4a4a',
      tracking: 20
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
