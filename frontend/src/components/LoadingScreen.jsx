import { useState, useEffect, useRef } from "react";
import { trackPageView } from "../utils/analytics";

/**
 * Loading Screen with Progress Bar
 *
 * Displays a loading screen with a progress bar during the generation process.
 *
 * Progress stages:
 * - 0-90%: Increase 1% every n seconds where n is random between 1-3 seconds
 * - 90-98%: Increase 1% every 5 seconds
 * - 98-100%: Wait for actual process completion, then jump to 100% immediately
 *
 * @param {Object} props - Component props
 * @param {boolean} [props.completed=false] - Whether the generation process is complete
 * @param {Function} [props.onCancel] - Optional callback fired when user clicks "Cancel" button
 * @returns {JSX.Element} Loading screen with progress bar
 */
export default function LoadingScreen({ completed = false, onCancel }) {
  const [progress, setProgress] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const progressTimeoutRef = useRef(null);

  // Track page view on mount
  useEffect(() => {
    trackPageView('loading');
  }, []);

  // Smoothly transition to 100% when completed prop becomes true
  useEffect(() => {
    if (completed && progress < 100) {
      // Clear any pending timeouts
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current);
        progressTimeoutRef.current = null;
      }
      setIsCompleting(true);
      setProgress(100);
    }
  }, [completed, progress]);

  // Progress increment logic
  useEffect(() => {
    // Don't start if already completed or at 100%
    if (completed || progress >= 100) return;

    // Don't progress past 98% automatically - wait for completion signal
    if (progress >= 98) return;

    // Calculate delay based on current progress
    let delay;
    if (progress < 90) {
      // 0-90%: Random delay between 1-3 seconds
      delay = 1000 // 1000ms to 3000ms
    } else {
      // 90-98%: Fixed 5 second delay
      delay = 5000;
    }

    // Schedule next progress increment
    progressTimeoutRef.current = setTimeout(() => {
      setProgress((prev) => {
        // Don't exceed 98% automatically
        if (prev >= 98) return prev;
        return prev + 1;
      });
    }, delay);

    // Cleanup timeout on unmount or when progress changes
    return () => {
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current);
        progressTimeoutRef.current = null;
      }
    };
  }, [progress, completed]);

  return (
    <div className="loading-screen">
      <div className="loading-content">
        {/* Looping loading video - no audio */}
        <div className="mascot-container mascot-container-large">
          <video
            className="mascot mascot-large mascot-video"
            src="/assets/bunny-quill.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            aria-label="loading animation"
          />
        </div>

        {/* Progress bar */}
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className={`progress-fill ${isCompleting ? 'completing' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="progress-text">{Math.round(progress)}%</span>
        </div>

        {/* Cancel button */}
        {onCancel && (
          <button
            className="cancel-btn"
            onClick={onCancel}
            type="button"
          >
            cancel
          </button>
        )}
      </div>
    </div>
  );
}
