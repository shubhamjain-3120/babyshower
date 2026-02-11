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

  // Shared timing presets (in seconds)
  timings: {
    hero: {
      fadeInStart: 15,
      fadeInDuration: 1,
      fadeOutStart: 19,
      fadeOutDuration: 1
    },
    details: {
      fadeInStart: 20,
      fadeInDuration: 1,
      fadeOutStart: 45,
      fadeOutDuration: 0
    }
  },

  // Consolidated element configuration (position, style, timing)
  elements: {
    babyImage: {
      position: {
        x: 540, // centered
        y: 620, // center anchor
        width: 520, // max width
        height: 650 // max height
      },
      timingRef: "hero"
    },
    parentsName: {
      position: { x: 560, y: 1080 },
      align: "center",
      style: {
        fontFamily: "Brightwall.ttf",
        fontSize: 70,
        fontWeight: 400,
        color: "#af7f54",
        tracking: 0
      },
      timingRef: "hero"
    },
    month: {
      position: { x: 560, y: 800 }, // "February"
      align: "center",
      style: {
        fontFamily: "Opensauce.ttf",
        fontSize: 50,
        fontWeight: 700,
        color: "#4b4a4a",
        tracking: 60
      },
      timingRef: "details"
    },
    dayName: {
      position: { x: 280, y: 920 }, // "Thursday"
      align: "center",
      style: {
        fontFamily: "Opensauce.ttf",
        fontSize: 50,
        fontWeight: 700,
        color: "#4b4a4a",
        tracking: 40
      },
      timingRef: "details"
    },
    time: {
      position: { x: 800, y: 920 }, // "7:00 PM"
      align: "center",
      style: {
        fontFamily: "Opensauce.ttf",
        fontSize: 50,
        fontWeight: 700,
        color: "#4b4a4a",
        tracking: 20
      },
      timingRef: "details"
    },
    dateNumber: {
      position: { x: 560, y: 920 }, // "19"
      align: "center",
      style: {
        fontFamily: "Roxborough CF.ttf",
        fontSize: 85,
        fontWeight: 400,
        color: "#705e3c",
        tracking: 0
      },
      timingRef: "details"
    },
    year: {
      position: { x: 560, y: 1020 }, // "2026"
      align: "center",
      style: {
        fontFamily: "Opensauce.ttf",
        fontSize: 50,
        fontWeight: 700,
        color: "#4b4a4a",
        tracking: 80
      },
      timingRef: "details"
    },
    venue: {
      position: { x: 560, y: 1200 }, // "Hotel Name"
      align: "center",
      style: {
        fontFamily: "Opensauce.ttf",
        fontSize: 50,
        fontWeight: 400,
        color: "#4b4a4a",
        tracking: 0
      },
      timingRef: "details"
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

  const hasFadeOut = fadeOutStart != null && fadeOutDuration != null && fadeOutDuration > 0;

  // Fully visible (no fade out configured)
  if (!hasFadeOut) {
    return 1;
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
