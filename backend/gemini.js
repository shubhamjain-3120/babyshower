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

// Photo analysis provider (gpt or gemini)
const PHOTO_ANALYSIS_PROVIDER = process.env.PHOTO_ANALYSIS_PROVIDER || "gpt";

//Analyze a couple photo - routes to GPT or Gemini based on env var
export async function analyzePhoto(photo, requestId = "") {
  logger.log(`[${requestId}] Photo analysis provider: ${PHOTO_ANALYSIS_PROVIDER}`);

  if (PHOTO_ANALYSIS_PROVIDER === "gemini") {
    return analyzePhotoWithGemini(photo, requestId);
  } else {
    return analyzePhotoWithGPT(photo, requestId);
  }
}

//Analyze a couple photo using ChatGPT (GPT-4 Vision) to extract detailed descriptions
async function analyzePhotoWithGPT(photo, requestId = "") {
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
**8. Hair Color:** [black, dark brown, brown, light brown, gray, salt and pepper, not visible]. Describe the dominant natural hair color visible in the photo. If hair is covered (hijab, turban, etc.), use "not visible".

### Output JSON Structure
{
  "bride": {
    "height": { "primary": "" },
    "skin_color": { "primary": "" },
    "hairstyle": { "primary": "" },
    "body_shape": { "primary": "" },
    "face_shape": { "primary": "" },
    "spectacles": { "primary": "" },
    "hair_color": { "primary": "" }
  },
  "groom": {
    "height": { "primary": "" },
    "coloring": { "primary": "" },
    "hairstyle": { "primary": "" },
    "body_shape": { "primary": "" },
    "facial_hair_style": { "primary": "" },
    "face_shape": { "primary": "" },
    "spectacles": { "primary": "" },
    "hair_color": { "primary": "" }
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
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a professional image analysis engine. Your task is to extract physical metadata from photos for 3D/stylized character modeling.RULES: 1. ANALYTICAL OBJECTIVITY: Describe exactly what is visible. Avoid complimentary or subjective adjectives (e.g., use \"medium-tan\" instead of \"beautiful tan\"). 2.NO HEDGING: Do not use phrases like \"appears to be\" or \"possibly.\" Make a definitive choice based on visual evidence.3. JSON EXCLUSIVITY: Output ONLY the raw JSON object. Do not include markdown code blocks (\`\`\`), preambles, or post-analysis notes.4. SCHEMA ADHERENCE: Use the exact vocabulary provided in the prompt. If a feature is partially obscured, infer the most likely match based on overall proportions.", // Add system instruction here
        },
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            ...imageContent,
          ],
        },
      ],
    response_format: { type: "json_object" },
      temperature: 0,
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

  // Validate hair_color values
  const validHairColors = ["black", "dark brown", "brown", "light brown", "gray", "salt and pepper", "not visible"];
  if (parsed.bride?.hair_color?.primary && !validHairColors.includes(parsed.bride.hair_color.primary)) {
    logger.log(`[${requestId}] Invalid bride hair_color "${parsed.bride.hair_color.primary}", defaulting to "black"`);
    parsed.bride.hair_color.primary = "black";
  }
  if (parsed.groom?.hair_color?.primary && !validHairColors.includes(parsed.groom.hair_color.primary)) {
    logger.log(`[${requestId}] Invalid groom hair_color "${parsed.groom.hair_color.primary}", defaulting to "black"`);
    parsed.groom.hair_color.primary = "black";
  }

  logger.log(`[${requestId}] Photo analysis complete`, {
    hasBride: !!parsed.bride,
    hasGroom: !!parsed.groom,
    brideHairColor: parsed.bride?.hair_color?.primary,
    groomHairColor: parsed.groom?.hair_color?.primary,
  });

  return parsed;
}

