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

/**
 * Analyze a couple photo using ChatGPT (GPT-4 Vision) to extract detailed descriptions
 */
async function analyzePhoto(photo, requestId = "") {
  logger.log(`[${requestId}] Starting photo analysis with ChatGPT`, {
    photoMimetype: photo?.mimetype,
    photoBufferLen: photo?.buffer?.length,
  });
  const analysisPrompt = `You are an expert visual analyst extracting structured human appearance attributes from a single photo of a couple (bride and groom).
Your goal is to infer the most likely visible physical attributes based strictly on what is observable in the image.

### Rules

* Do NOT return "unknown", "not visible", or null.
* Always prefer visual evidence over cultural assumptions.
* Use natural human categories, not numeric RGB or overly technical values.
* If face/body is partially occluded, infer from visible proportions, posture, and context.
* Output must be valid JSON only.
* Be EXTREMELY precise and detailed for skin_color, hairstyle, and eye_size - these are critical attributes.

---

### Extract the following attributes

For **Bride**:

* height
* skin_color (be very precise - include exact shade and undertone)
* hairstyle
* eye_color
* eye_size
* body_shape
* face_shape
* spectacles

For **Groom**:

* height
* skin_color (be very precise - include exact shade and undertone)
* hairstyle (be very detailed - include exact style, length, texture, parting)
* eye_color
* eye_size
* body_shape
* facial_hair_style
* face_shape
* spectacles

---

### Attribute Guidelines

#### Height (relative, visual)

Choose from:

* very short
* short
* average
* tall
* very tall
  Base this on body proportions and comparison between bride and groom.

#### Skin color (BE VERY PRECISE)

Based strictly on what is visible. Provide a DETAILED description including:
- Exact shade: very fair, fair, light, light-medium, medium, medium-tan, tan, olive, caramel, brown, dark brown, deep brown, ebony
- Undertone: warm (golden/yellow), cool (pink/red), neutral, olive
- Any visible characteristics: rosy cheeks, even tone, etc.

Example formats:
* "light-medium skin with warm golden undertone"
* "fair skin with cool pink undertone"
* "medium tan skin with olive undertone"
* "caramel brown skin with warm undertone"
* "deep brown skin with neutral undertone"

Be lighting-aware but still provide the most accurate assessment of actual skin tone.

#### Hairstyle (BE VERY DETAILED, especially for Groom)

Describe with maximum detail including:
- Length: very short, short, medium, long, very long
- Style: straight, wavy, curly, coily, spiky, slicked back, side-parted, center-parted, pompadour, undercut, fade, crew cut, etc.
- Texture: fine, medium, thick, coarse
- Volume: flat, normal, voluminous
- Any specific characteristics: side-swept bangs, layers, tapered sides, etc.

Example formats for Groom:
* "short black hair with side part, tapered sides, medium texture, neatly combed"
* "medium-length wavy dark brown hair, swept back, thick and voluminous"
* "very short buzz cut, dark hair, clean and even"
* "short spiky black hair with textured top, faded sides"

Example formats for Bride:
* "long straight black hair, center-parted, falling past shoulders"
* "medium-length wavy brown hair with soft layers"

#### Eye color

Choose visible category:

* dark brown
* brown
* light brown
* hazel
* green
* blue
* grey
  If lighting affects perception, mention that.

#### Eye size

Describe the relative size and shape of eyes:

* small
* small-medium
* medium
* medium-large
* large
* very large

Also include eye shape characteristics:
* almond-shaped
* round
* hooded
* monolid
* upturned
* downturned
* wide-set
* close-set

Example formats:
* "medium-large, almond-shaped"
* "large, round and expressive"
* "small-medium, hooded"
* "medium, monolid"

#### Body shape

Choose from:

* slim
* athletic
* average
* curvy
* stocky
* broad
  Use clothing silhouette + posture to infer.

+ #### Face shape (CRITICAL: be anatomically precise)
+
+ Choose ONLY one from:
+ * oval
+ * round
+ * square
+ * heart
+ * diamond
+ * oblong
+
+ Determine using ALL of:
+ - Relative width of forehead vs jaw
+ - Jaw angularity (rounded vs sharp)
+ - Cheekbone prominence
+ - Face length vs width ratio
+
+ Do NOT guess loosely. If borderline, choose the closest dominant geometry.
+ Do NOT output mixed or compound labels.#### Facial hair style (groom)

Describe clearly and visually with detail:
* Clean-shaven
* Light stubble
* Heavy stubble
* Short beard
* Medium beard
* Full beard
* Goatee
* Mustache only
* Soul patch
* Van Dyke
* Anchor beard

Include any specifics about grooming, shape, or thickness.

#### Spectacles

Choose from:

* none
* rectangular frames
* round frames
* oval frames
* cat-eye frames
* aviator frames
* rimless
* half-rim
  If wearing glasses, also note the frame color (e.g. "round frames, gold metal" or "rectangular frames, black plastic").

---

### Output Format (JSON only)

{
  "bride": {
    "height": {
      "primary": ""
    },
    "skin_color": {
      "primary": ""
    },
    "hairstyle": {
      "primary": ""
    },
    "eye_color": {
      "primary": ""
    },
    "eye_size": {
      "primary": ""
    },
    "body_shape": {
      "primary": ""
    },
    "face_shape": {
      "primary": ""
    },
    "spectacles": {
      "primary": ""
    }
  },
  "groom": {
    "height": {
      "primary": ""
    },
    "skin_color": {
      "primary": ""
    },
    "hairstyle": {
      "primary": ""
    },
    "eye_color": {
      "primary": ""
    },
    "eye_size": {
      "primary": ""
    },
    "body_shape": {
      "primary": ""
    },
    "facial_hair_style": {
      "primary": ""
    },
    "face_shape": {
      "primary": ""
    },
    "spectacles": {
      "primary": ""
    }
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
    duration: `${apiDuration.toFixed(0)}ms`,
    hasChoices: !!response.choices,
    choicesLen: response.choices?.length,
    finishReason: response.choices?.[0]?.finish_reason,
    totalTokens: response.usage?.total_tokens,
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
      logger.error(`[${requestId}] Content policy refusal detected`, responseText.slice(0, 200));
      throw new Error("The AI could not analyze the photos. Please try with different photos or ensure faces are clearly visible.");
    }
    logger.error(`[${requestId}] Failed to parse JSON from response`, responseText.slice(0, 300));
    throw new Error("Failed to parse photo analysis");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  logger.log(`[${requestId}] Photo analysis complete`, {
    hasBride: !!parsed.bride,
    hasGroom: !!parsed.groom,
  });

  return parsed;
}

/**
 * Evaluate a generated wedding image using GPT-4 Vision against the quality framework
 * Uses soft gating rules that only reject when multiple rules are violated or one is severe.
 * Returns { passed: boolean, score: number, softRulesPassed: boolean, softRulesViolations: string[], recommendation: string, details: object }
 */
async function evaluateGeneratedImage(imageBase64, mimeType, requestId = "") {
  logger.log(`[${requestId}] Starting image evaluation with GPT-4o`);
  const evaluationPrompt = `You are an expert image quality evaluator for wedding invitation illustrations.
Evaluate the provided image against this framework and return a structured JSON response.

Your goal is to penalize deviations proportionally, rejecting only when the image clearly fails to meet wedding-invite suitability — except for the mandatory human/two-character rules below.

1. HARD INVARIANTS (Auto-Reject if violated)

These must always be satisfied.

1.1 Subject Integrity

The image must contain exactly two characters only

Both characters must be clearly human

No animals, humanoid creatures, dolls, mannequins, fantasy beings, silhouettes, or partial figures

No third person, reflections of people, background figures, or framed portraits

Any violation → immediate REJECT.

2. SOFT GATING RULES (Reject only if MULTIPLE violated or one is severe)

These are high-priority constraints, but allow minor, non-distracting variance.

2.1 Composition & Background

Background should be plain white or near-white (very subtle gradients allowed)

No prominent props, furniture, scenery, or extra people

No visible text, logos, watermarks, or UI artifacts

Both characters should be mostly visible (minor cropping allowed if feet/hair slightly clipped)

2.2 Pose & Camera

Prefer standing side-by-side

Prefer holding hands or clear visual pairing

Mostly forward-facing (slight 3/4 acceptable)

No extreme camera angles or perspective distortion

No dynamic actions like dancing/running

2.3 Attire Guidance (Penalize drift, don’t auto-fail)

Minor deviations in fabric shade, embroidery density, or placement are acceptable if the overall look remains clearly bridal.

Groom expected:

Knee-length sherwani in light beige/cream tones

Golden floral pattern preferred

Teal peacock embroidery or equivalent Indian motif

Deep magenta/maroon dupatta with gold accents

White or off-white churidar

Traditional mojaris/juttis

Bride expected:

Lehenga choli in blush/pastel pink family

Voluminous A-line lehenga with floral/mandala embroidery

Matching blouse with floral threadwork

Light pink sheer dupatta with gold border

Gold jewelry set (necklace, jhumkas, maang tikka)

3. ATTRIBUTE FIDELITY (40 points max)

Score each from 0–5
(5 = strong match, 3 = acceptable variance, 0 = incorrect/missing)

Bride (20 pts):
height, skin_color, hairstyle, eye_color, eye_size, body_shape, face_shape, spectacles

Groom (20 pts):
height, skin_color, hairstyle, eye_color, eye_size, body_shape, facial_hair, face_shape, spectacles

Notes:

Skin color should broadly match tone family; exact undertone mismatch is a minor penalty.

Groom hairstyle should be broadly consistent in length and form; texture mismatches are minor.

4. POSE, EXPRESSION & EMOTIONAL ACCURACY (15 points max)

Pose Accuracy (5): Natural couple stance, visually paired

Expression (5): Pleasant, wedding-appropriate (neutral acceptable; dull or exaggerated penalized)

Cultural Appropriateness (5): Indian wedding appropriate, minimal Western stylization

5. STYLE COMPLIANCE: GHIBLI-INSPIRED (20 points max)

Visual Language (10): Soft shading, gentle outlines, warm light, expressive eyes

Stylization Control (10): Semi-realistic with light stylization; avoid chibi, caricature, or hyper-real textures

Hybrid styles are allowed if Ghibli influence is clearly readable.

6. RENDERING & VISUAL QUALITY (15 points max)

Technical Cleanliness (5): No major glitches or broken anatomy

Edge & Detail Quality (5): Clean silhouettes, legible embroidery/jewelry

Color Discipline (5): Harmonious palette; avoid neon or muddy colors

7. COMPOSITION & BALANCE (10 points max)

Bride and groom visually balanced

Centered or near-centered composition

No strong edge crowding

White space reasonably even

OUTPUT FORMAT (JSON only)
{
  "hard_invariants": {
    "passed": true/false,
    "violations": ["list of violations if any"]
  },
  "soft_rules": {
    "passed": true/false,
    "violations": ["list of major or multiple violations if any"]
  },
  "scores": {
    "attribute_fidelity": {
      "bride": {"height": 0-5, "skin_color": 0-5, "hairstyle": 0-5, "eye_color": 0-5, "eye_size": 0-5, "body_shape": 0-5, "face_shape": 0-5, "spectacles": 0-5},
      "groom": {"height": 0-5, "skin_color": 0-5, "hairstyle": 0-5, "eye_color": 0-5, "eye_size": 0-5, "body_shape": 0-5, "facial_hair": 0-5, "face_shape": 0-5, "spectacles": 0-5},
      "total": 0-40
    },
    "pose_expression": {
      "pose_accuracy": 0-5,
      "expression": 0-5,
      "cultural_appropriateness": 0-5,
      "total": 0-15
    },
    "style_compliance": {
      "visual_language": 0-10,
      "stylization_control": 0-10,
      "total": 0-20
    },
    "rendering_quality": {
      "technical_cleanliness": 0-5,
      "edge_detail": 0-5,
      "color_discipline": 0-5,
      "total": 0-15
    },
    "composition_balance": {
      "score": 0-10
    },
    "total_score": 0-100
  },
  "skin_color_accuracy": {
    "bride": "description of how well skin tone matches",
    "groom": "description of how well skin tone matches"
  },
  "hairstyle_accuracy": {
    "groom": "description of how well hairstyle matches"
  },
  "issues": ["specific issues found"],
  "recommendation": "ACCEPT" or "REJECT"
}`;

  const startTime = performance.now();
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: evaluationPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const evalDuration = performance.now() - startTime;
    logger.log(`[${requestId}] Evaluation response received`, {
      duration: `${evalDuration.toFixed(0)}ms`,
      totalTokens: response.usage?.total_tokens,
    });

    const responseText = response.choices[0]?.message?.content;
    if (!responseText) {
      logger.error(`[${requestId}] Evaluation returned no response`, "Empty response");
      console.error("[Evaluation] GPT did not return a response");
      return { passed: false, score: 0, softRulesPassed: false, softRulesViolations: ["Evaluation failed"], recommendation: "REJECT", details: null };
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error(`[${requestId}] Failed to parse evaluation JSON`, responseText.slice(0, 200));
      console.error("[Evaluation] Failed to parse evaluation response");
      return { passed: false, score: 0, softRulesPassed: false, softRulesViolations: ["Parse error"], recommendation: "REJECT", details: null };
    }

    const evaluation = JSON.parse(jsonMatch[0]);
    
    const softRulesPassed = evaluation.soft_rules?.passed === true;
    const totalScore = evaluation.scores?.total_score || 0;
    const softRulesViolations = evaluation.soft_rules?.violations || [];
    const recommendation = evaluation.recommendation || (softRulesPassed ? "ACCEPT" : "REJECT");
    
    // Pass if recommendation is ACCEPT, or if soft rules pass and score meets threshold
    // The soft gating framework is more lenient - only reject if multiple rules violated or one is severe
    const passed = recommendation === "ACCEPT" || (softRulesPassed && totalScore >= 75);

    logger.log(`[${requestId}] Evaluation complete`, {
      score: totalScore,
      softRulesPassed,
      recommendation,
      passed,
      softRulesViolations: softRulesViolations.length > 0 ? softRulesViolations : "none",
      issues: evaluation.issues?.length > 0 ? evaluation.issues : "none",
    });

    console.log(`[Evaluation] Score: ${totalScore}/100, Soft rules passed: ${softRulesPassed}, Recommendation: ${recommendation}, Overall: ${passed ? 'PASS' : 'FAIL'}`);
    if (softRulesViolations.length > 0) {
      console.log(`[Evaluation] Soft rule violations: ${softRulesViolations.join(', ')}`);
    }
    if (evaluation.issues?.length > 0) {
      console.log(`[Evaluation] Issues: ${evaluation.issues.join(', ')}`);
    }

    return {
      passed,
      score: totalScore,
      softRulesPassed,
      softRulesViolations,
      recommendation,
      details: evaluation
    };
  } catch (error) {
    logger.error(`[${requestId}] Evaluation error`, error);
    console.error("[Evaluation] Error during evaluation:", error.message);
    // On evaluation error, we'll consider it as failed to be safe
    return { passed: false, score: 0, softRulesPassed: false, softRulesViolations: [`Evaluation error: ${error.message}`], recommendation: "REJECT", details: null };
  }
}

/**
 * Generate image with evaluation and retry logic
 * Attempts up to maxAttempts times, regenerating if evaluation fails
 */
async function generateWithEvaluation(descriptions, maxAttempts = 3, requestId = "") {
  let bestResult = null;
  let bestScore = -1;
  
  logger.log(`[${requestId}] Starting generation with evaluation (max ${maxAttempts} attempts)`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    logger.log(`[${requestId}] Generation attempt ${attempt}/${maxAttempts}`);
    console.log(`[Generator] Generation attempt ${attempt}/${maxAttempts}`);
    
    try {
      // Generate the image
      logger.log(`[${requestId}] Calling Gemini for image generation`);
      const result = await generateWithGemini3(descriptions, requestId);
      
      // Evaluate the generated image
      logger.log(`[${requestId}] Evaluating generated image`);
      console.log(`[Generator] Evaluating generated image (attempt ${attempt})...`);
      const evaluation = await evaluateGeneratedImage(result.imageData, result.mimeType, requestId);
      
      // Track the best result so far
      if (evaluation.score > bestScore) {
        bestScore = evaluation.score;
        bestResult = {
          ...result,
          evaluation
        };
        logger.log(`[${requestId}] New best score: ${bestScore}/100`);
      }
      
      // If evaluation passes, return immediately
      if (evaluation.passed) {
        logger.log(`[${requestId}] Image PASSED evaluation on attempt ${attempt}`, {
          score: evaluation.score,
        });
        console.log(`[Generator] Image passed evaluation on attempt ${attempt} with score ${evaluation.score}/100`);
        return bestResult;
      }
      
      // Log why it failed
      logger.log(`[${requestId}] Attempt ${attempt} FAILED evaluation`, {
        score: evaluation.score,
        softRulesPassed: evaluation.softRulesPassed,
        softRulesViolations: evaluation.softRulesViolations,
        recommendation: evaluation.recommendation,
      });
      console.log(`[Generator] Attempt ${attempt} failed evaluation (score: ${evaluation.score}/100, recommendation: ${evaluation.recommendation})`);
      if (!evaluation.softRulesPassed && evaluation.softRulesViolations?.length > 0) {
        console.log(`[Generator] Soft rule violations: ${evaluation.softRulesViolations.join(', ')}`);
      }
      
      if (attempt < maxAttempts) {
        logger.log(`[${requestId}] Waiting before retry...`);
        console.log(`[Generator] Regenerating with original prompt...`);
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logger.error(`[${requestId}] Attempt ${attempt} error`, error);
      console.error(`[Generator] Attempt ${attempt} failed with error:`, error.message);
      
      if (attempt === maxAttempts) {
        // If this was the last attempt and we have a previous result, return it
        if (bestResult) {
          logger.log(`[${requestId}] Returning best result from previous attempts`, {
            score: bestScore,
          });
          console.log(`[Generator] Returning best result from previous attempts (score: ${bestScore}/100)`);
          return bestResult;
        }
        throw error;
      }
      
      // Wait before retry on error
      logger.log(`[${requestId}] Waiting 2s before retry after error`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // If we've exhausted all attempts but have a result, return the best one
  if (bestResult) {
    logger.log(`[${requestId}] All attempts exhausted, returning best result`, {
      score: bestScore,
      threshold: 85,
    });
    console.log(`[Generator] All ${maxAttempts} attempts completed. Returning best result with score ${bestScore}/100`);
    console.log(`[Generator] Note: Image did not meet acceptance criteria but was the best generated`);
    return bestResult;
  }
  
  throw new Error(`Failed to generate acceptable image after ${maxAttempts} attempts`);
}

/**
 * Retry helper with exponential backoff for transient errors
 */
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
      console.log(`[Gemini3] Attempt ${attempt} failed (${error.status || 'error'}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Generate wedding portrait using Gemini 3 Pro Image Preview
 */
async function generateWithGemini3(descriptions, requestId = "") {
  logger.log(`[${requestId}] Preparing Gemini 3 Pro generation prompt`);
  // Extract values from the new structure (bride/groom with primary/alternates)
  const bride = descriptions.bride;
  const groom = descriptions.groom;

  // Helper to get primary value or fallback
  const getPrimary = (attr, fallback = 'average') => {
    if (!attr) return fallback;
    return attr.primary || fallback;
  };

  const prompt = `Create a full-body, front-facing illustration of a bride and groom in a Studio Ghibli–inspired style (soft, painterly, warm colors, gentle outlines, slightly whimsical but realistic proportions).

The image must contain only the two characters on a pure white background, with no props, no scenery, no text.

CRITICAL: Match the exact skin color and hairstyle descriptions provided below as closely as possible. These are extracted from the actual couple's photo.

Characters (use these parameters EXACTLY)

Bride

Height: ${getPrimary(bride?.height)}

Skin color: ${getPrimary(bride?.skin_color)} (IMPORTANT: Match this exact skin tone precisely - the shade and undertone must be accurate)

Hairstyle: ${getPrimary(bride?.hairstyle)}

Eye color: ${getPrimary(bride?.eye_color)}

Eye size and shape: ${getPrimary(bride?.eye_size, 'medium, almond-shaped')} (render eyes with this exact size and shape)

Body shape: ${getPrimary(bride?.body_shape)}, refined to be ~10% more proportionally idealized while staying natural

Face shape: ${getPrimary(bride?.face_shape)}

Spectacles: ${getPrimary(bride?.spectacles, 'none')}

Groom

Height: ${getPrimary(groom?.height)}

Skin color: ${getPrimary(groom?.skin_color)} (IMPORTANT: Match this exact skin tone precisely - the shade and undertone must be accurate)

Hairstyle: ${getPrimary(groom?.hairstyle)} (IMPORTANT: Reproduce this exact hairstyle with precise length, style, texture, and parting as described)

Eye color: ${getPrimary(groom?.eye_color)}

Eye size and shape: ${getPrimary(groom?.eye_size, 'medium, almond-shaped')} (render eyes with this exact size and shape)

Body shape: ${getPrimary(groom?.body_shape)}, refined to be ~10% more proportionally idealized while staying natural

Facial hair style: ${getPrimary(groom?.facial_hair_style)}

Face shape: ${getPrimary(groom?.face_shape)}

Spectacles: ${getPrimary(groom?.spectacles, 'none')}

Fixed Pose & Expression

The couple is standing side-by-side, holding hands, in an Indian wedding–appropriate pose

Both are facing directly forward

Both look very happy, with warm, joyful expressions

No side profiles, no dynamic angles

Fixed Attire (Do not modify)

Groom Attire

Knee-length structured Sherwani in light beige or cream

Subtle golden floral pattern throughout

Teal peacock embroidery on left chest and lower hem

Deep magenta/maroon velvet dupatta over right shoulder with gold borders and peacock motifs

White Churidar bottoms

Golden tan Mojari/Jutti shoes

Bride Attire

Lehenga Choli in soft blush/pastel pink

Voluminous A-line lehenga with floral embroidery and mandala patterns in rose pink, teal, and gold

Matching blouse with delicate floral threadwork

Light pink sheer dupatta with gold-embroidered border

Traditional Indian gold jewelry: layered necklace, oversized jhumkas, pearl maang tikka

Style Constraints

Ghibli-inspired aesthetic: soft shading, rounded facial features, expressive eyes, gentle light

Proportions realistic but slightly stylized

Clean edges, no chibi, no hyper-realism, no caricature

Balanced symmetry between bride and groom

Output Rules

Only the two characters

White background only

No scenery, furniture, or decorations

No text or logos

Full-body visible, from head to toe`;

  logger.log(`[${requestId}] Prompt prepared`, {
    promptLength: prompt.length,
    brideHeight: descriptions.bride?.height?.primary,
    brideSkinColor: descriptions.bride?.skin_color?.primary,
    brideEyeSize: descriptions.bride?.eye_size?.primary,
    groomHeight: descriptions.groom?.height?.primary,
    groomSkinColor: descriptions.groom?.skin_color?.primary,
    groomHairstyle: descriptions.groom?.hairstyle?.primary,
    groomEyeSize: descriptions.groom?.eye_size?.primary,
  });
  console.log("[Gemini3] Generating with prompt:", prompt.slice(0, 200) + "...");

  // Use retry logic for transient API errors (503, 429)
  const startTime = performance.now();
  const response = await retryWithBackoff(async () => {
    return await genAI.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: prompt,
      config: {
        responseModalities: ["image", "text"],
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
    logger.error(`[${requestId}] No content parts in response`, response);
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

/**
 * Main function: Analyze photo with ChatGPT, generate with Gemini 3 Pro, evaluate and retry if needed
 */
export async function generateWeddingCharacters(photo, requestId = "") {
  const totalStartTime = performance.now();
  
  logger.log(`[${requestId}] ========== STARTING WEDDING PORTRAIT GENERATION ==========`);
  console.log("[Generator] Starting wedding portrait generation");
  
  // Step 1: Analyze photo to extract descriptions using ChatGPT
  logger.log(`[${requestId}] STEP 1: Analyzing photo with ChatGPT`);
  console.log("[Generator] Step 1: Analyzing photo with ChatGPT...");
  
  const analysisStartTime = performance.now();
  const descriptions = await analyzePhoto(photo, requestId);
  const analysisDuration = performance.now() - analysisStartTime;
  
  logger.log(`[${requestId}] STEP 1 COMPLETE: Photo analysis done`, {
    duration: `${analysisDuration.toFixed(0)}ms`,
    brideAttributes: Object.keys(descriptions.bride || {}),
    groomAttributes: Object.keys(descriptions.groom || {}),
  });
  console.log("[Generator] Photo analysis complete:", JSON.stringify(descriptions, null, 2));

  // Step 2: Generate with Gemini 3 Pro, evaluate with GPT-4 Vision, retry up to 3 times if needed
  logger.log(`[${requestId}] STEP 2: Generating image with Gemini 3 Pro (with evaluation & retry)`);
  console.log("[Generator] Step 2: Generating image with Gemini 3 Pro (with evaluation & retry)...");
  
  const generationStartTime = performance.now();
  const result = await generateWithEvaluation(descriptions, 3, requestId);
  const generationDuration = performance.now() - generationStartTime;

  const totalDuration = performance.now() - totalStartTime;
  
  logger.log(`[${requestId}] ========== GENERATION COMPLETE ==========`, {
    totalDuration: `${totalDuration.toFixed(0)}ms`,
    analysisDuration: `${analysisDuration.toFixed(0)}ms`,
    generationDuration: `${generationDuration.toFixed(0)}ms`,
    finalScore: result.evaluation?.score,
    passed: result.evaluation?.passed,
    imageSizeKB: `${(result.imageData.length * 0.75 / 1024).toFixed(1)} KB`,
  });
  
  console.log("[Generator] Generation complete!");
  console.log(`[Generator] Final score: ${result.evaluation?.score || 'N/A'}/100`);
  console.log(`[Generator] Passed evaluation: ${result.evaluation?.passed ? 'YES' : 'NO (best available)'}`);
  
  return {
    imageData: result.imageData,
    mimeType: result.mimeType,
    evaluation: result.evaluation
  };
}
