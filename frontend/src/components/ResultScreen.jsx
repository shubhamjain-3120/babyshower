import { useCallback, useEffect, useState } from "react";
import { createDevLogger } from "../utils/devLogger";
import { trackPageView, trackClick } from "../utils/analytics";
import { isPaypalEnabled, purchaseVideoDownload as paypalPurchase } from "../utils/paypalManager";
import { getPaymentPlatform, getUserRegion } from "../utils/paymentPlatform";

const logger = createDevLogger("ResultScreen");

// Sanitize names for use in filenames - prevent path traversal and special chars
const sanitizeForFilename = (name) => {
  if (!name) return "unknown";
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") // Remove invalid filename chars
    .replace(/\.\./g, "") // Prevent path traversal
    .replace(/[^\w\s-]/g, "") // Keep only word chars, spaces, hyphens
    .trim()
    .substring(0, 30) || "unknown";
};

function getFileExtension(blob) {
  if (!(blob instanceof Blob)) return 'mp4';
  const type = blob.type;
  if (type.startsWith('image/')) {
    const ext = type.split('/')[1] || 'png';
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return type === 'video/mp4' ? 'mp4' : 'webm';
}

export default function ResultScreen({ inviteVideo, parentsName, venue, onReset }) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [isImage, setIsImage] = useState(false);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);

  // Track page view on mount
  useEffect(() => {
    trackPageView('result');
  }, []);

  // Create object URL from blob when media changes
  useEffect(() => {
    logger.log("Media prop received", {
      type: inviteVideo instanceof Blob ? "Blob" : typeof inviteVideo,
      size: inviteVideo instanceof Blob ? `${(inviteVideo.size / 1024 / 1024).toFixed(2)} MB` : "N/A",
      mimeType: inviteVideo instanceof Blob ? inviteVideo.type : "N/A",
    });

    if (inviteVideo instanceof Blob) {
      const url = URL.createObjectURL(inviteVideo);
      setMediaUrl(url);
      
      // Check if it's an image or video based on MIME type
      const isImageType = inviteVideo.type.startsWith('image/');
      setIsImage(isImageType);
      
      logger.log("Media URL created from Blob", { 
        url: url.slice(0, 50) + "...",
        isImage: isImageType,
        mimeType: inviteVideo.type
      });
      
      // Cleanup URL on unmount or when media changes
      return () => {
        logger.log("Cleaning up media URL");
        URL.revokeObjectURL(url);
      };
    } else if (typeof inviteVideo === 'string') {
      // Already a URL
      setMediaUrl(inviteVideo);
      // Try to detect if it's an image from the URL
      setIsImage(inviteVideo.match(/\.(png|jpg|jpeg|gif|webp)$/i) !== null);
      logger.log("Using existing media URL");
    }
  }, [inviteVideo]);

  // Determine payment requirements
  const userRegion = getUserRegion();
  const paymentPlatform = getPaymentPlatform();
  const isPaypal = paymentPlatform === 'paypal' && isPaypalEnabled();
  const requiresPayment = isPaypal && !hasPurchased;

  // Debug logging
  logger.log("Payment Config", {
    paymentPlatform,
    requiresPayment,
    userRegion,
    venue
  });

  // Get display price for button
  const buttonPrice = userRegion.displayPrice;

  // Internal download logic (extracted from original handleDownload)
  const handleDownloadInternal = useCallback(() => {
    trackClick(isImage ? 'image_download' : 'video_download');

    logger.log("Download initiated", {
      parentsName,
      mediaSize: inviteVideo instanceof Blob ? `${(inviteVideo.size / 1024 / 1024).toFixed(2)} MB` : "N/A",
      mediaType: inviteVideo instanceof Blob ? inviteVideo.type : "N/A",
      isImage,
    });

    if (!inviteVideo) {
      logger.warn("Download", "No media available");
      return;
    }

    const link = document.createElement("a");

    if (inviteVideo instanceof Blob) {
      link.href = URL.createObjectURL(inviteVideo);
    } else {
      link.href = inviteVideo;
    }

    const extension = getFileExtension(inviteVideo);

    // Sanitize name to prevent filename injection
    link.download = `babyshower-invite-${sanitizeForFilename(parentsName)}.${extension}`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Cleanup the temporary URL
    if (inviteVideo instanceof Blob) {
      URL.revokeObjectURL(link.href);
    }

    logger.log("Download complete", { filename: link.download, actualType: inviteVideo?.type });
  }, [inviteVideo, parentsName, isImage]);

  // Purchase handler
  const handlePurchase = useCallback(async () => {
    setIsPurchasing(true);
    logger.log("Initiating purchase flow", { paymentPlatform });

    let result;
    if (isPaypal) {
      result = await paypalPurchase(venue, userRegion);
    } else {
      result = { success: true };
    }

    if (result.success) {
      logger.log("Purchase successful - unlocking download");
      setHasPurchased(true);

      // Auto-download after purchase
      setTimeout(() => {
        handleDownloadInternal();
      }, 100);
    } else if (result.error !== 'cancelled') {
      // Show error alert (except for user cancellation)
      alert(`purchase failed: ${result.error}`);
      logger.error("Purchase failed", result.error);
    }

    setIsPurchasing(false);
  }, [handleDownloadInternal, isPaypal, paymentPlatform, venue, userRegion]);

  // Main download handler with payment gate
  const handleDownload = useCallback(() => {
    if (requiresPayment) {
      handlePurchase();
    } else {
      handleDownloadInternal();
    }
  }, [requiresPayment, handlePurchase, handleDownloadInternal]);

  const handleShare = useCallback(async () => {
    logger.log("Share initiated", { parentsName, isImage });

    try {
      let file;
      
      if (inviteVideo instanceof Blob) {
        const extension = getFileExtension(inviteVideo);
        file = new File([inviteVideo], `babyshower-invite-${sanitizeForFilename(parentsName)}.${extension}`, {
          type: inviteVideo.type,
        });
        logger.log("Created file from Blob for sharing", { extension, mimeType: inviteVideo.type });
      } else {
        logger.log("Converting URL to blob for sharing");
        const response = await fetch(inviteVideo);
        const blob = await response.blob();
        const extension = getFileExtension(blob);
        file = new File([blob], `babyshower-invite-${sanitizeForFilename(parentsName)}.${extension}`, {
          type: blob.type,
        });
      }

      // Check if Web Share API is available and can share files
      const canShare = navigator.share && navigator.canShare?.({ files: [file] });
      logger.log("Checking share capability", { canShare });

      if (canShare) {
        trackClick(isImage ? 'image_share' : 'video_share', { share_method: 'native' });
        logger.log("Using Web Share API");
        await navigator.share({
          title: `${parentsName} baby shower invite`,
          text: `join us for a baby shower celebration! 🎉👶\ncelebrating the upcoming arrival.`,
          files: [file],
        });
        logger.log("Share completed successfully");
      } else {
        // Fallback: Open WhatsApp with text (media needs manual attachment)
        trackClick(isImage ? 'image_share' : 'video_share', { share_method: 'whatsapp_fallback' });
        logger.log("Falling back to WhatsApp share");
        const text = encodeURIComponent(
          `join us for a baby shower celebration! 🎉👶\ncelebrating the upcoming arrival.`
        );
        window.open(`https://wa.me/?text=${text}`, "_blank");
        alert(`download the ${isImage ? 'image' : 'video'} and attach it to your whatsapp message`);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        logger.error("Share failed", err);
        // Fallback to WhatsApp
        const text = encodeURIComponent(
          `join us for a baby shower celebration! 🎉👶\ncelebrating the upcoming arrival.`
        );
        window.open(`https://wa.me/?text=${text}`, "_blank");
      } else {
        logger.log("Share cancelled by user");
      }
    }
  }, [inviteVideo, parentsName, isImage]);

  return (
    <div className="result-screen">
      <div className={`invite-preview ${isImage ? 'image-preview' : 'video-preview'}`}>
        {mediaUrl ? (
          isImage ? (
            <img 
              src={mediaUrl} 
              className="invite-image" 
              alt="baby shower invite preview"
            />
          ) : (
            <video
              src={mediaUrl}
              className="invite-video"
              controls
              autoPlay
              muted
              loop
              playsInline
            />
          )
        ) : (
          <div className="video-loading">loading {isImage ? 'image' : 'video'}...</div>
        )}
      </div>

      <div className="action-buttons">
        {/* Conditional Download/Buy button */}
        <button
          className={requiresPayment ? "buy-download-btn" : "download-btn"}
          onClick={handleDownload}
          disabled={isPurchasing}
        >
          {isPurchasing ? (
            <>⏳ processing...</>
          ) : requiresPayment ? (
            <>💳 buy & download ({buttonPrice})</>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {isImage ? 'download image' : 'download video'}
</>
          )}
        </button>

        {/* Share button - only show after purchase/free download */}
        {!requiresPayment && (
          <button className="share-btn" onClick={handleShare}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            share
          </button>
        )}

        <button className="start-over-btn" onClick={() => {
          trackClick('start_over');
          onReset();
        }}>
          start over
        </button>
      </div>
    </div>
  );
}
