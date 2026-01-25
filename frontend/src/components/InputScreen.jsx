import { useState, useEffect, useMemo } from "react";
import useSpeechRecognition from "../hooks/useSpeechRecognition";
import { createDevLogger } from "../utils/devLogger";
import { trackPageView, trackClick } from "../utils/analytics";
import { getRateLimitState, formatResetTime, getMaxGenerations } from "../utils/rateLimit";

const logger = createDevLogger("InputScreen");

/**
 * Phase 6: Single Photo Mode
 *
 * Changes from Phase 5:
 * - Only require 1 photo (couple photo with both groom and bride)
 * - Native date picker
 * - Cleaner photo upload UX
 * - Proper cleanup of Object URLs to prevent memory leaks
 */

// LocalStorage key for caching form data
const CACHE_KEY = "wedding-invite-form-cache";

// Secret venue name that enables dev mode
const DEV_MODE_VENUE = "Hotel Jain Ji Shubham";

// Character limits for input fields
const CHAR_LIMITS = {
  name: 50,
  venue: 150,
};

// Sanitize user input to prevent XSS and injection attacks
const sanitizeInput = (input) => {
  if (!input) return "";
  return input
    .replace(/[<>]/g, "") // Remove angle brackets (XSS prevention)
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, "") // Remove event handlers like onclick=
    .trim();
};

// Validate file before upload
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const validateFile = (file) => {
  if (!file) return { valid: false, error: "No file selected" };
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum size is 10MB." };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { valid: false, error: "Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image." };
  }
  return { valid: true };
};

// Format date for invite display
function formatDateForInvite(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const options = { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("en-IN", options);
}

// Load cached form data from localStorage
function loadCachedFormData() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn("Failed to load cached form data:", e);
  }
  return null;
}

// Save form data to localStorage
function saveCachedFormData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save form data to cache:", e);
  }
}

