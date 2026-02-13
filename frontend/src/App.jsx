import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import InputScreen from "./components/InputScreen";
import LoadingScreen from "./components/LoadingScreen";
import SampleVideoScreen from "./components/SampleVideoScreen";
import PhotoUploadScreen from "./components/PhotoUploadScreen";
import { composeVideoInvite } from "./utils/videoComposer";
import { removeImageBackground, dataURLToBlob } from "./utils/backgroundRemoval";
import { createDevLogger } from "./utils/devLogger";
import { incrementGenerationCount } from "./utils/rateLimit";
import { getImageProcessingService, resetImageProcessingService, STATES } from "./utils/imageProcessingService";
import { trackClick } from "./utils/analytics";

// Lazy load components that aren't immediately needed
const ResultScreen = lazy(() => import("./components/ResultScreen"));

const logger = createDevLogger("App");

// Back arrow icon
const BackArrowIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
);

// Speaker icons for music toggle
const SpeakerOnIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const SpeakerOffIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

// API URL - uses environment variable in production, empty string (relative) in dev
// Strip trailing slashes to prevent double-slash URLs like "host//api/generate"
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const SCREENS = {
  SAMPLE_VIDEO: "sample_video",
  PHOTO_UPLOAD: "photo_upload",
  INPUT: "input",
  LOADING: "loading",
  RESULT: "result",
};

// Brief delay (ms) to show 100% before transitioning to result
const COMPLETION_DELAY_MS = 500;

