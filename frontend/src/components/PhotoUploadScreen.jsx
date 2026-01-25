import { useState, useRef, useEffect } from "react";
import { createDevLogger } from "../utils/devLogger";
import { trackPageView, trackClick } from "../utils/analytics";
import { getImageProcessingService } from "../utils/imageProcessingService";

const logger = createDevLogger("PhotoUploadScreen");

// File validation
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

/**
 * Photo Upload Screen - Dedicated screen for photo upload with background processing
 * 
 * Flow:
 * 1. User uploads photo
 * 2. Photo is validated
 * 3. Background processing starts immediately (non-blocking)
 * 4. User is shown "processing" state and can proceed
 * 5. When user proceeds, processing continues in background
 * 6. When video generation starts, use processed image if available
 */

export default function PhotoUploadScreen({ onPhotoSelected, apiUrl }) {
  const [photo, setPhoto] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [processingState, setProcessingState] = useState(null);
  const processingServiceRef = useRef(null);
  const [extractionState, setExtractionState] = useState({ status: 'idle', descriptions: null, error: null });
  const [extractionProgress, setExtractionProgress] = useState(0);
  const extractionProgressIntervalRef = useRef(null);

  // Track page view on mount
  useEffect(() => {
    trackPageView('photo_upload');
  }, []);

  // Initialize image processing service on mount
  useEffect(() => {
    processingServiceRef.current = getImageProcessingService();
  }, []);

  // Subscribe to processing state changes
  useEffect(() => {
    if (!processingServiceRef.current) return;

    const unsubscribe = processingServiceRef.current.on((status) => {
      setProcessingState(status);
      logger.log("Processing state updated", {
        state: status.state,
        step: status.step,
        progress: status.progress,
      });
    });

    return unsubscribe;
  }, []);

  // Create object URL for preview
  useEffect(() => {
    if (photo) {
      const url = URL.createObjectURL(photo);
      setPhotoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [photo]);

  // Progress bar for extraction (2% every 1 second till 90%)
  useEffect(() => {
    if (extractionState.status === 'uploading' && extractionProgress < 90) {
      extractionProgressIntervalRef.current = setInterval(() => {
        setExtractionProgress((prev) => {
          const next = prev + 2;
          return next >= 90 ? 90 : next;
        });
      }, 1000);

      return () => {
        if (extractionProgressIntervalRef.current) {
          clearInterval(extractionProgressIntervalRef.current);
          extractionProgressIntervalRef.current = null;
        }
      };
    } else {
      // Clear interval when not uploading or progress reaches 90%
      if (extractionProgressIntervalRef.current) {
        clearInterval(extractionProgressIntervalRef.current);
        extractionProgressIntervalRef.current = null;
      }
    }
  }, [extractionState.status, extractionProgress]);

  // Call extraction endpoint immediately when photo is selected
  useEffect(() => {
    // Note: apiUrl can be empty string in dev mode (uses Vite proxy), so only check for undefined
    if (!photo || apiUrl === undefined) return;

    const extractPhoto = async () => {
      // Reset progress
      setExtractionProgress(0);
      setExtractionState({ status: 'uploading', descriptions: null, error: null });
      
      logger.log("[EXTRACTION] Step 1: Preparing photo for extraction", {
        photoSize: `${(photo.size / 1024).toFixed(1)} KB`,
        photoType: photo.type,
        photoName: photo.name,
      });
      console.log("[Frontend] Preparing photo for extraction...");

      try {
        const formData = new FormData();
        formData.append("photo", photo);

        logger.log("[EXTRACTION] Step 2: Sending photo to backend, waiting for response...");
        console.log("[Frontend] Sending photo to backend, waiting for response...");

        const response = await fetch(`${apiUrl}/api/extract`, {
          method: "POST",
          body: formData,
        });

        logger.log("[EXTRACTION] Step 3: Response received from backend", {
          status: response.status,
          ok: response.ok,
        });
        console.log("[Frontend] Response received from backend");

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Extraction failed" }));
          throw new Error(errorData.error || "Extraction failed");
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Extraction failed");
        }

        logger.log("[EXTRACTION] Step 4: Extraction complete - response parsed successfully", {
          hasBride: !!result.descriptions?.bride,
          hasGroom: !!result.descriptions?.groom,
        });
        console.log("[Frontend] Extraction complete - response parsed successfully");

        // Set progress to 100% and mark as complete
        setExtractionProgress(100);
        setExtractionState({ status: 'complete', descriptions: result.descriptions, error: null });

        // After extraction completes, start background processing (generation → evaluation → bg removal)
        if (processingServiceRef.current) {
          logger.log("[BACKGROUND] Starting background processing after extraction", {
            photoSize: `${(photo.size / 1024).toFixed(1)} KB`,
          });
          console.log("[Frontend] Starting background processing (generation → evaluation → bg removal)...");

          // Start processing from generation step (extraction already done)
          processingServiceRef.current.startProcessingFromGeneration(photo, apiUrl, result.descriptions, {
            skipImageGeneration: false,
            skipEvaluation: false,
            skipBackgroundRemoval: false,
          });
        }
      } catch (error) {
        logger.error("[EXTRACTION] Extraction failed", error);
        console.error("[Frontend] Extraction failed:", error.message);
        setExtractionProgress(0);
        setExtractionState({ status: 'failed', descriptions: null, error: error.message });
      }
    };

    extractPhoto();
  }, [photo, apiUrl]);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const file = files[0];
    const validation = validateFile(file);

    if (!validation.valid) {
      alert(validation.error);
      e.target.value = "";
      return;
    }

    trackClick('photo_selected', {
      size: `${(file.size / 1024).toFixed(1)} KB`,
      type: file.type,
    });

    setPhoto(file);
    e.target.value = ""; // Allow re-selecting same file
  };


  const handleProceed = () => {
    if (!photo) {
      alert("Please upload a photo first");
      return;
    }

    // Only allow proceeding after extraction is complete
    if (extractionState.status !== 'complete') {
      return; // Don't show alert, just don't proceed
    }

    trackClick('photo_upload_proceed', {
      extractionStatus: extractionState.status,
      processingState: processingState?.state,
      isProcessingComplete: processingState?.state === 'ready',
    });

    // Pass photo, extracted descriptions, and current processing service to parent
    onPhotoSelected({
      photo,
      descriptions: extractionState.descriptions,
      processingService: processingServiceRef.current,
      processingState,
    });
  };

  const isExtracting = extractionState.status === 'uploading';
  const isExtractionComplete = extractionState.status === 'complete';
  const isExtractionFailed = extractionState.status === 'failed';

  return (
    <div className="input-screen photo-upload-screen">
      <div className="form">
        {/* Header */}
        <div className={isExtractionComplete ? "status-message-box status-success" : "hero-container"}>
          {isExtractionComplete ? (
            <span>✓ तस्वीर अपलोड हो गई! (Photo uploaded!)</span>
          ) : (
            <div className="form-group">
              <label>Photo Upload / तस्वीर अपलोड</label>
              <p className="form-hint">
                एक अच्छी और स्पष्ट तस्वीर चुनें (Choose a clear, good quality photo)
              </p>
            </div>
          )}
        </div>

        {/* Upload Section */}
        <div className="form-group">
          <label>Couple Photo / जोड़ी की तस्वीर</label>
          {!photo ? (
            <button
              type="button"
              className="upload-btn upload-btn-large"
              onClick={() => {
                trackClick('photo_upload_click');
                fileInputRef.current?.click();
              }}
            >
              <span className="upload-icon">+</span>
              <span className="upload-text-hindi">अपनी तस्वीर चुनें</span>
              <span className="upload-hint">Select Your Photo</span>
            </button>
          ) : (
            <div className="photo-single">
              <div className="photo-card">
                <div className="photo-preview" style={{ position: 'relative', width: '100%', height: 'auto', maxWidth: '280px' }}>
                  <img src={photoUrl} alt="Selected photo" style={{ width: '100%', height: 'auto', display: 'block' }} />
                  {isExtracting && (
                    <div className="processing-overlay">
                      <div className="processing-indicator">
                        <div className="spinner" />
                        <p className="processing-text">
                          तस्वीर अपलोड हो रही है... (Uploading...)
                        </p>
                        <div className="upload-progress-bar">
                          <div
                            className="upload-progress-fill"
                            style={{ width: `${extractionProgress}%` }}
                          />
                          <span className="upload-progress-text">
                            {Math.round(extractionProgress)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Status Messages */}
        {isExtractionFailed && (
          <div className="status-message-box status-error">
            <span>⚠ अपलोड में समस्या: {extractionState.error}</span>
            <span className="status-hint">कृपया पुनः प्रयास करें (Please try again)</span>
          </div>
        )}

        <button
          type="button"
          className="generate-btn"
          onClick={handleProceed}
          disabled={!photo || isExtracting || isExtractionFailed}
        >
          {isExtracting ? (
            "अपलोड हो रहा है... (Uploading...)"
          ) : isExtractionComplete ? (
            "आगे बढ़ें (Continue)"
          ) : (
            "तस्वीर चुनें (Select Photo)"
          )}
        </button>

        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}