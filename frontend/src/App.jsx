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

// Lazy load components that aren't immediately needed
const ResultScreen = lazy(() => import("./components/ResultScreen"));

const logger = createDevLogger("App");

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
 * Retries on network errors and 5xx server errors
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES, signal = null) {
  let lastError;

  // Merge signal into options if provided
  const fetchOptions = signal ? { ...options, signal } : options;

  // DIAGNOSTIC: Log full request details
  console.log("========== FETCH DEBUG START ==========");
  console.log("[FETCH] URL:", url);
  console.log("[FETCH] API_URL env var:", API_URL);
  console.log("[FETCH] Full URL being called:", url);
  console.log("[FETCH] Method:", options?.method || "GET");
  console.log("[FETCH] Has body:", !!options?.body);
  console.log("[FETCH] Navigator online:", navigator.onLine);
  console.log("[FETCH] Window location:", window.location.href);
  console.log("[FETCH] Window origin:", window.location.origin);

  // Test basic connectivity
  try {
    const testUrl = "https://httpbin.org/get";
    console.log("[FETCH] Testing basic connectivity to httpbin.org...");
    const testResponse = await fetch(testUrl, { method: "GET", mode: "cors" });
    console.log("[FETCH] Connectivity test result:", testResponse.status);
  } catch (testErr) {
    console.log("[FETCH] Connectivity test FAILED:", testErr.name, testErr.message);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    // Check if aborted before attempting
    if (signal?.aborted) {
      throw new DOMException('Request was cancelled', 'AbortError');
    }

    console.log(`[FETCH] Attempt ${attempt + 1}/${retries} starting...`);
    const startTime = Date.now();

    try {
      console.log("[FETCH] About to call fetch()...");
      const response = await fetch(url, fetchOptions);
      const elapsed = Date.now() - startTime;

      console.log(`[FETCH] Response received in ${elapsed}ms`);
      console.log("[FETCH] Status:", response.status);
      console.log("[FETCH] Status Text:", response.statusText);
      console.log("[FETCH] Response OK:", response.ok);
      console.log("[FETCH] Response type:", response.type);
      console.log("[FETCH] Response URL:", response.url);

      // Log response headers
      const headers = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      console.log("[FETCH] Response headers:", JSON.stringify(headers));

      // Don't retry client errors (4xx), only server errors (5xx)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        console.log("[FETCH] Returning successful response");
        console.log("========== FETCH DEBUG END ==========");
        return response;
      }

      // Server error - will retry
      lastError = new Error(`Server error: ${response.status}`);
      logger.warn(`API attempt ${attempt + 1} failed with status ${response.status}`);
      console.log("[FETCH] Server error, will retry...");
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.log(`[FETCH] EXCEPTION after ${elapsed}ms`);
      console.log("[FETCH] Error name:", err.name);
      console.log("[FETCH] Error message:", err.message);
      console.log("[FETCH] Error stack:", err.stack);
      console.log("[FETCH] Full error object:", JSON.stringify(err, Object.getOwnPropertyNames(err)));

      // If aborted, throw immediately without retry
      if (err.name === 'AbortError') {
        console.log("[FETCH] Request was aborted");
        console.log("========== FETCH DEBUG END ==========");
        throw err;
      }
      // Network error - will retry
      lastError = err;
      logger.warn(`API attempt ${attempt + 1} failed: ${err.message}`);
    }

    // Don't delay after the last attempt
    if (attempt < retries - 1) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.log(`[FETCH] Retrying in ${delay}ms...`);
      logger.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log("[FETCH] All retries exhausted, throwing error");
  console.log("========== FETCH DEBUG END ==========");
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

  // Initialize and play background music on app load
  useEffect(() => {
    const audio = new Audio("/assets/bg_audio.mp3");
    audio.loop = true;
    audio.volume = 0.05; // 10% volume
    audioRef.current = audio;
    
    let interactionListenerAdded = false;
    
    // Handler to play audio on first user interaction
    const playOnInteraction = async () => {
      if (audioRef.current && audioRef.current.paused) {
        try {
          await audioRef.current.play();
          setIsMusicPlaying(true);
          console.log("[App] Music started after user interaction");
        } catch (err) {
          console.log("[App] Could not play audio:", err.message);
        }
      }
      // Remove listeners after first successful interaction
      document.removeEventListener("click", playOnInteraction);
      document.removeEventListener("touchstart", playOnInteraction);
      document.removeEventListener("keydown", playOnInteraction);
      interactionListenerAdded = false;
    };
    
    // Try to play audio (may be blocked by browser autoplay policy)
    const playAudio = async () => {
      try {
        await audio.play();
        setIsMusicPlaying(true);
        console.log("[App] Autoplay successful");
      } catch (err) {
        // Autoplay was blocked - add listeners to play on first interaction
        console.log("[App] Autoplay blocked, waiting for user interaction");
        // Keep isMusicPlaying true so the icon shows speaker on (desired state)
        // Music will start on first interaction
        document.addEventListener("click", playOnInteraction);
        document.addEventListener("touchstart", playOnInteraction);
        document.addEventListener("keydown", playOnInteraction);
        interactionListenerAdded = true;
      }
    };
    
    playAudio();
    
    // Cleanup on unmount
    return () => {
      audio.pause();
      audio.src = "";
      if (interactionListenerAdded) {
        document.removeEventListener("click", playOnInteraction);
        document.removeEventListener("touchstart", playOnInteraction);
        document.removeEventListener("keydown", playOnInteraction);
      }
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
        console.log("[App] Could not play audio");
      });
      setIsMusicPlaying(true);
    }
  }, [isMusicPlaying]);

  // Stop background music when reaching result screen (video has its own audio)
  useEffect(() => {
    if (screen === SCREENS.RESULT && audioRef.current) {
      audioRef.current.pause();
      setIsMusicPlaying(false);
      console.log("[App] Stopped background music for result screen");
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

  const handleGenerate = useCallback(async (data) => {
    // Create new AbortController for this generation
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setFormData(data);
    setScreen(SCREENS.LOADING);
    setLoadingCompleted(false);
    setError(null);

    logger.log("Generation started", {
      devMode: data.devMode,
      brideName: data.brideName,
      groomName: data.groomName,
      hasPhoto: !!data.photo,
      hasCharacterFile: !!data.characterFile,
      skipExtraction: data.skipExtraction,
      skipImageGeneration: data.skipImageGeneration,
      skipBackgroundRemoval: data.skipBackgroundRemoval,
      skipVideoGeneration: data.skipVideoGeneration,
      videoComposition: "server-side", // Always use server for consistent quality
    });

    try {
      let characterImage;

      // Step 1: Get character image
      // Priority: 1) Background processing service (if ready), 2) Dev mode local file, 3) API call
      const service = processingServiceRef.current;
      const shouldSkipAPI = data.devMode && (data.skipExtraction || data.skipImageGeneration);

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
        console.log("[App] Waiting for photo processing to complete (extraction + generation + evaluation + bg removal)...");

        try {
          const status = await waitForProcessing(service);
          characterImage = status.processedImage;

          logger.log("Step 1 complete: Photo processing finished", {
            imageLength: characterImage?.length,
            isPhotoProcessed: status.isPhotoProcessed,
          });
          console.log("[App] Photo processing complete");
        } catch (processingError) {
          // Processing failed - use fallback image from service (original with bg removed)
          logger.warn("Step 1: Photo processing failed, using fallback", processingError.message);
          console.log("[App] Photo processing failed, using fallback image");
          characterImage = service.getStatus().processedImage;
        }
      } else if (service?.isImageReady() && isPhotoProcessed) {
        // Use already processed image from background service
        logger.log("Step 1: Using pre-processed image from background service");
        console.log("[App] Using pre-processed image (photo processing complete)");
        characterImage = service.getStatus().processedImage;

        logger.log("Step 1 complete: Pre-processed image ready", {
          imageLength: characterImage?.length,
        });
      } else if (processingStarted && !service.isDone()) {
        // Processing started but not complete - wait for it
        logger.log("Step 1: Background processing active, waiting", { state: serviceState });
        console.log("[App] Background processing active, waiting...");

        try {
          const status = await waitForProcessing(service);
          characterImage = status.processedImage;

          logger.log("Step 1 complete: Background processing finished", {
            imageLength: characterImage?.length,
          });
          console.log("[App] Background processing complete");
        } catch (processingError) {
          // Processing failed - use fallback image from service
          logger.warn("Step 1: Background processing failed, using fallback", processingError.message);
          console.log("[App] Background processing failed, using fallback image");
          characterImage = service.getStatus().processedImage;
        }
      } else if (processingStarted && service.isDone()) {
        // Already done - use whatever result we have (could be fallback)
        characterImage = service.getStatus().processedImage;
        
        logger.log("Step 1: Using completed processing result", {
          imageLength: characterImage?.length,
          state: serviceState,
        });
        console.log("[App] Using completed processing result");
      } else if (shouldSkipAPI && data.characterFile) {
        // Dev mode: use local character file
        logger.log("Step 1: Using local character file (dev mode - skipping API)", {
          fileName: data.characterFile.name,
          fileSize: `${(data.characterFile.size / 1024).toFixed(1)} KB`,
          fileType: data.characterFile.type,
        });
        console.log("[App] Dev mode enabled - using local character file");

        characterImage = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Failed to read character file"));
          reader.readAsDataURL(data.characterFile);
        });

        logger.log("Step 1 complete: Character file loaded as data URL", {
          dataUrlLength: characterImage.length,
        });
        console.log("[App] Character file loaded, skipping API calls");
      }

      // Fallback: call API directly if no processed image available
      if (!characterImage) {
        if (!navigator.onLine) {
          throw new Error("No internet connection. Please check your network and try again.");
        }

        const apiFormData = new FormData();
        apiFormData.append("photo", data.photo);

        logger.log("Step 1: Calling backend API (fallback)", {
          photoName: data.photo.name,
          photoSize: `${(data.photo.size / 1024).toFixed(1)} KB`,
          photoType: data.photo.type,
        });
        console.log("[App] Calling backend API...");

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
        console.log("[App] Received image from backend");

        characterImage = result.characterImage;
      }

      // Step 2: Remove background (conditionally based on toggle)
      // Note: Background removal is already done by the processing service, so skip if we used it
      const usedProcessingService = service?.isImageReady() || (service && !service.isDone());
      if (usedProcessingService) {
        logger.log("Step 2: Skipping background removal (already done by processing service)");
        console.log("[App] Background already removed by processing service");
      } else if (data.skipBackgroundRemoval) {
        logger.log("Step 2: Skipping background removal (dev mode toggle)");
        console.log("[App] Skipping background removal (dev mode)");
      } else {
        logger.log("Step 2: Starting background removal");
        console.log("[App] Removing background...");
        const startBgRemoval = performance.now();
        
        try {
          characterImage = await removeImageBackground(characterImage);

          logger.log("Step 2 complete: Background removal successful", {
            outputLength: characterImage?.length,
            duration: `${(performance.now() - startBgRemoval).toFixed(0)}ms`,
          });
          console.log("[App] Background removal complete");
        } catch (bgError) {
          // If background removal fails, use the original image
          logger.warn("Step 2", `Background removal failed, using original: ${bgError.message}`);
          console.warn("[App] Background removal failed, using original:", bgError.message);
        }
      }

      // Step 3: Video composition (conditionally based on toggle)
      let videoBlob;
      
      if (data.skipVideoGeneration) {
        logger.log("Step 3: Skipping video generation (dev mode toggle)");
        console.log("[App] Skipping video generation (dev mode)");

        // Convert the character image to a blob for the result screen
        // This allows previewing the image without video composition
        // Use direct conversion instead of fetch() to avoid issues with data URLs
        videoBlob = dataURLToBlob(characterImage);

        logger.log("Step 3 complete: Using image directly (no video)", {
          imageSize: `${(videoBlob?.size / 1024).toFixed(1)} KB`,
        });
      } else {
        logger.log("Step 3: Starting video composition (server-side)", {
          brideName: data.brideName,
          groomName: data.groomName,
          date: data.date,
          venue: data.venue,
          characterImageLength: characterImage?.length,
        });
        console.log("[App] Composing video invite (server-side)...");

        // Compose final invite as video with character overlay (always server-side)
        const startVideoCompose = performance.now();
        let lastLoggedProgress = 0;
        videoBlob = await composeVideoInvite({
          characterImage,
          brideName: data.brideName,
          groomName: data.groomName,
          date: data.date,
          venue: data.venue,
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
      if (!data.devMode) {
        const newLimit = incrementGenerationCount();
        logger.log("Rate limit updated", {
          count: newLimit.count,
          remaining: newLimit.remaining,
        });
      }

      logger.log("Step 4: Showing completion state");
      console.log("[App] Generation complete! Showing 100% briefly...");

      // Jump progress to 100% and wait briefly before transitioning
      setLoadingCompleted(true);
      await new Promise((resolve) => setTimeout(resolve, COMPLETION_DELAY_MS));

      logger.log("Step 5: Transitioning to result screen");
      setScreen(SCREENS.RESULT);

      logger.log("Generation complete - all steps successful");

    } catch (err) {
      // Don't show error for cancelled operations
      if (err.name === 'AbortError') {
        logger.log("Generation cancelled by user");
        console.log("[App] Generation cancelled by user");
        return;
      }
      logger.error("Generation failed", err);
      console.error("[App] Generation error:", err);
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
    console.log("[App] User cancelled generation");

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

  // Loading fallback for lazy-loaded components
  const LoadingFallback = () => (
    <div className="loading-fallback">
      <div className="loading-spinner" />
    </div>
  );

  return (
    <div className="app">
      {/* Offline banner */}
      {!isOnline && (
        <div className="offline-banner">
          You are offline. Some features may not work.
        </div>
      )}
      
      {/* App Header - Logo and Sound Button aligned at top */}
      <header className="app-header">
        <div className="app-header-logo">
          <img 
            src="/assets/app-logo.png" 
            alt="मारवाड़ी विवाह" 
            className="app-header-logo-img"
          />
        </div>
        <div className="app-header-title">
          <h1>मारवाड़ी विवाह</h1>
          <p>मारवाड़ी कूकू पत्रिका बनाएं</p>
        </div>
        <div className="app-header-actions">
          <button 
            className="music-toggle-btn"
            onClick={toggleMusic}
            aria-label={isMusicPlaying ? "Mute background music" : "Play background music"}
            title={isMusicPlaying ? "Mute music" : "Play music"}
          >
            {isMusicPlaying ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
          </button>
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
        />
      )}

      {/* Loading Screen */}
      {screen === SCREENS.LOADING && (
        <LoadingScreen completed={loadingCompleted} onCancel={handleCancel} />
      )}

      {/* Result Screen (lazy loaded) */}
      <Suspense fallback={<LoadingFallback />}>
        {screen === SCREENS.RESULT && (
          <ResultScreen
            inviteVideo={finalInvite}
            brideName={formData?.brideName}
            groomName={formData?.groomName}
            onReset={handleReset}
          />
        )}
      </Suspense>
    </div>
  );
}
