/**
 * Video Composition Configuration (backend copy)
 *
 * Keep in sync with frontend/src/utils/videoConfig.js.
 */

export const VIDEO_CONFIG = {
  canvas: {
    width: 1080,
    height: 1920,
  },
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
  elements: {
    babyImage: {
      position: {
        x: 540,
        y: 620,
        width: 520,
        height: 650
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
      position: { x: 560, y: 800 },
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
      position: { x: 280, y: 920 },
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
      position: { x: 800, y: 920 },
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
      position: { x: 560, y: 920 },
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
      position: { x: 560, y: 1020 },
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
      position: { x: 560, y: 1200 },
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
