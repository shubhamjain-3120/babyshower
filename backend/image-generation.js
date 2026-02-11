import { createDevLogger } from "./devLogger.js";
import { generateBabyIllustrationWithOpenAI } from "./openai-image.js";
import { generateBabyIllustrationWithGemini } from "./gemini-image.js";

const logger = createDevLogger("ImageGeneration");

export async function generateBabyIllustration(photoBuffer, requestId, options = {}) {
  const provider = process.env.IMAGE_GENERATION_PROVIDER?.toLowerCase();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

  if (!provider) {
    throw new Error('IMAGE_GENERATION_PROVIDER is required. Use "openai" or "gemini".');
  }

  if (!["openai", "gemini"].includes(provider)) {
    throw new Error('Unsupported IMAGE_GENERATION_PROVIDER. Use "openai" or "gemini".');
  }

  if (provider === "openai") {
    if (!hasOpenAIKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    return await generateBabyIllustrationWithOpenAI(photoBuffer, requestId);
  }

  if (provider === "gemini") {
    if (!hasGeminiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    return await generateBabyIllustrationWithGemini(photoBuffer, requestId, options);
  }

  throw new Error("No image generation provider available (missing OPENAI_API_KEY or GEMINI_API_KEY)");
}
