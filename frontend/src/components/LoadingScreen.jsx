import { useState, useEffect, useRef } from "react";
import { trackPageView } from "../utils/analytics";

/**
 * Trivia messages shown during loading to entertain users.
 * Each message has Marwadi and English versions.
 */
const TRIVIA_MESSAGES = [
  {
    mrw: "असली बजट टेस्ट वेन्यू कोनी, मिठाई रो काउंटर है।",
    en: "The real budget test isn't the venue, it's the मिठाई counter.",
  },
  {
    mrw: "मेहमानां ने वचनां सूं ज़्यादा खाना याद रह जावे।",
    en: "Guests remember the food longer than the vows.",
  },
  {
    mrw: "थारी थाली में घी कोनी है तो समझ जा, शादी गलत है।",
    en: "If there's no ghee on your plate, you're probably at the wrong wedding.",
  },
  {
    mrw: "कोई भूखो कोनी जावे, पर कई तो सीधो चाल भी कोनी पावे।",
    en: "No one leaves hungry, some leave unable to walk properly.",
  },
  {
    mrw: "मारवाड़ी शादी में डाइट प्लानां री छुट्टी हो जावे।",
    en: "In a Marwadi wedding, diet plans are officially suspended.",
  },
  {
    mrw: "सब सूं लंबी लाइन दूल्हा-दुल्हन री कोनी, मिठाई री होवे।",
    en: "The longest queue isn't for the couple, it's for the dessert.",
  },
  {
    mrw: "मारवाड़ी शादी में थाली खाली कोनी होवे, बस रीफिलां रा बीच होवे।",
    en: "At Marwadi weddings, plates are never truly empty — only between refills.",
  },
  {
    mrw: "लोग आशीर्वाद देण आवे, पण रुक्के नाश्ते खातर।",
    en: "People come for blessings, stay for the snacks.",
  }
];

/**
 * Loading Screen with Progress Bar and Rotating Trivia
 *
 * Displays a loading screen with a progress bar and rotating Marwadi wedding
 * trivia messages to entertain users during the generation process.
 *
 * Progress stages:
 * - 0-90%: Increase 1% every n seconds where n is random between 1-3 seconds
 * - 90-98%: Increase 1% every 5 seconds
 * - 98-100%: Wait for actual process completion, then jump to 100% immediately
 *
 * @param {Object} props - Component props
 * @param {boolean} [props.completed=false] - Whether the generation process is complete
 * @param {Function} [props.onCancel] - Optional callback fired when user clicks "Cancel" button
 * @returns {JSX.Element} Loading screen with progress bar and trivia messages
 */
export default function LoadingScreen({ completed = false, onCancel }) {
  const [progress, setProgress] = useState(0);
  const [triviaIndex, setTriviaIndex] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const progressTimeoutRef = useRef(null);
  const triviaIntervalRef = useRef(null);

  // Track page view on mount
  useEffect(() => {
    trackPageView('loading');
  }, []);

  // Rotate trivia every 5 seconds
  useEffect(() => {
    triviaIntervalRef.current = setInterval(() => {
      setTriviaIndex((prev) => (prev + 1) % TRIVIA_MESSAGES.length);
    }, 5000);

    return () => {
      if (triviaIntervalRef.current) {
        clearInterval(triviaIntervalRef.current);
      }
    };
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
              className={`progress-fill ${isCompleting ? 'completing' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="progress-text">{Math.round(progress)}%</span>
        </div>

        <div className="loading-trivia">
          <p className="trivia-primary">{TRIVIA_MESSAGES[triviaIndex].mrw}</p>
          <p className="trivia-secondary">{TRIVIA_MESSAGES[triviaIndex].en}</p>
        </div>

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