// API retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Fetch with exponential backoff retry logic
 * Retries on network errors and 5xx server errors (NOT client errors 4xx)
 *
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options (method, body, headers, etc.)
 * @param {number} [retries=MAX_RETRIES] - Max retry attempts (default: 3)
 * @param {AbortSignal} [signal=null] - AbortSignal for cancellation support
 * @returns {Promise<Response>} - Fetch response if successful
 * @throws {Error} - Throws after all retries exhausted or if aborted
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES, signal = null) {
  let lastError;

  // Merge signal into options if provided
  const fetchOptions = signal ? { ...options, signal } : options;

  for (let attempt = 0; attempt < retries; attempt++) {
    // Check if aborted before attempting
    if (signal?.aborted) {
      throw new DOMException('Request was cancelled', 'AbortError');
    }

    try {
      const response = await fetch(url, fetchOptions);

      // Don't retry client errors (4xx), only server errors (5xx)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      // Server error - will retry
      lastError = new Error(`Server error: ${response.status}`);
      logger.warn(`API attempt ${attempt + 1} failed with status ${response.status}`);
    } catch (err) {
      // If aborted, throw immediately without retry
      if (err.name === 'AbortError') {
        throw err;
      }
      // Network error - will retry
      lastError = err;
      logger.warn(`API attempt ${attempt + 1} failed: ${err.message}`);
    }

    // Don't delay after the last attempt
    if (attempt < retries - 1) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      logger.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Custom hook for network status detection
 */
function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logger.log("Network status: online");
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      logger.log("Network status: offline");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export default function App() {
  // Always start with sample video screen
  const [screen, setScreen] = useState(SCREENS.SAMPLE_VIDEO);
  const [formData, setFormData] = useState(null);
  const [finalInvite, setFinalInvite] = useState(null);
  const [error, setError] = useState(null);
  const [loadingCompleted, setLoadingCompleted] = useState(false);

  // New state for photo upload and processing
  const [uploadedPhoto, setUploadedPhoto] = useState(null);
  const [processingStatus, setProcessingStatus] = useState({ state: 'idle' });
  const processingServiceRef = useRef(null);

  // Network status detection
  const isOnline = useNetworkStatus();

  // Background music state
  const [isMusicPlaying, setIsMusicPlaying] = useState(true);
  const audioRef = useRef(null);

  // AbortController for cancelling ongoing generation
  const abortControllerRef = useRef(null);

  // NOTE: Background removal model preload has been DISABLED to prevent UI blocking.
  // The model will be loaded on-demand when the user generates an invite.
  // This makes the page fully responsive at all times.
  // The trade-off is the first generation will take ~30-40 seconds longer.

  // Initialize background music (audio instance only)
  useEffect(() => {
    const audio = new Audio("/assets/loading_music.mp3");
    audio.loop = true;
    audio.volume = 0.05; // 5% volume
    audioRef.current = audio;

    // Cleanup on unmount
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // Toggle background music
  const toggleMusic = useCallback(() => {
    if (!audioRef.current) return;
    
    if (isMusicPlaying) {
      audioRef.current.pause();
      setIsMusicPlaying(false);
    } else {
      audioRef.current.play().catch(() => {
        logger.warn("Audio", "Could not play audio");
      });
      setIsMusicPlaying(true);
    }
  }, [isMusicPlaying]);

  // Play background music only on loading screen
  useEffect(() => {
    if (!audioRef.current) return;

    if (screen === SCREENS.LOADING) {
      // Start playing audio on loading screen
      audioRef.current.play().catch(() => {
        setIsMusicPlaying(false);
      });
      setIsMusicPlaying(true);
    } else {
      // Stop audio on all other screens
      audioRef.current.pause();
      audioRef.current.currentTime = 0; // Reset to start
      setIsMusicPlaying(false);
    }
  }, [screen]);

  // Navigation handler: Sample video → Photo upload
  const handleSampleVideoComplete = useCallback(() => {
    logger.log("Sample video complete, navigating to photo upload");
    setScreen(SCREENS.PHOTO_UPLOAD);
  }, []);

  // Navigation handler: Photo upload → Input form
  const handlePhotoSelected = useCallback(({ photo, processingService, processingState }) => {
    logger.log("Photo selected, navigating to input form", {
      photoSize: `${(photo.size / 1024).toFixed(1)} KB`,
      processingState: processingState?.state,
    });

    setUploadedPhoto(photo);
    processingServiceRef.current = processingService;
    setProcessingStatus(processingState || { state: 'idle' });

    // Subscribe to processing updates
    if (processingService) {
      const unsubscribe = processingService.on((status) => {
        setProcessingStatus(status);
      });
      // Store unsubscribe for cleanup (we'll rely on reset instead)
    }

    setScreen(SCREENS.INPUT);
  }, []);

  // Navigation handler: Change photo → Back to photo upload
  // Helper function to wait for processing to complete
  const waitForProcessing = (service) => {
    return new Promise((resolve, reject) => {
      if (service.isDone()) {
        resolve(service.getStatus());
        return;
      }

      const unsubscribe = service.on((status) => {
        if (status.state === STATES.READY) {
          unsubscribe();
          resolve(status);
        } else if (status.state === STATES.FAILED) {
          unsubscribe();
          reject(new Error(status.error || "Processing failed"));
        }
      });
    });
  };

  /**
   * Core generation pipeline for wedding invites
   *
   * Orchestrates the entire invite generation workflow:
   * 1. Get/wait for AI-generated character image (from processing service or API)
   * 2. Remove background from character (if not already done)
   * 3. Compose video with character overlay and text (server-side)
   *
   * @param {Object} generationFormData - Form data with names, date, venue, photo
   * @param {string} generationFormData.parentsName - Parents' names
   * @param {string} generationFormData.date - Event date (formatted)
   * @param {string} [generationFormData.time] - Event time (optional)
   * @param {string} generationFormData.venue - Event venue
   * @param {File} generationFormData.photo - Uploaded baby photo
   * @param {boolean} generationFormData.devMode - Skip API calls if true
   * @param {File} [generationFormData.characterFile] - Dev mode: local character file
   * @param {boolean} [generationFormData.skipBackgroundRemoval] - Dev mode: skip bg removal
   * @param {boolean} [generationFormData.skipVideoGeneration] - Dev mode: skip video composition
   */
  const handleGenerate = useCallback(async (generationFormData) => {
    // Create new AbortController for this generation
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setFormData(generationFormData);
    setScreen(SCREENS.LOADING);
    setLoadingCompleted(false);
    setError(null);

    // Track generation started
    trackClick('generation_started', {
      dev_mode: generationFormData.devMode,
      has_photo: !!generationFormData.photo,
    });

    logger.log("Generation started", {
      devMode: generationFormData.devMode,
      parentsName: generationFormData.parentsName,
      hasPhoto: !!generationFormData.photo,
      hasCharacterFile: !!generationFormData.characterFile,
      skipExtraction: generationFormData.skipExtraction,
      skipImageGeneration: generationFormData.skipImageGeneration,
      skipBackgroundRemoval: generationFormData.skipBackgroundRemoval,
      skipVideoGeneration: generationFormData.skipVideoGeneration,
      videoComposition: "server-side", // Always use server for consistent quality
    });

    try {
      let characterImage;

      // Step 1: Get character image
      // Priority: 1) Background processing service (if ready), 2) Dev mode local file, 3) API call
      const service = processingServiceRef.current;
      const shouldSkipAPI = generationFormData.devMode && (generationFormData.skipExtraction || generationFormData.skipImageGeneration);

      // Check if photo is fully processed (extraction + generation + evaluation + bg removal)
      const isPhotoProcessed = service?.isPhotoFullyProcessed?.() || false;
      const serviceState = service?.getStatus()?.state;
      const processingStarted = serviceState && serviceState !== 'idle';

      logger.log("Step 1: Checking photo processing status", {
        isPhotoProcessed,
        serviceState,
        processingStarted,
        isImageReady: service?.isImageReady(),
      });

      // If photo is not processed, wait for processing to complete before video generation
      if (service && !isPhotoProcessed && processingStarted && !service.isDone()) {
        logger.log("Step 1: Photo not fully processed, waiting for processing to complete");

        try {
          const status = await waitForProcessing(service);
          characterImage = status.processedImage;

          logger.log("Step 1 complete: Photo processing finished", {
            imageLength: characterImage?.length,
            isPhotoProcessed: status.isPhotoProcessed,
          });
        } catch (processingError) {
          // Processing failed - use fallback image from service (original with bg removed)
          logger.warn("Step 1: Photo processing failed, using fallback", processingError.message);
          characterImage = service.getStatus().processedImage;
        }
      } else if (service?.isImageReady() && isPhotoProcessed) {
        // Use already processed image from background service
        logger.log("Step 1: Using pre-processed image from background service");
        characterImage = service.getStatus().processedImage;

        logger.log("Step 1 complete: Pre-processed image ready", {
          imageLength: characterImage?.length,
        });
      } else if (processingStarted && !service.isDone()) {
        // Processing started but not complete - wait for it
        logger.log("Step 1: Background processing active, waiting", { state: serviceState });

        try {
          const status = await waitForProcessing(service);
          characterImage = status.processedImage;

          logger.log("Step 1 complete: Background processing finished", {
            imageLength: characterImage?.length,
          });
        } catch (processingError) {
          // Processing failed - use fallback image from service
          logger.warn("Step 1: Background processing failed, using fallback", processingError.message);
          characterImage = service.getStatus().processedImage;
        }
      } else if (processingStarted && service.isDone()) {
        // Already done - use whatever result we have (could be fallback)
        characterImage = service.getStatus().processedImage;

        logger.log("Step 1: Using completed processing result", {
          imageLength: characterImage?.length,
          state: serviceState,
        });
      } else if (shouldSkipAPI && generationFormData.characterFile) {
        // Dev mode: use local character file
        logger.log("Step 1: Using local character file (dev mode - skipping API)", {
          fileName: generationFormData.characterFile.name,
          fileSize: `${(generationFormData.characterFile.size / 1024).toFixed(1)} KB`,
          fileType: generationFormData.characterFile.type,
        });

        characterImage = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Failed to read character file"));
          reader.readAsDataURL(generationFormData.characterFile);
        });

        logger.log("Step 1 complete: Character file loaded as data URL", {
          dataUrlLength: characterImage.length,
        });
      }

      // Fallback: call API directly if no processed image available
      if (!characterImage) {
        if (!navigator.onLine) {
          throw new Error("No internet connection. Please check your network and try again.");
        }

        const apiFormData = new FormData();
        apiFormData.append("photo", generationFormData.photo);

        logger.log("Step 1: Calling backend API (fallback)", {
          photoName: generationFormData.photo.name,
          photoSize: `${(generationFormData.photo.size / 1024).toFixed(1)} KB`,
          photoType: generationFormData.photo.type,
        });

        const startApiCall = performance.now();
        const response = await fetchWithRetry(`${API_URL}/api/generate`, {
          method: "POST",
          body: apiFormData,
        }, MAX_RETRIES, signal);

        logger.log("Step 1 response received", {
          status: response.status,
          ok: response.ok,
          duration: `${(performance.now() - startApiCall).toFixed(0)}ms`,
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Server returned non-JSON response. Check API URL configuration.');
        }
        const result = await response.json();

        if (!result.success) {
          logger.error("Step 1 failed", result.error || "Generation failed");
          throw new Error(result.error || "Generation failed");
        }

        logger.log("Step 1 complete: Backend returned success", {
          hasCharacterImage: !!result.characterImage,
          imageLength: result.characterImage?.length,
          evaluationScore: result.evaluation?.score,
          evaluationPassed: result.evaluation?.passed,
        });

        characterImage = result.characterImage;
      }

      // Step 2: Remove background (conditionally based on toggle)
      // Note: Background removal is already done by the processing service, so skip if we used it
      const usedProcessingService = service?.isImageReady() || (service && !service.isDone());
      if (usedProcessingService) {
        logger.log("Step 2: Skipping background removal (already done by processing service)");
      } else if (generationFormData.skipBackgroundRemoval) {
        logger.log("Step 2: Skipping background removal (dev mode toggle)");
      } else {
        logger.log("Step 2: Starting background removal");
        const startBgRemoval = performance.now();

        // Use improved background removal with server fallback - no silent failures
        characterImage = await removeImageBackground(characterImage, API_URL);

        logger.log("Step 2 complete: Background removal successful", {
          outputLength: characterImage?.length,
          duration: `${(performance.now() - startBgRemoval).toFixed(0)}ms`,
        });
      }

      // Step 3: Video composition (conditionally based on toggle)
      let videoBlob;

      if (generationFormData.skipVideoGeneration) {
        logger.log("Step 3: Skipping video generation (dev mode toggle)");

        // Convert the character image to a blob for the result screen
        // This allows previewing the image without video composition
        // Use direct conversion instead of fetch() to avoid issues with data URLs
        videoBlob = dataURLToBlob(characterImage);

        logger.log("Step 3 complete: Using image directly (no video)", {
          imageSize: `${(videoBlob?.size / 1024).toFixed(1)} KB`,
        });
      } else {
        logger.log("Step 3: Starting video composition (server-side)", {
          parentsName: generationFormData.parentsName,
          date: generationFormData.date,
          time: generationFormData.time,
          venue: generationFormData.venue,
          characterImageLength: characterImage?.length,
        });

        // Compose final invite as video with character overlay (always server-side)
        const startVideoCompose = performance.now();
        let lastLoggedProgress = 0;
        videoBlob = await composeVideoInvite({
          characterImage,
          parentsName: generationFormData.parentsName,
          date: generationFormData.date,
          time: generationFormData.time,
          venue: generationFormData.venue,
          onProgress: (progress) => {
            // Only log at key milestones (every 20%) to reduce noise
            if (progress >= lastLoggedProgress + 20 || progress === 100) {
              logger.log("Video composition progress", {
                progress: `${progress}%`,
                elapsed: `${(performance.now() - startVideoCompose).toFixed(0)}ms`
              });
              lastLoggedProgress = progress;
            }
          },
        });

        logger.log("Step 3 complete: Video composition finished", {
          videoSize: `${(videoBlob?.size / 1024 / 1024).toFixed(2)} MB`,
          duration: `${(performance.now() - startVideoCompose).toFixed(0)}ms`,
        });
      }

      setFinalInvite(videoBlob);

      // Increment rate limit counter (only for non-dev mode)
      if (!generationFormData.devMode) {
        const newLimit = incrementGenerationCount();
        logger.log("Rate limit updated", {
          count: newLimit.count,
          remaining: newLimit.remaining,
        });
      }

      logger.log("Step 4: Showing completion state");

      // Jump progress to 100% and wait briefly before transitioning
      setLoadingCompleted(true);
      await new Promise((resolve) => setTimeout(resolve, COMPLETION_DELAY_MS));

      logger.log("Step 5: Transitioning to result screen");
      setScreen(SCREENS.RESULT);

      // Track generation completed
      trackClick('generation_completed', {
        dev_mode: generationFormData.devMode,
      });

      logger.log("Generation complete - all steps successful");

    } catch (err) {
      // Don't show error for cancelled operations
      if (err.name === 'AbortError') {
        logger.log("Generation cancelled by user");
        return;
      }
      logger.error("Generation failed", err);
      trackClick('generation_failed', {
        error_message: err.message,
        error_type: err.name || 'unknown',
      });
      setError(err.message);
      setScreen(SCREENS.INPUT);
    }
  }, []);

  const handleCancel = useCallback(() => {
    // Abort any ongoing API requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    logger.log("User cancelled generation");

    // Track cancellation
    trackClick('generation_cancelled');

    // Reset state and go back to input screen
    setScreen(SCREENS.INPUT);
    setFormData(null);
    setFinalInvite(null);
    setLoadingCompleted(false);
    setError(null);
  }, []);

  const handleReset = useCallback(() => {
    // Reset processing state
    if (processingServiceRef.current) {
      processingServiceRef.current.cancel();
    }
    resetImageProcessingService();
    processingServiceRef.current = null;

    // Reset all state and go back to sample video
    setScreen(SCREENS.SAMPLE_VIDEO);
    setFormData(null);
    setFinalInvite(null);
    setUploadedPhoto(null);
    setProcessingStatus({ state: 'idle' });
    setError(null);
  }, []);

  // Handle back button navigation
  const handleBack = useCallback(() => {
    logger.log("Back button clicked", { currentScreen: screen });

    if (screen === SCREENS.PHOTO_UPLOAD) {
      // Go back to sample video
      setScreen(SCREENS.SAMPLE_VIDEO);
    } else if (screen === SCREENS.INPUT) {
      // Go back to photo upload
      setScreen(SCREENS.PHOTO_UPLOAD);
    } else if (screen === SCREENS.RESULT) {
      // Go back to input form
      setScreen(SCREENS.INPUT);
    }
  }, [screen]);

  // Loading fallback for lazy-loaded components
  const LoadingFallback = () => (
    <div className="loading-fallback">
      <div className="loading-spinner" />
    </div>
  );

  // Error boundary for lazy-loaded components
  const handleLazyLoadError = (error) => {
    logger.error("Failed to load ResultScreen component", error);
    setError("failed to load result screen. please try again.");
    setScreen(SCREENS.INPUT);
  };

  return (
    <div className="app">
      {/* Offline banner */}
      {!isOnline && (
        <div className="offline-banner">
          you are offline. some features may not work.
        </div>
      )}
      
      {/* App Header - Logo and Sound Button aligned at top */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-header-logo">
            <img
              src="/assets/app-logo.png"
              alt="bunny invites"
              className="app-header-logo-img"
            />
          </div>
        </div>
        <div className="app-header-title">
          <h1>bunny invites</h1>
          <p>create cute video invites in minutes</p>
        </div>
        <div className="app-header-actions">
          {/* Show music toggle only on loading screen */}
          {screen === SCREENS.LOADING && (
            <button
              className="music-toggle-btn"
              onClick={toggleMusic}
              aria-label={isMusicPlaying ? "mute background music" : "play background music"}
              title={isMusicPlaying ? "mute music" : "play music"}
            >
              {isMusicPlaying ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
            </button>
          )}
        </div>
      </header>

      {/* Sample Video Screen */}
      {screen === SCREENS.SAMPLE_VIDEO && (
        <SampleVideoScreen onProceed={handleSampleVideoComplete} />
      )}

      {/* Photo Upload Screen */}
      {screen === SCREENS.PHOTO_UPLOAD && (
        <PhotoUploadScreen
          onPhotoSelected={handlePhotoSelected}
          apiUrl={API_URL}
        />
      )}

      {/* Input Form Screen */}
      {screen === SCREENS.INPUT && (
        <InputScreen
          onGenerate={handleGenerate}
          error={error}
          photo={uploadedPhoto}
          onBack={() => setScreen(SCREENS.PHOTO_UPLOAD)}
        />
      )}

      {/* Loading Screen */}
      {screen === SCREENS.LOADING && (
        <LoadingScreen completed={loadingCompleted} onCancel={handleCancel} />
      )}

      {/* Result Screen (lazy loaded) */}
      <Suspense fallback={<LoadingFallback />}>
        {screen === SCREENS.RESULT && finalInvite && (
          <ResultScreen
            inviteVideo={finalInvite}
            parentsName={formData?.parentsName}
            venue={formData?.venue}
            onReset={handleReset}
          />
        )}
      </Suspense>
    </div>
  );
}
