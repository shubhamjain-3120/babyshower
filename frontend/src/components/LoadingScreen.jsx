import { useState, useEffect } from "react";
import { trackPageView } from "../utils/analytics";

/**
 * Detailed Loading Screen with Multi-Stage Progress
 *
 * Progress stages:
 * 1. 0-20%: Feature Extraction (1% every 1s to 10%, then 1% every 5s to 20%)
 * 2. 20-40%: Image Generation (1% every 1s to 30%, then 1% every 5s to 40%)
 * 3. 40-60%: Image Evaluation (1% every 1s to 50%, then 1% every 5s to 60%)
 * 4. 60-70%: Background Removal (1% every 1s to 65%, then 1% every 5s to 70%)
 * 5. 70-98%: Video Generation (1% every 1s to 90%, then 1% every 5s to 98%)
 * 6. 98-100%: Final completion (instant on backend finish)
 */

export default function LoadingScreen({ completed = false, onCancel }) {
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

  // Helper function to determine which stage we're in and what the timings should be
  const getStageConfig = (currentProgress) => {
    if (currentProgress < 10) {
      return { fastTarget: 10, slowTarget: 20, fastInterval: 1000, slowInterval: 5000 }; // Extraction fast phase
    } else if (currentProgress < 20) {
      return { fastTarget: 10, slowTarget: 20, fastInterval: 1000, slowInterval: 5000 }; // Extraction slow phase
    } else if (currentProgress < 30) {
      return { fastTarget: 30, slowTarget: 40, fastInterval: 1000, slowInterval: 5000 }; // Image gen fast phase
    } else if (currentProgress < 40) {
      return { fastTarget: 30, slowTarget: 40, fastInterval: 1000, slowInterval: 5000 }; // Image gen slow phase
    } else if (currentProgress < 50) {
      return { fastTarget: 50, slowTarget: 60, fastInterval: 1000, slowInterval: 5000 }; // Evaluation fast phase
    } else if (currentProgress < 60) {
      return { fastTarget: 50, slowTarget: 60, fastInterval: 1000, slowInterval: 5000 }; // Evaluation slow phase
    } else if (currentProgress < 65) {
      return { fastTarget: 65, slowTarget: 70, fastInterval: 1000, slowInterval: 5000 }; // BG removal fast phase
    } else if (currentProgress < 70) {
      return { fastTarget: 65, slowTarget: 70, fastInterval: 1000, slowInterval: 5000 }; // BG removal slow phase
    } else if (currentProgress < 90) {
      return { fastTarget: 90, slowTarget: 98, fastInterval: 1000, slowInterval: 5000 }; // Video gen fast phase
    } else if (currentProgress < 98) {
      return { fastTarget: 90, slowTarget: 98, fastInterval: 1000, slowInterval: 5000 }; // Video gen slow phase
    }
    return null; // Completed
  };

  // Fast progress phase (1% every 1 second)
  useEffect(() => {
    if (completed || progress >= 98) return;

    const config = getStageConfig(progress);
    if (!config || progress >= config.fastTarget) return;

    const fastInterval = setInterval(() => {
      setProgress((prev) => {
        const nextProgress = prev + 1;
        const stageConfig = getStageConfig(prev);
        
        // Don't exceed the fast target for this stage
        if (nextProgress >= stageConfig.fastTarget) {
          clearInterval(fastInterval);
          return stageConfig.fastTarget;
        }
        return nextProgress;
      });
    }, config.fastInterval);

    return () => clearInterval(fastInterval);
  }, [completed, progress]);

  // Slow progress phase (1% every 5 seconds)
  useEffect(() => {
    if (completed || progress >= 98) return;

    const config = getStageConfig(progress);
    if (!config || progress < config.fastTarget || progress >= config.slowTarget) return;

    const slowInterval = setInterval(() => {
      setProgress((prev) => {
        const nextProgress = prev + 1;
        const stageConfig = getStageConfig(prev);
        
        // Don't exceed the slow target for this stage
        if (nextProgress >= stageConfig.slowTarget) {
          clearInterval(slowInterval);
          return stageConfig.slowTarget;
        }
        return nextProgress;
      });
    }, config.slowInterval);

    return () => clearInterval(slowInterval);
  }, [completed, progress]);

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

        {/* Cancel button */}
        {onCancel && (
          <button
            className="cancel-btn"
            onClick={onCancel}
            type="button"
          >
            Cancel (रद्द करें)
          </button>
        )}
      </div>
    </div>
  );
}
