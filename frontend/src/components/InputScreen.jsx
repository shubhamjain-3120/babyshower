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
const CACHE_KEY = "babyshower-invite-form-cache";

// Secret venue name that enables dev mode
const DEV_MODE_VENUE = "Test Baby Shower";

// Character limits for input fields
const CHAR_LIMITS = {
  parentsName: 100,
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
    logger.warn("Cache", "Failed to load cached form data");
  }
  return null;
}

// Save form data to localStorage
function saveCachedFormData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    logger.warn("Cache", "Failed to save form data to cache");
  }
}

export default function InputScreen({
  onGenerate,
  error,
  photo,              // Passed from App (from PhotoUploadScreen)
  onBack,             // Back navigation handler
}) {
  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [validatedFormData, setValidatedFormData] = useState(null);

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
  const [parentsName, setParentsName] = useState(cachedData?.parentsName || "");
  const [eventTime, setEventTime] = useState(cachedData?.eventTime || "");
  const [eventDate, setEventDate] = useState(cachedData?.eventDate || "");
  const [venue, setVenue] = useState(cachedData?.venue || "");

  // Save form data to cache whenever it changes
  useEffect(() => {
    saveCachedFormData({ parentsName, eventTime, eventDate, venue });
  }, [parentsName, eventTime, eventDate, venue]);

  // Dev mode - enabled automatically when venue matches secret phrase
  const devMode = useMemo(() => {
    return venue.trim().toLowerCase() === DEV_MODE_VENUE.toLowerCase();
  }, [venue]);

  // Dev mode toggles - control which steps to skip
  const [skipExtraction, setSkipExtraction] = useState(false);
  const [skipImageGeneration, setSkipImageGeneration] = useState(false);
  const [skipBackgroundRemoval, setSkipBackgroundRemoval] = useState(false);
  const [skipVideoGeneration, setSkipVideoGeneration] = useState(false);


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

    if (!parentsName.trim() || !eventDate || !venue.trim()) {
      logger.warn("Form validation", "Missing required fields");
      alert("Please fill all required fields");
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
      parentsName: sanitizeInput(parentsName),
      time: eventTime,
      date: formatDateForInvite(eventDate),
      venue: sanitizeInput(venue),
      photo, // Baby photo
      devMode, // Whether to skip API
      characterFile: devMode ? photo : null, // In dev mode, use photo as character file
      // Dev mode toggles
      skipExtraction: devMode ? skipExtraction : false,
      skipImageGeneration: devMode ? skipImageGeneration : false,
      skipBackgroundRemoval: devMode ? skipBackgroundRemoval : false,
      skipVideoGeneration: devMode ? skipVideoGeneration : false,
    };

    logger.log("Form validation passed, showing confirmation modal", {
      parentsName: formData.parentsName,
      time: formData.time,
      date: formData.date,
      venue: formData.venue,
      devMode: formData.devMode,
      skipExtraction: formData.skipExtraction,
      skipImageGeneration: formData.skipImageGeneration,
      skipBackgroundRemoval: formData.skipBackgroundRemoval,
      skipVideoGeneration: formData.skipVideoGeneration,
      photoSize: photo ? `${(photo.size / 1024).toFixed(1)} KB` : null,
    });

    trackClick('generate_submit', { dev_mode: devMode });

    // Show confirmation modal instead of directly calling onGenerate
    setValidatedFormData(formData);
    setShowConfirmModal(true);
  };

  return (
    <div className="input-screen">
      {error && <div className="error-banner">{error}</div>}

      {/* Confirmation Modal */}
      {showConfirmModal && validatedFormData && (
        <div className="confirmation-modal-overlay">
          <div className="confirmation-modal">
            {/* Header */}
            <h2 className="modal-header">
              Please Confirm Details
            </h2>

            {/* Photo Preview */}
            <div className="modal-photo-container">
              <img src={URL.createObjectURL(photo)} alt="Baby photo" />
              <p className="modal-label">Photo</p>
            </div>

            {/* Details */}
            <div className="modal-details">
              <div className="modal-detail-item">
                <span className="modal-detail-label">Parents' Name:</span>
                <span className="modal-detail-value">{validatedFormData.parentsName}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Time:</span>
                <span className="modal-detail-value">{validatedFormData.time || 'Not specified'}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Date:</span>
                <span className="modal-detail-value">{validatedFormData.date}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Venue:</span>
                <span className="modal-detail-value">{validatedFormData.venue}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="modal-actions">
              <button
                className="modal-btn modal-btn-proceed"
                onClick={() => {
                  setShowConfirmModal(false);
                  onGenerate(validatedFormData);
                }}
              >
                Proceed
              </button>
              <button
                className="modal-btn modal-btn-edit"
                onClick={() => {
                  setShowConfirmModal(false);
                  setValidatedFormData(null);
                }}
              >
                Edit Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero headline */}
      <div className="hero-container" style={{ marginBottom: '20px' }}>
        <div className="sample-video-value-hindi">
          <label>Fill in your baby shower details</label>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="form">
        {/* Parents Name */}
        <div className="form-group">
          <label htmlFor="parentsName">Parents' Name</label>
          <div className="input-with-voice">
            <input
              type="text"
              id="parentsName"
              value={parentsName}
              onChange={(e) => setParentsName(e.target.value)}
              placeholder="e.g., John & Mary Smith"
              autoComplete="off"
              autoCapitalize="words"
              inputMode="text"
              maxLength={CHAR_LIMITS.parentsName}
              required
            />
            {isSupported && (
              <button
                type="button"
                className={`voice-btn ${isListening && activeField === "parentsName" ? "listening" : ""}`}
                onClick={() => handleVoiceInput("parentsName", setParentsName)}
                aria-label="Voice input for parents name"
              >
                <svg className="voice-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            )}
          </div>
          {parentsName.length >= CHAR_LIMITS.parentsName && (
            <span className="field-error">
              Name is too long
            </span>
          )}
        </div>

        {/* Time Section */}
        <div className="form-group">
          <label htmlFor="eventTime">Time</label>
          <select
            id="eventTime"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
          >
            <option value="">Select time</option>
            <option value="6am">6am</option>
            <option value="7am">7am</option>
            <option value="8am">8am</option>
            <option value="9am">9am</option>
            <option value="10am">10am</option>
            <option value="11am">11am</option>
            <option value="12pm">12pm</option>
            <option value="1pm">1pm</option>
            <option value="2pm">2pm</option>
            <option value="3pm">3pm</option>
            <option value="4pm">4pm</option>
            <option value="5pm">5pm</option>
            <option value="6pm">6pm</option>
            <option value="7pm">7pm</option>
            <option value="8pm">8pm</option>
            <option value="9pm">9pm</option>
            <option value="10pm">10pm</option>
            <option value="11pm">11pm</option>
            <option value="12am">12am</option>
          </select>
        </div>

        {/* Date Section */}
        <div className="form-group">
          <label htmlFor="eventDate">Date</label>
          <input
            type="date"
            id="eventDate"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
          />
          {eventDate && (
            <span className="date-preview">
              {formatDateForInvite(eventDate)}
            </span>
          )}
        </div>

        {/* Venue Section */}
        <div className="form-group">
          <label htmlFor="venue">Venue & City</label>
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
              Text is too long
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
          {devMode ? "Generate Invite (Dev Mode)" : "Generate Invite"}
        </button>

        {/* Go Back Button */}
        {onBack && (
          <button
            type="button"
            className="go-back-btn"
            onClick={onBack}
          >
            Go Back
          </button>
        )}

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
