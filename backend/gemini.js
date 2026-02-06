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
    "coloring": { "primary": "" },
    "hairstyle": { "primary": "" },
    "body_type": { "primary": "" },
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
    "coloring": { "primary": "" },
    "hairstyle": { "primary": "" },
    "body_type": { "primary": "" },
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

  const prompt = `(Masterpiece), Studio Ghibli art style.

CRITICAL RULE: Physical traits (Skin, Face, Body, Glasses, facial hair) must be EXACT matches, overriding style defaults.

CRITICAL GLASSES RULE: If "NONE" is specified for glasses below, DO NOT draw any eyewear, spectacles, or frames whatsoever. This overrides all other instructions.

CRITICAL FACIAL EXPRESSION: Both Bride and Groom must have a warm joyous smile (gentle upturned lips, calm relaxed eyes). This is mandatory and must not be neutral, serious, or exaggerated.

[SCENE]: Full-body shot, Bride and Groom standing side-by-side, holding hands, front-facing.

[BACKGROUND]: Pure white background only. No shadows, no props.



[SUBJECT 1: BRIDE - STRICT FEATURES]

Skin Tone: ${getPrimary(bride?.skin_color)} (exact shade)

Body Shape: ${getPrimary(bride?.body_shape)}

Face Shape: ${getPrimary(bride?.face_shape)}

Hair: ${getPrimary(bride?.hairstyle)}${bride?.hair_color?.primary ? `, ${getPrimary(bride.hair_color)}` : ''}

Glasses: ${getPrimary(bride?.spectacles, 'none') === 'none' ? 'NONE - DO NOT DRAW ANY GLASSES, SPECTACLES, OR EYEWEAR OF ANY KIND' : getPrimary(bride?.spectacles, 'none')} ${getPrimary(bride?.spectacles, 'none') !== 'none' ? '(Must draw exactly as specified)' : ''}

Height: ${getPrimary(bride?.height)}



[SUBJECT 2: GROOM - STRICT FEATURES]

Skin Tone: ${getPrimary(groom?.skin_color)} (exact shade)

Body Shape: ${getPrimary(groom?.body_shape)}

Face Shape: ${getPrimary(groom?.face_shape)}

Hair: ${getPrimary(groom?.hairstyle)}${groom?.hair_color?.primary ? `, ${getPrimary(groom.hair_color)}` : ''}

Facial Hair: ${getPrimary(groom?.facial_hair_style)}

Glasses: ${getPrimary(groom?.spectacles, 'none') === 'none' ? 'NONE - DO NOT DRAW ANY GLASSES, SPECTACLES, OR EYEWEAR OF ANY KIND' : getPrimary(groom?.spectacles, 'none')} ${getPrimary(groom?.spectacles, 'none') !== 'none' ? '(Must draw exactly as specified)' : ''}

Height: ${getPrimary(groom?.height)}



[ATTIRE DETAILS]

Bride: Soft blush pink Lehenga Choli, A-line skirt with rose/teal/gold floral embroidery. Sheer pink dupatta with gold border. Traditional gold jewelry.

Groom: Cream Jodhpuri Sherwani with teal peacock embroidery on left chest. Maroon velvet dupatta (right shoulder). White Churidar. Golden Mojari shoes.



[STYLE TAGS]

Cel shading, hand-drawn aesthetic, gentle lighting, warm colors, sharp focus, high definition.`;

  logger.log(`[${requestId}] Generating with prompt`, { promptLength: prompt.length });

  // Prepare system instruction
  const systemInstruction = {
    role: "system",
    parts: [{ text: "You are a technical illustrator generating character images. ABSOLUTE OVERRIDE RULE: All explicitly provided character attributes MUST be rendered exactly as specified in the prompt, with zero deviation, inference, beautification, averaging, or stylistic substitution. PRIMARY RULE – PHYSICAL ACCURACY: Render skin tone, body shape, face shape, hair style, height, glasses, hair color and facial hair EXACTLY as described for each subject. CRITICAL GLASSES RULE: When 'NONE' is specified for glasses, you MUST NOT draw any glasses, spectacles, eyewear, or frames of any kind whatsoever. This is a hard requirement - no exceptions. When a specific glasses type IS specified, draw it exactly. Heights must be visually respected relative to each other. No feature blending or ambiguity is allowed. STYLE RULE: Apply Studio Ghibli–inspired cel shading and line work ONLY as a rendering technique. Style must NEVER alter proportions, facial structure, skin tone, or other physical attributes. BACKGROUND RULE: Use a pure white background (#FFFFFF) only. No gradients, no shadows, no props, no environmental elements. EXPRESSION RULE: Both subjects must have joyous, warm smiles with relaxed eyes. Expression must not change facial structure." }]
  };

  // Prepare generation config
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

