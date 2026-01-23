import { useState, useEffect } from "react";
import { trackPageView, trackClick } from "../utils/analytics";

/**
 * OnboardingScreen - 3-step onboarding flow for first-time users
 * 
 * Screen 1: Welcome text with WhatsApp logo
 * Screen 2: Photo upload demo
 * Screen 3: Sample video result
 */

// WhatsApp logo SVG
const WhatsAppLogo = () => (
  <svg className="whatsapp-logo" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

// Sparkle icon SVG component
const SparkleIcon = () => (
  <div className="sparkle-icon">
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z"/>
    </svg>
  </div>
);

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(1);
  const [showSparkle, setShowSparkle] = useState(false);

  // Track page view on mount and step change
  useEffect(() => {
    trackPageView('onboarding', { step });
  }, [step]);

  // Show sparkle animation when entering step 2
  useEffect(() => {
    if (step === 2) {
      setShowSparkle(true);
      // Hide sparkle after animation completes (0.4s)
      const timer = setTimeout(() => {
        setShowSparkle(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [step]);

  // Handle continue button click
  const handleContinue = () => {
    // Track continue button click
    trackClick('onboarding_continue', { 
      from_step: step, 
      to_step: step === 3 ? 'complete' : step + 1 
    });

    if (step === 3) {
      // Final step - complete onboarding
      onComplete();
    } else {
      // Advance to next step
      setStep(step + 1);
    }
  };

  // Handle back button click
  const handleBack = () => {
    if (step > 1) {
      trackClick('onboarding_back', { from_step: step });
      setStep(step - 1);
    }
  };

  // Render content based on current step
  const renderContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="onboarding-content onboarding-welcome">
            <img 
              src="/assets/app-logo.png" 
              alt="मारवाड़ी विवाह" 
              className="app-logo"
            />
            <h1 className="onboarding-title">
              अब बनाओ मारवाड़ी कूकू पत्रिका
              <br />
              <span className="whatsapp-line">
                <WhatsAppLogo /> WhatsApp के लिए 2 मिनट में
              </span>
            </h1>
          </div>
        );

      case 2:
        return (
          <div className="onboarding-content onboarding-photo-container">
            <h2 className="onboarding-header">
            कोई भी फ़ोटो अपलोड करें
              <br />
              <span className="onboarding-header-hindi">Upload any photo</span>
            </h2>
            <img 
              src="/assets/onboarding-photo-1.png" 
              alt="Couple photo" 
              className="onboarding-photo"
            />
            {showSparkle && <SparkleIcon />}
          </div>
        );

      case 3:
        return (
          <div className="onboarding-content onboarding-video-container">
            <h2 className="onboarding-header">
            आपकी कूकू पत्रिका तैयार!
              <br />
              <span className="onboarding-header-hindi">Your wedding invite is ready!</span>
            </h2>
            <video 
              className="onboarding-video"
              src="/assets/sample.mp4"
              autoPlay
              muted
              loop
              playsInline
              controls
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="onboarding-screen">
      {step > 1 && (
        <button 
          className="back-btn"
          onClick={handleBack}
          disabled={showSparkle}
          aria-label="Go back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
      )}
      
      {renderContent()}
      
      <button 
        className="continue-btn"
        onClick={handleContinue}
      >
        Continue (आगे बढ़ें)
      </button>
    </div>
  );
}