//Analyze a couple photo using Gemini (Gemini 2.0 Flash) to extract detailed descriptions
async function analyzePhotoWithGemini(photo, requestId = "") {
  logger.log(`[${requestId}] Starting photo analysis with Gemini`, {
    photoMimetype: photo?.mimetype,
    photoBufferLen: photo?.buffer?.length,
  });

  const analysisPrompt = `Role: Technical Art Director. Analyze the image to extract strict physical attribute data for a Studio Ghibli style illustration.

### Constraints
1. Output valid JSON only.
2. NO "unknown" or "null" values. Infer from context/proportions if partially visible.
3. Use the specific vocabulary lists provided below.

### Reference Criteria

**1. Height:** [Very Short, Short, Average, Tall, Very Tall] (Relative to each other).
**2. Skin Tone:** Select the closest match:
   - [Very Fair, Fair, Light, Medium, Olive, Tan, Brown, Dark Brown, Deep Black].
   - *Note: Focus on the base value suitable for cel-shaded coloring.*
**3. Hairstyle:** Detailed description of Length, Style, Texture, and Volume.
   - Groom specific: Fade, undercut, side-part, slick-back, etc.
**4. Body Shape:** [Slim, Athletic, Average, Curvy, Stocky, Broad, Soft].
**5. Face Shape:** [Oval, Round, Square, Heart, Diamond, Oblong].
**6. Facial Hair (Groom):** [Clean-shaven, Stubble, Short Beard, Full Beard, Goatee, Mustache, Soul patch].
**7. Spectacles:** [none, rectangular frames, round frames, oval frames, cat-eye frames, aviator frames, rimless glasses]. 
   - *CRITICAL:* If no glasses are clearly visible, output "none".
**8. Hair Color:** [Black, Dark Brown, Brown, Auburn, Red, Blonde, Gray, White]. 
   - *Note: Identify the dominant natural hair color.*

### Output JSON Structure
{
  "bride": {
    "height": { "primary": "" },
    "skin_color": { "primary": "" }, // Renamed from 'coloring' to match Generation
    "hairstyle": { "primary": "" },
    "body_shape": { "primary": "" }, // Renamed from 'body_type' to match Generation
    "face_shape": { "primary": "" },
    "spectacles": { "primary": "" },
    "hair_color": { "primary": "" }
  },
  "groom": {
    "height": { "primary": "" },
    "skin_color": { "primary": "" }, // Renamed from 'coloring' to match Generation
    "hairstyle": { "primary": "" },
    "body_shape": { "primary": "" },
    "facial_hair_style": { "primary": "" },
    "face_shape": { "primary": "" },
    "spectacles": { "primary": "" },
    "hair_color": { "primary": "" }
  }
}
`;


  // Build image content for Gemini
  const imagePart = {
    inlineData: {
      mimeType: photo.mimetype,
      data: photo.buffer.toString("base64"),
    },
  };

  logger.log(`[${requestId}] Calling Gemini 2.0 Flash for photo analysis`);
  const startTime = performance.now();

  let response;
  try {
    response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      systemInstruction: {
        role: "system",
        parts: [
          {
            text: "You are a professional image analysis engine. Your task is to extract physical metadata from photos for 3D/stylized character modeling. RULES: 1. ANALYTICAL OBJECTIVITY: Describe exactly what is visible. Avoid complimentary or subjective adjectives (e.g., use \"medium-tan\" instead of \"beautiful tan\"). 2. NO HEDGING: Do not use phrases like \"appears to be\" or \"possibly.\" Make a definitive choice based on visual evidence. 3. JSON EXCLUSIVITY: Output ONLY the raw JSON object. Do not include markdown code blocks (```), preambles, or post-analysis notes. 4. SCHEMA ADHERENCE: Use the exact vocabulary provided in the prompt. If a feature is partially obscured, infer the most likely match based on overall proportions.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: analysisPrompt },
            imagePart,
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
      },
    });
  } catch (apiError) {
    logger.error(`[${requestId}] Gemini API call failed`, apiError);
    throw apiError;
  }

  const apiDuration = performance.now() - startTime;
  logger.log(`[${requestId}] Gemini response received`, {
    duration: `${apiDuration.toFixed(0)}ms`,
  });

  const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;

  logger.log(`[${requestId}] Parsing response`, {
    responseTextLen: responseText?.length,
    responseTextPreview: responseText?.slice(0, 200) + "...",
  });

  if (!responseText) {
    logger.error(`[${requestId}] No response text from Gemini`, "Empty response");
    throw new Error("Gemini did not return a response");
  }

  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  logger.log(`[${requestId}] JSON extraction`, {
    jsonMatchFound: !!jsonMatch,
    jsonMatchLen: jsonMatch?.[0]?.length,
  });

  if (!jsonMatch) {
    // Check if this is a content policy refusal
    if (
      responseText.toLowerCase().includes("sorry") ||
      responseText.toLowerCase().includes("can't") ||
      responseText.toLowerCase().includes("cannot")
    ) {
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

  // Validate hair_color values
  const validHairColors = ["black", "dark brown", "brown", "light brown", "gray", "salt and pepper", "not visible"];
  if (parsed.bride?.hair_color?.primary && !validHairColors.includes(parsed.bride.hair_color.primary)) {
    logger.log(`[${requestId}] Invalid bride hair_color "${parsed.bride.hair_color.primary}", defaulting to "black"`);
    parsed.bride.hair_color.primary = "black";
  }
  if (parsed.groom?.hair_color?.primary && !validHairColors.includes(parsed.groom.hair_color.primary)) {
    logger.log(`[${requestId}] Invalid groom hair_color "${parsed.groom.hair_color.primary}", defaulting to "black"`);
    parsed.groom.hair_color.primary = "black";
  }

  logger.log(`[${requestId}] Photo analysis complete`, {
    hasBride: !!parsed.bride,
    hasGroom: !!parsed.groom,
    brideHairColor: parsed.bride?.hair_color?.primary,
    groomHairColor: parsed.groom?.hair_color?.primary,
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

    // HELPER: The "Pink Elephant" Fix
    const getEyeRegionPrompt = (spectaclesRaw) => {
      const specs = getPrimary(spectaclesRaw, 'none');

      if (specs === 'none') {
        // STRATEGY: Silence + Positive Anatomy
        // 1. Don't mention "glasses" or "eyewear".
        // 2. Force the renderer to draw skin where the bridge would be.
        return "Clear, unobstructed view of the bridge of the nose and cheeks. Bare face.";
      } else {
        // If glasses exist, strictly enforce them.
        return `Wearing ${specs}. (Strict Rule: Must draw exactly these glasses).`;
      }
    };

    const prompt = `
    # ART STYLE
    Studio Ghibli anime style (Hand-drawn aesthetic, cel shading).
    (Masterpiece), High Definition.

    # SCENE
    Full-body shot, Bride and Groom standing side-by-side, holding hands, front-facing.
    Background: Pure white (#FFFFFF).

    # SUBJECT 1: BRIDE
    - Expression: Warm, joyous smile (gentle upturned lips).
    - Skin Tone: ${getPrimary(bride?.skin_color)}
    - Face Shape: ${getPrimary(bride?.face_shape)}
    - Eye Region: ${getEyeRegionPrompt(bride?.spectacles)} <--- LOGIC APPLIED HERE
    - Hair: ${getPrimary(bride?.hairstyle)}
    - Body: ${getPrimary(bride?.body_shape)}
    - Attire: Blush pink Lehenga Choli, floral embroidery.

    # SUBJECT 2: GROOM
    - Expression: Warm, joyous smile (gentle upturned lips).
    - Skin Tone: ${getPrimary(groom?.skin_color)}
    - Face Shape: ${getPrimary(groom?.face_shape)}
    - Eye Region: ${getEyeRegionPrompt(groom?.spectacles)} <--- LOGIC APPLIED HERE
    - Hair: ${getPrimary(groom?.hairstyle)}
    - Facial Hair: ${getPrimary(groom?.facial_hair_style)}
    - Attire: Cream Jodhpuri Sherwani, teal embroidery.
    
    # ATTIRE DETAILS

    Bride: Soft blush pink Lehenga Choli, A-line skirt with rose/teal/gold floral embroidery. Sheer pink dupatta with gold border. Traditional gold jewelry.

    Groom: Cream Jodhpuri Sherwani with teal peacock embroidery on left chest. Maroon velvet dupatta (right shoulder). White Churidar. Golden Mojari shoes.

    `;

    // System Instruction: Clean and Affirmative
    // Removed all mentions of "NO GLASSES" to avoid priming the token.
    const systemInstruction = {
      role: "system",
      parts: [{
        text: "You are an forensic sketch artist. Render attributes EXACTLY as described. \n\nCRITICAL RULES:\n1. SMILE: Characters must have warm smiles.\n2. ANATOMY: Stick to the specific skin tone, hair, and body shape provided.\n3. FIDELITY: If a feature is described (like a beard or specific clothing), draw it. If a feature is omitted or described as 'bare' or 'unobstructed', do not add accessories to that area."
      }]
    };

  const generationConfig = {
      temperature: 0,
         topP: 0.1,
         seed: 12345,
         topK: 1,
         candidateCount: 1,
  };

  // Log full payload
  logger.log(`[${requestId}] Full Gemini API Payload:`, {
    model: "gemini-2.5-flash-image",
    systemInstruction: JSON.stringify(systemInstruction, null, 2),
    prompt: prompt,
    generationConfig: JSON.stringify(generationConfig, null, 2),
    promptCharCount: prompt.length,
  });

  // Use retry logic for transient API errors (503, 429)
  const startTime = performance.now();
  const response = await retryWithBackoff(async () => {
    return await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      systemInstruction: systemInstruction,
      contents: prompt,
      generationConfig: generationConfig,
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

