import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import InputScreen from "./components/InputScreen";
import LoadingScreen from "./components/LoadingScreen";
import { composeVideoInvite } from "./utils/videoComposer";
import { removeImageBackground, dataURLToBlob } from "./utils/backgroundRemoval";
import { createDevLogger } from "./utils/devLogger";
import { incrementGenerationCount } from "./utils/rateLimit";

// Lazy load components that aren't immediately needed
const OnboardingScreen = lazy(() => import("./components/OnboardingScreen"));
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
  ONBOARDING: "onboarding",
  INPUT: "input",
  LOADING: "loading",
  RESULT: "result",
};

// LocalStorage key for onboarding
const ONBOARDING_KEY = "hasSeenOnboarding";

// Check if user has seen onboarding
function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

// Mark onboarding as seen
function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "true");
  } catch {
    // Ignore localStorage errors
  }
}

// Brief delay (ms) to show 100% before transitioning to result
const COMPLETION_DELAY_MS = 500;

// API retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Fetch with exponential backoff retry logic
 * Retries on network errors and 5xx server errors
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Don't retry client errors (4xx), only server errors (5xx)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      
      // Server error - will retry
      lastError = new Error(`Server error: ${response.status}`);
      logger.warn(`API attempt ${attempt + 1} failed with status ${response.status}`);
    } catch (err) {
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
  // Start with onboarding if not seen before, otherwise go to input
  const [screen, setScreen] = useState(() => 
    hasSeenOnboarding() ? SCREENS.INPUT : SCREENS.ONBOARDING
  );
  const [formData, setFormData] = useState(null);
  const [finalInvite, setFinalInvite] = useState(null);
  const [error, setError] = useState(null);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  
  // Network status detection
  const isOnline = useNetworkStatus();
  
  // Background music state
  const [isMusicPlaying, setIsMusicPlaying] = useState(true);
  const audioRef = useRef(null);

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

  const handleGenerate = useCallback(async (data) => {
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

      // Step 1: Get character image (API or local file)
      // In dev mode, skip API if EITHER extraction OR image generation is disabled
      // (since both require the API, skipping either means using local character file)
      const shouldSkipAPI = data.devMode && (data.skipExtraction || data.skipImageGeneration);

      if (shouldSkipAPI && data.characterFile) {
        logger.log("Step 1: Using local character file (dev mode - skipping API)", {
          fileName: data.characterFile.name,
          fileSize: `${(data.characterFile.size / 1024).toFixed(1)} KB`,
          fileType: data.characterFile.type,
        });
        console.log("[App] Dev mode enabled - using local character file");
        
        // Convert the file to a base64 data URL
        characterImage = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(reader.result);
          };
          reader.onerror = () => {
            reject(new Error("Failed to read character file"));
          };
          reader.readAsDataURL(data.characterFile);
        });

        logger.log("Step 1 complete: Character file loaded as data URL", {
          dataUrlLength: characterImage.length,
        });
        console.log("[App] Character file loaded, skipping API calls");
      } else {
        // Normal mode OR dev mode with API enabled: call backend API
        // Check network status before making API call
        if (!navigator.onLine) {
          throw new Error("No internet connection. Please check your network and try again.");
        }
        
        // Prepare form data for API - single couple photo
        const apiFormData = new FormData();
        apiFormData.append("photo", data.photo); // Couple photo

        logger.log("Step 1: Calling backend API", {
          photoName: data.photo.name,
          photoSize: `${(data.photo.size / 1024).toFixed(1)} KB`,
          photoType: data.photo.type,
        });
        console.log("[App] Calling backend API...");

        // Call backend API with retry logic
        const startApiCall = performance.now();
        let response;
        try {
          response = await fetchWithRetry(`${API_URL}/api/generate`, {
            method: "POST",
            body: apiFormData,
          });
        } catch (apiError) {
          throw apiError;
        }

        logger.log("Step 1 response received", {
          status: response.status,
          ok: response.ok,
          duration: `${(performance.now() - startApiCall).toFixed(0)}ms`,
        });

        // Defensive check: ensure response is JSON before parsing
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
      if (data.skipBackgroundRemoval) {
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
      logger.error("Generation failed", err);
      console.error("[App] Generation error:", err);
      setError(err.message);
      setScreen(SCREENS.INPUT);
    }
  }, []);

  const handleReset = useCallback(() => {
    setScreen(SCREENS.INPUT);
    setFormData(null);
    setFinalInvite(null);
    setError(null);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    markOnboardingSeen();
    setScreen(SCREENS.INPUT);
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

      <Suspense fallback={<LoadingFallback />}>
        {screen === SCREENS.ONBOARDING && (
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        )}
        {screen === SCREENS.RESULT && (
          <ResultScreen
            inviteVideo={finalInvite}
            brideName={formData?.brideName}
            groomName={formData?.groomName}
            onReset={handleReset}
          />
        )}
      </Suspense>
      
      {screen === SCREENS.INPUT && (
        <InputScreen onGenerate={handleGenerate} error={error} />
      )}
      {screen === SCREENS.LOADING && <LoadingScreen completed={loadingCompleted} />}
    </div>
  );
}
