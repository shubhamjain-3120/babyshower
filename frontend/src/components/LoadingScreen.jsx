import { useState, useEffect } from "react";
import { trackPageView } from "../utils/analytics";

/**
 * Phase 4: Updated Loading Screen
 *
 * Progress behavior:
 * - Random increment between 1-3% every 1 second until reaching 90%
 * - After 90%, increment by 1% every 5 seconds until 99%
 * - Accepts `completed` prop to jump to 100% when backend finishes
 */

export default function LoadingScreen({ completed = false }) {
  const [progress, setProgress] = useState(0);

  // Track page view on mount
  useEffect(() => {
    trackPageView('loading');
  }, []);

  // Jump to 100% when completed prop becomes true
  useEffect(() => {
    if (completed) {
      setProgress(100);
    }
  }, [completed]);

  // Progress from 0% to 90%: random 1-3% every 1 second
  useEffect(() => {
    // Don't run the progress animation if already completed or already at 90%+
    if (completed || progress >= 90) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        // Random increment between 1 and 3
        const increment = Math.floor(Math.random() * 3) + 1;
        return Math.min(prev + increment, 90);
      });
    }, 1000); // Every 1 second

    return () => clearInterval(interval);
  }, [completed, progress >= 90]);

  // After reaching 90%, continue with 1% every 5 seconds
  useEffect(() => {
    // Only start slow progress after reaching 90% and not yet completed
    if (progress < 90 || completed) return;

    const slowInterval = setInterval(() => {
      setProgress((prev) => {
        // Cap at 99% - let completion handle the jump to 100%
        if (prev >= 99) {
          clearInterval(slowInterval);
          return 99;
        }
        return prev + 1;
      });
    }, 5000); // 1% every 5 seconds

    return () => clearInterval(slowInterval);
  }, [progress >= 90, completed]);

  return (
    <div className="loading-screen">
      <div className="loading-content">
        {/* Hindi text - unchanged */}
        <h2 className="loading-text">
        बस 2 मिनट सा आपरो निमंत्रण बन रह्यो है 😊
        </h2>

        {/* Mascot - now primary visual, 1.6× larger */}
        <div className="mascot-container mascot-container-large">
          <img
            src="/assets/mascot.png"
            alt="Loading mascot"
            className="mascot mascot-large"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
        </div>

        {/* Progress bar */}
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="progress-text">{Math.round(progress)}%</span>
        </div>

        <p className="loading-subtext">
          Creating your beautiful wedding invite...
        </p>
      </div>
    </div>
  );
}
