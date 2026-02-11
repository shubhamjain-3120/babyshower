import { GoogleGenAI } from "@google/genai";
import { createDevLogger } from "./devLogger.js";
import { BABY_ILLUSTRATION_PROMPT } from "./image-prompt.js";

const logger = createDevLogger("Gemini");
let geminiClient = null;

function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

function detectImageMimeType(buffer, fallback = "image/jpeg") {
  if (!buffer || buffer.length < 12) return fallback;
  const bytes = [...buffer.slice(0, 12)];

  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }

  return fallback;
}

export async function generateBabyIllustrationWithGemini(photoBuffer, requestId, options = {}) {
  logger.log(`[${requestId}] Starting Gemini image generation fallback`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  try {
    const base64Image = photoBuffer.toString("base64");
    const mimeType = options?.mimeType?.startsWith("image/")
      ? options.mimeType
      : detectImageMimeType(photoBuffer);

    const response = await getGeminiClient().models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [
        { text: BABY_ILLUSTRATION_PROMPT },
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
      ],
    });

    const candidates = response?.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts || [];
      const imagePart = parts.find((part) => part.inlineData?.data);
      if (imagePart) {
        return imagePart.inlineData.data;
      }
    }

    const textPart = candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (textPart) {
      throw new Error(`Gemini refused to generate: ${textPart}`);
    }

    throw new Error("No image data returned from Gemini image generation");
  } catch (error) {
    logger.error(`[${requestId}] Gemini image generation failed`, error);
    throw error;
  }
}