export default function InputScreen({
  onGenerate,
  error,
  photo,              // Passed from App (from PhotoUploadScreen)
}) {
  // Rate limit state
  const [rateLimit, setRateLimit] = useState(() => getRateLimitState());
  
  // Track page view on mount and check rate limit
  useEffect(() => {
    trackPageView('input');
    // Refresh rate limit state on mount (in case time passed)
    setRateLimit(getRateLimitState());
  }, []);

  // Load cached data on initial render
  const cachedData = useMemo(() => loadCachedFormData(), []);

  // Form fields - initialize from cache if available
  const [brideName, setBrideName] = useState(cachedData?.brideName || "");
  const [groomName, setGroomName] = useState(cachedData?.groomName || "");
  const [weddingDate, setWeddingDate] = useState(cachedData?.weddingDate || "");
  const [venue, setVenue] = useState(cachedData?.venue || "");

  // Save form data to cache whenever it changes
  useEffect(() => {
    saveCachedFormData({ brideName, groomName, weddingDate, venue });
  }, [brideName, groomName, weddingDate, venue]);

  // Dev mode - enabled automatically when venue matches secret phrase
  const devMode = useMemo(() => {
    return venue.trim().toLowerCase() === DEV_MODE_VENUE.toLowerCase();
  }, [venue]);

  // Dev mode toggles - control which steps to skip
  const [skipExtraction, setSkipExtraction] = useState(false);
  const [skipImageGeneration, setSkipImageGeneration] = useState(false);
  const [skipBackgroundRemoval, setSkipBackgroundRemoval] = useState(false);
  const [skipVideoGeneration, setSkipVideoGeneration] = useState(false);
  const [forceServerConversion, setForceServerConversion] = useState(false);


  // Voice input
  const { isListening, activeField, startListening, stopListening, isSupported } =
    useSpeechRecognition();

  // Handle voice input for a field
  const handleVoiceInput = (fieldId, setter) => {
    if (isListening && activeField === fieldId) {
      stopListening();
    } else {
      trackClick('voice_input_start', { field_name: fieldId });
      startListening(fieldId, setter);
    }
  };

  // Derived values
  const hasPhoto = photo !== null;

  // Create and manage Object URL for photo preview
  // This prevents memory leaks by cleaning up old URL when photo changes
  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();

    logger.log("Form submission started", {
      devMode,
      hasPhoto: !!photo,
    });

    // Check rate limit (refresh state first)
    const currentLimit = getRateLimitState();
    setRateLimit(currentLimit);
    
    if (!currentLimit.canGenerate && !devMode) {
      logger.warn("Rate limit", "Generation limit reached");
      alert(`You've reached the limit of ${getMaxGenerations()} invites per week. Please try again in ${formatResetTime(currentLimit.resetAt)}.`);
      return;
    }

    if (!brideName.trim() || !groomName.trim() || !weddingDate || !venue.trim()) {
      logger.warn("Form validation", "Missing required fields");
      alert("Please fill all fields");
      return;
    }

    // Photo comes from props (already validated in PhotoUploadScreen)
    if (!photo) {
      logger.warn("Form validation", "Photo required - should not happen");
      alert("No photo selected. Please go back and upload a photo.");
      return;
    }

    // Sanitize all user inputs before submission
    const formData = {
      brideName: sanitizeInput(brideName),
      groomName: sanitizeInput(groomName),
      date: formatDateForInvite(weddingDate),
      venue: sanitizeInput(venue),
      photo, // Single couple photo
      devMode, // Whether to skip API
      characterFile: devMode ? photo : null, // In dev mode, use photo as character file
      // Dev mode toggles
      skipExtraction: devMode ? skipExtraction : false,
      skipImageGeneration: devMode ? skipImageGeneration : false,
      skipBackgroundRemoval: devMode ? skipBackgroundRemoval : false,
      skipVideoGeneration: devMode ? skipVideoGeneration : false,
      forceServerConversion: devMode ? forceServerConversion : false,
    };

    logger.log("Form validation passed, calling onGenerate", {
      brideName: formData.brideName,
      groomName: formData.groomName,
      date: formData.date,
      venue: formData.venue,
      devMode: formData.devMode,
      skipExtraction: formData.skipExtraction,
      skipImageGeneration: formData.skipImageGeneration,
      skipBackgroundRemoval: formData.skipBackgroundRemoval,
      skipVideoGeneration: formData.skipVideoGeneration,
      forceServerConversion: formData.forceServerConversion,
      photoSize: photo ? `${(photo.size / 1024).toFixed(1)} KB` : null,
    });

    trackClick('generate_submit', { dev_mode: devMode });
    onGenerate(formData);
  };

  return (
    <div className="input-screen">
      {error && <div className="error-banner">{error}</div>}

      {/* Hero headline */}
      <div className="hero-container" style={{ marginBottom: '20px' }}>
        <div className="sample-video-value-hindi">
          <label>शादी की जानकारी भरें</label>
          <p className="form-hint">Fill in your wedding details</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="form">
        {/* Names Section */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="groomName">Groom Name / दूल्हे का नाम</label>
            <div className="input-with-voice">
              <input
                type="text"
                id="groomName"
                value={groomName}
                onChange={(e) => setGroomName(e.target.value)}
                placeholder="Enter groom's name"
                autoComplete="off"
                autoCapitalize="words"
                inputMode="text"
                maxLength={CHAR_LIMITS.name}
                required
              />
              {isSupported && (
                <button
                  type="button"
                  className={`voice-btn ${isListening && activeField === "groomName" ? "listening" : ""}`}
                  onClick={() => handleVoiceInput("groomName", setGroomName)}
                  aria-label="Voice input for groom name"
                >
                  <svg className="voice-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                </button>
              )}
            </div>
            {groomName.length >= CHAR_LIMITS.name && (
              <span className="field-error">
                Name is too long / नाम की लंबाई कम कीजिए
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="brideName">Bride Name / दुल्हन का नाम</label>
            <div className="input-with-voice">
              <input
                type="text"
                id="brideName"
                value={brideName}
                onChange={(e) => setBrideName(e.target.value)}
                placeholder="Enter bride's name"
                autoComplete="off"
                autoCapitalize="words"
                inputMode="text"
                maxLength={CHAR_LIMITS.name}
                required
              />
              {isSupported && (
                <button
                  type="button"
                  className={`voice-btn ${isListening && activeField === "brideName" ? "listening" : ""}`}
                  onClick={() => handleVoiceInput("brideName", setBrideName)}
                  aria-label="Voice input for bride name"
                >
                  <svg className="voice-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                </button>
              )}
            </div>
            {brideName.length >= CHAR_LIMITS.name && (
              <span className="field-error">
                Name is too long / नाम की लंबाई कम कीजिए
              </span>
            )}
          </div>
        </div>

        {/* Date Section */}
        <div className="form-group">
          <label htmlFor="weddingDate">Wedding Date / शादी की तारीख</label>
          <input
            type="date"
            id="weddingDate"
            value={weddingDate}
            onChange={(e) => setWeddingDate(e.target.value)}
            required
          />
          {weddingDate && (
            <span className="date-preview">
              {formatDateForInvite(weddingDate)}
            </span>
          )}
        </div>

        {/* Venue Section */}
        <div className="form-group">
          <label htmlFor="venue">Venue & City / स्थान</label>
          <div className="input-with-voice">
            <input
              type="text"
              id="venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g., Hotel Rambagh Palace, Jaipur"
              autoComplete="off"
              autoCapitalize="words"
              inputMode="text"
              maxLength={CHAR_LIMITS.venue}
              required
            />
            {isSupported && (
              <button
                type="button"
                className={`voice-btn ${isListening && activeField === "venue" ? "listening" : ""}`}
                onClick={() => handleVoiceInput("venue", setVenue)}
                aria-label="Voice input for venue"
              >
                <svg className="voice-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            )}
          </div>
          {venue.length >= CHAR_LIMITS.venue && (
            <span className="field-error">
              Text is too long / लंबाई कम कीजिए
            </span>
          )}
        </div>

        {/* Dev Mode Section - shows when venue matches secret phrase */}
        {devMode && (
          <div className="form-group">
            <div className="dev-mode-section">
              <p className="dev-mode-hint">
                Dev Mode Active - Control which pipeline steps to skip
              </p>
              
              {/* Dev Mode Toggles */}
              <div className="dev-toggles-panel">
                <div className="dev-toggle-row">
                  <span className="dev-toggle-label">Skip Extraction</span>
                  <button
                    type="button"
                    className={`toggle-switch ${skipExtraction ? 'toggle-on' : ''}`}
                    onClick={() => setSkipExtraction(!skipExtraction)}
                    aria-label="Toggle skip extraction"
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                
                <div className="dev-toggle-row">
                  <span className="dev-toggle-label">Skip Image Generation</span>
                  <button
                    type="button"
                    className={`toggle-switch ${skipImageGeneration ? 'toggle-on' : ''}`}
                    onClick={() => setSkipImageGeneration(!skipImageGeneration)}
                    aria-label="Toggle skip image generation"
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                
                <div className="dev-toggle-row">
                  <span className="dev-toggle-label">Skip Background Removal</span>
                  <button
                    type="button"
                    className={`toggle-switch ${skipBackgroundRemoval ? 'toggle-on' : ''}`}
                    onClick={() => setSkipBackgroundRemoval(!skipBackgroundRemoval)}
                    aria-label="Toggle skip background removal"
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                
                <div className="dev-toggle-row">
                  <span className="dev-toggle-label">Skip Video Generation</span>
                  <button
                    type="button"
                    className={`toggle-switch ${skipVideoGeneration ? 'toggle-on' : ''}`}
                    onClick={() => setSkipVideoGeneration(!skipVideoGeneration)}
                    aria-label="Toggle skip video generation"
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>

                <div className="dev-toggle-row">
                  <span className="dev-toggle-label">Force Server FFmpeg</span>
                  <button
                    type="button"
                    className={`toggle-switch ${forceServerConversion ? 'toggle-on' : ''}`}
                    onClick={() => setForceServerConversion(!forceServerConversion)}
                    aria-label="Toggle force server-side video conversion"
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>
              
            </div>
          </div>
        )}

        {/* Photo Preview with Processing Status */}
        {/* Submit Button */}
        <button
          type="submit"
          className="generate-btn"
          disabled={!hasPhoto || (!devMode && !rateLimit.canGenerate)}
        >
          {devMode ? "Generate Invite (Dev Mode)" : "Generate Invite (निमंत्रण बनाएं)"}
        </button>
        
        {/* Rate limit info */}
        {!devMode && (
          <div className={`rate-limit-info ${rateLimit.remaining <= 2 ? 'rate-limit-warning' : ''}`}>
            {rateLimit.canGenerate ? (
              <span>
                {rateLimit.remaining} of {getMaxGenerations()} generations remaining this week
                {rateLimit.remaining <= 2 && ' ⚠️'}
              </span>
            ) : (
              <span className="rate-limit-exceeded">
                Limit reached. Resets in {formatResetTime(rateLimit.resetAt)}
              </span>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
