import { useEffect } from "react";
import { trackPageView, trackClick } from "../utils/analytics";

/**
 * Sample Video Screen - Hero example of final output
 *
 * Shows a sample wedding invite video to entice users and drives them
 * to upload their photo. This is the first screen users see when they
 * open the app.
 *
 * @param {Object} props - Component props
 * @param {Function} props.onProceed - Callback fired when user clicks "Create My Invite" button
 * @returns {JSX.Element} Sample video screen with autoplay video and CTA button
 */
export default function SampleVideoScreen({ onProceed }) {
  // Track page view on mount
  useEffect(() => {
    trackPageView('sample_video');
  }, []);

  const handleProceed = () => {
    trackClick('sample_video_proceed');
    onProceed();
  };

  return (
    <div className="input-screen">
      <div className="form" style={{ gap: '16px' }}>
        {/* Hero headline */}
        <div className="hero-container">
          <div className="sample-video-value-hindi">
            <label>Upload one photo. Get a WhatsApp-ready video invite in minutes.</label>
          </div>
        </div>

        {/* Hero section with video */}
        <div className="form-group">
          <video
            className="sample-video-player"
            src="/assets/sample.mp4"
            autoPlay
            muted
            loop
            playsInline
            controls
          />
        </div>

        {/* CTA Button */}
        <button
          className="generate-btn"
          style={{ marginTop: '0' }}
          onClick={handleProceed}
        >
          Upload Photo
        </button>
      </div>
    </div>
  );
}