import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { createDevLogger } from "./devLogger.js";

const logger = createDevLogger("Gemini");

// Initialize OpenAI for photo analysis
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Gemini for image generation
// Note: Imagen 3 requires Vertex AI access with proper project/location configuration
const useVertexAI = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";
const genAI = useVertexAI
  ? new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    })
  : new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

//Analyze a couple photo using ChatGPT (GPT-4 Vision) to extract detailed descriptions
export async function analyzePhoto(photo, requestId = "") {
  logger.log(`[${requestId}] Starting photo analysis with ChatGPT`, {
    photoMimetype: photo?.mimetype,
    photoBufferLen: photo?.buffer?.length,
  });
  const analysisPrompt = `Role: Illustrator's Assistant. Analyze the image to generate specific artistic reference data for a stylized wedding illustration (Bride/Groom).

### Constraints
1. Output valid JSON only.
2. NO "unknown", "hidden", or "null" values. Infer from context/proportions if partially visible.
3. Use the specific vocabulary lists provided below.

### Reference Criteria

**1. Height:** [very short, short, average, tall, very tall] (Relative to each other).
**2. Coloring:** format as "[Base Tone] with [Palette]".
   - Base: very fair, fair, light, light-medium, medium, medium-tan, tan, olive, caramel, brown, dark/deep/rich brown.
   - Palette: warm (golden/peachy), cool (pink/rosy), neutral, olive-toned.
**3. Hairstyle:** Detailed description of Length, Style, Texture, and Volume.
   - Groom specific: Fade, undercut, side-part, etc.
**4. Body Type:** [slim, athletic, average, curvy, stocky, broad].
**5. Face Shape:** [oval, round, square, heart, diamond, oblong].
**6. Facial Hair (Groom):** [Clean-shaven, Light/Heavy stubble, Short/Medium/Full beard, Goatee, Mustache only, Soul patch, Van Dyke, Anchor].
**7. Spectacles:** [none, rectangular, round, oval, cat-eye, aviator, rimless, half-rim]. Note material/color if present.

### Output JSON Structure
{
  "bride": {
    "height": { "primary": "" },
    "coloring": { "primary": "" },
    "hairstyle": { "primary": "" },
    "body_type": { "primary": "" },
    "face_shape": { "primary": "" },
    "spectacles": { "primary": "" }
  },
  "groom": {
    "height": { "primary": "" },
    "coloring": { "primary": "" },
    "hairstyle": { "primary": "" },
    "body_shape": { "primary": "" },
    "facial_hair_style": { "primary": "" },
    "face_shape": { "primary": "" },
    "spectacles": { "primary": "" }
  }
}

`;

  // Build image content for GPT-4 Vision
  const imageContent = [{
    type: "image_url",
    image_url: {
      url: `data:${photo.mimetype};base64,${photo.buffer.toString("base64")}`,
    },
  }];

  logger.log(`[${requestId}] Calling OpenAI GPT-4o for photo analysis`);
  const startTime = performance.now();

  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            ...imageContent,
          ],
        },
      ],
      max_tokens: 1000,
    });
  } catch (apiError) {
    logger.error(`[${requestId}] OpenAI API call failed`, apiError);
    throw apiError;
  }

  const apiDuration = performance.now() - startTime;
  logger.log(`[${requestId}] OpenAI response received`, {
    duration: `${apiDuration.toFixed(0)}ms`
  });

  const responseText = response.choices[0]?.message?.content;
  
  logger.log(`[${requestId}] Parsing response`, {
    responseTextLen: responseText?.length,
    responseTextPreview: responseText?.slice(0, 200) + "...",
  });

  if (!responseText) {
    logger.error(`[${requestId}] No response text from ChatGPT`, "Empty response");
    throw new Error("ChatGPT did not return a response");
  }

  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  
  logger.log(`[${requestId}] JSON extraction`, {
    jsonMatchFound: !!jsonMatch,
    jsonMatchLen: jsonMatch?.[0]?.length,
  });

  if (!jsonMatch) {
    // Check if this is a content policy refusal
    if (responseText.toLowerCase().includes("sorry") || responseText.toLowerCase().includes("can't") || responseText.toLowerCase().includes("cannot")) {
      logger.error(`[${requestId}] Content policy refusal detected`, responseText.slice(0, 500));
      throw new Error(`AI photo analysis refused. Response: ${responseText.slice(0, 300)}`);
    }
    logger.error(`[${requestId}] Failed to parse JSON from response`, responseText.slice(0, 500));
    throw new Error(`Failed to parse photo analysis. Response: ${responseText.slice(0, 300)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Remap field names from artistic prompt terminology back to internal field names
  if (parsed.bride) {
    if (parsed.bride.coloring) {
      parsed.bride.skin_color = parsed.bride.coloring;
      delete parsed.bride.coloring;
    }
    if (parsed.bride.body_type) {
      parsed.bride.body_shape = parsed.bride.body_type;
      delete parsed.bride.body_type;
    }
  }
  if (parsed.groom) {
    if (parsed.groom.coloring) {
      parsed.groom.skin_color = parsed.groom.coloring;
      delete parsed.groom.coloring;
    }
  }

  logger.log(`[${requestId}] Photo analysis complete`, {
    hasBride: !!parsed.bride,
    hasGroom: !!parsed.groom,
  });

  return parsed;
}

async function retryWithBackoff(fn, maxRetries = 3, baseDelayMs = 2000, requestId = "") {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(`[${requestId}] Gemini API attempt ${attempt}/${maxRetries}`);
      const result = await fn();
      logger.log(`[${requestId}] Gemini API attempt ${attempt} succeeded`);
      return result;
    } catch (error) {
      lastError = error;
      const isRetryable = error.status === 503 || error.status === 429 || error.message?.includes('overloaded');
      logger.log(`[${requestId}] Gemini API attempt ${attempt} failed`, {
        isRetryable,
        errorStatus: error.status,
        errorMessage: error.message?.slice(0, 200),
      });
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
      logger.log(`[${requestId}] Waiting ${Math.round(delay)}ms before retry`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Generate wedding characters: analyze photo then generate portrait
export async function generateWeddingCharacters(photo, requestId = "") {
  logger.log(`[${requestId}] Starting generateWeddingCharacters pipeline`);

  // Step 1: Analyze photo to extract descriptions
  const descriptions = await analyzePhoto(photo, requestId);

  // Step 2: Generate portrait using Gemini
  const result = await generateWithGemini(descriptions, requestId);

  return result;
}

//Generate wedding portrait using Gemini 2.5 Flash Image model
async function generateWithGemini(descriptions, requestId = "") {
  logger.log(`[${requestId}] Preparing Gemini generation prompt`);
  // Extract values from the new structure (bride/groom with primary/alternates)
  const bride = descriptions.bride;
  const groom = descriptions.groom;

  // Helper to get primary value or fallback
  const getPrimary = (attr, fallback = 'average') => {
    if (!attr) return fallback;
    return attr.primary || fallback;
  };

  const prompt = `(Masterpiece), Studio Ghibli art style.

CRITICAL RULE: Physical traits (Skin, Face, Body, Glasses) must be EXACT matches, overriding style defaults. 

CRITICAL FACIAL EXPRESSION: Both Bride and Groom must have a subtle, warm smile (gentle upturned lips, calm relaxed eyes). This is mandatory and must not be neutral, serious, or exaggerated.

[SCENE]: Full-body shot, Bride and Groom standing side-by-side, holding hands, front-facing.

[BACKGROUND]: Pure white background only. No shadows, no props.



[SUBJECT 1: BRIDE - STRICT FEATURES]

Skin Tone: ${getPrimary(bride?.skin_color)} (exact shade)

Body Shape: ${getPrimary(bride?.body_shape)}

Face Shape: ${getPrimary(bride?.face_shape)}

Hair: ${getPrimary(bride?.hairstyle)}

Glasses: ${getPrimary(bride?.spectacles, 'none')} (Must draw if present)

Height: ${getPrimary(bride?.height)}



[SUBJECT 2: GROOM - STRICT FEATURES]

Skin Tone: ${getPrimary(groom?.skin_color)} (exact shade)

Body Shape: ${getPrimary(groom?.body_shape)}

Face Shape: ${getPrimary(groom?.face_shape)}

Hair: ${getPrimary(groom?.hairstyle)}

Facial Hair: ${getPrimary(groom?.facial_hair_style)}

Glasses: ${getPrimary(groom?.spectacles, 'none')} (Must draw if present)

Height: ${getPrimary(groom?.height)}



[ATTIRE DETAILS]

Bride: Soft blush pink Lehenga Choli, A-line skirt with rose/teal/gold floral embroidery. Sheer pink dupatta with gold border. Traditional gold jewelry.

Groom: Cream Jodhpuri Sherwani with teal peacock embroidery on left chest. Maroon velvet dupatta (right shoulder). White Churidar. Golden Mojari shoes.



[STYLE TAGS]

Cel shading, hand-drawn aesthetic, gentle lighting, warm colors, sharp focus, high definition.`;

  logger.log(`[${requestId}] Generating with prompt`, { promptLength: prompt.length });

  // Use retry logic for transient API errors (503, 429)
  const startTime = performance.now();
  const response = await retryWithBackoff(async () => {
    return await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: prompt,
      config: {
        responseModalities: ["image", "text"],
        creativity: "low",
        generationConfig: {
          temperature: 0,
          topP: 0,
          seed: 12345,
          candidateCount: 1,
        },
      },
    });
  }, 3, 3000, requestId);

  const genDuration = performance.now() - startTime;
  logger.log(`[${requestId}] Gemini response received`, {
    duration: `${genDuration.toFixed(0)}ms`,
    hasCandidates: !!response.candidates,
    candidatesCount: response.candidates?.length,
  });

  // Extract image from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("Gemini 3 Pro did not return any content");
  }

  // Find the image part in the response
  const imagePart = parts.find((part) => part.inlineData);
  if (!imagePart || !imagePart.inlineData) {
    logger.error(`[${requestId}] No image data in response parts`, { partsCount: parts.length });
    throw new Error("Gemini 3 Pro did not return an image");
  }

  logger.log(`[${requestId}] Image extracted from response`, {
    mimeType: imagePart.inlineData.mimeType,
    dataSizeKB: `${(imagePart.inlineData.data.length * 0.75 / 1024).toFixed(1)} KB`,
  });

  return {
    imageData: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}

