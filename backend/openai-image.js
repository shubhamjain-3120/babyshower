import OpenAI from "openai";
import { createDevLogger } from "./devLogger.js";

const logger = createDevLogger("OpenAI");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transform baby photo into Ghibli-style illustration using GPT Image 1.5
 *
 * Uses OpenAI's image edit endpoint for image-to-image transformation.
 * This preserves the subject while applying the artistic style.
 *
 * @param {Buffer} photoBuffer - Baby photo buffer
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<string>} - Base64 encoded image
 */
export async function generateBabyIllustration(photoBuffer, requestId) {
  logger.log(`[${requestId}] Starting Ghibli transformation`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  try {
    // Convert buffer to File-like object for OpenAI API
    const photoFile = new File([photoBuffer], "baby.jpg", { type: "image/jpeg" });

    logger.log(`[${requestId}] Calling OpenAI image edit API with gpt-image-1.5`);

    // Use image edit endpoint for image-to-image transformation
    const response = await openai.images.edit({
      model: "gpt-image-1.5",
      image: photoFile,
      prompt: "turn into ghibli",
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });

    logger.log(`[${requestId}] OpenAI transformation complete`);

    if (!response.data || !response.data[0] || !response.data[0].b64_json) {
      throw new Error("No image data returned from OpenAI");
    }

    return response.data[0].b64_json;
  } catch (error) {
    logger.error(`[${requestId}] OpenAI transformation failed`, error);

    // Provide more specific error messages
    if (error.status === 401) {
      throw new Error("Invalid OpenAI API key");
    } else if (error.status === 429) {
      throw new Error("OpenAI rate limit exceeded. Please try again later.");
    } else if (error.status === 400) {
      throw new Error("Invalid image format. Please use a clear baby photo.");
    }

    throw new Error(`Image transformation failed: ${error.message}`);
  }
}
