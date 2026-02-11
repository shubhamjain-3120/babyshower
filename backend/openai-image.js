import OpenAI from "openai";
import { createDevLogger } from "./devLogger.js";

const logger = createDevLogger("OpenAI");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transform baby photo into Ghibli-style illustration
 *
 * Uses OpenAI's new responses API with direct image generation tool.
 * Sends baby photo as base64 reference and generates illustration in one call.
 *
 * @param {Buffer} photoBuffer - Baby photo buffer
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<string>} - Base64 encoded image
 */
export async function generateBabyIllustration(photoBuffer, requestId) {
  logger.log(`[${requestId}] Starting Ghibli transformation with direct image generation`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  try {
    // Convert baby photo to base64 data URL
    logger.log(`[${requestId}] Converting image to base64`);
    const base64Image = photoBuffer.toString("base64");
    const imageUrl = `data:image/jpeg;base64,${base64Image}`;

    // Direct image generation prompt (generic - works with any subject)
    const prompt = `Transform the subject in this reference image into a warm and whimsical Studio Ghibli style illustration.
Maintain the subject's key facial features, expression, and appearance while applying these artistic elements:
- Soft watercolor aesthetic with gentle pastel colors
- Dreamy and peaceful atmosphere with soft, diffused lighting
- Magical, enchanting feeling characteristic of Studio Ghibli films
- Simple, clean composition with the subject as the central focus
- White or very light background to allow easy background removal`;

    logger.log(`[${requestId}] Calling responses.create with image_generation tool`);

    // Use new responses API with image generation tool
    // Force tool usage with tool_choice to ensure image generation
    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_image",
              image_url: imageUrl,
            },
          ],
        },
      ],
      tools: [{ type: "image_generation" }],
      tool_choice: { type: "image_generation" },
    });

    logger.log(`[${requestId}] Image generation complete`);

    // Extract generated image from response
    const imageData = response.output
      .filter((output) => output.type === "image_generation_call")
      .map((output) => output.result);

    if (!imageData || imageData.length === 0) {
      // Check if model returned a text message instead
      const textMessage = response.output
        ?.find((output) => output.type === "message")
        ?.content?.find((c) => c.type === "output_text")
        ?.text;

      if (textMessage) {
        throw new Error(`Model refused to generate: ${textMessage}`);
      }

      throw new Error("No image data returned from image generation");
    }

    // Return the base64 image data
    return imageData[0];
  } catch (error) {
    logger.error(`[${requestId}] Image generation failed`, error);

    // Provide more specific error messages
    if (error.status === 401) {
      throw new Error("Invalid OpenAI API key");
    } else if (error.status === 429) {
      throw new Error("OpenAI rate limit exceeded. Please try again later.");
    } else if (error.status === 400) {
      throw new Error("Invalid request. Please use a clear baby photo.");
    } else if (error.code === "content_policy_violation") {
      throw new Error("Image generation failed due to content policy. Please use a different photo.");
    }

    throw new Error(`Image transformation failed: ${error.message}`);
  }
}
