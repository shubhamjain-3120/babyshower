import { useState, useRef, useEffect } from "react";
import { createDevLogger } from "../utils/devLogger";
import { trackPageView, trackClick } from "../utils/analytics";
import { getImageProcessingService } from "../utils/imageProcessingService";
import { validateFile } from "../utils/fileValidation";

const logger = createDevLogger("PhotoUploadScreen");

/**
 * Photo Upload Screen - Simple photo selection for baby shower
 *
 * Flow (Simplified - no extraction):
 * 1. User uploads photo
 * 2. Photo is validated
 * 3. User can immediately proceed to form
 * 4. Processing starts later during generation
 */

export default function PhotoUploadScreen({ onPhotoSelected, apiUrl }) {
  const [photo, setPhoto] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const fileInputRef = useRef(null);
  const processingServiceRef = useRef(null);

  // Track page view on mount
  useEffect(() => {
    trackPageView('photo_upload');
  }, []);

  // Initialize image processing service on mount
  useEffect(() => {
    processingServiceRef.current = getImageProcessingService();
  }, []);

  // Create object URL for preview
  useEffect(() => {
    if (photo) {
      const url = URL.createObjectURL(photo);
      setPhotoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [photo]);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const file = files[0];
    const validation = validateFile(file);

    if (!validation.valid) {
      alert(validation.error);
      e.target.value = "";
      return;
    }

    trackClick('photo_selected', {
      size: `${(file.size / 1024).toFixed(1)} KB`,
      type: file.type,
    });

    setPhoto(file);
    e.target.value = ""; // Allow re-selecting same file

    // Start background processing immediately after photo selection
    if (processingServiceRef.current) {
      // Cancel any in-flight processing for a previous photo
      processingServiceRef.current.cancel();
      logger.log("Starting background processing after photo selection", {
        photoSize: `${(file.size / 1024).toFixed(1)} KB`,
        photoType: file.type,
      });
      processingServiceRef.current.startProcessing(file, apiUrl);
    }
  };

  // Handle changing photo
  const handleChangePhoto = (e) => {
    // Stop event propagation if called from button
    e?.stopPropagation();

    // Cancel background processing if any
    if (processingServiceRef.current) {
      processingServiceRef.current.cancel();
    }

    // Reset state
    setPhoto(null);
    setPhotoUrl(null);

    // Open file picker
    trackClick('photo_change_click');
    fileInputRef.current?.click();
  };

  const handleProceed = () => {
    if (!photo) {
      alert("please upload a photo first");
      return;
    }

    trackClick('photo_upload_proceed');

    // Pass photo and processing service to parent (no extraction/descriptions)
    onPhotoSelected({
      photo,
      processingService: processingServiceRef.current,
      processingState: processingServiceRef.current?.getStatus?.(),
    });
  };

  return (
    <div className="input-screen photo-upload-screen">
      <div className="form">
        {/* Header */}
        <div className="hero-container">
          <div className="form-group">
            <label>photo upload</label>
            <p className="form-hint">
              choose a clear, good quality baby photo
            </p>
          </div>
        </div>

        {/* Upload Section */}
        <div className="form-group">
          <label>baby photo</label>
          {!photo ? (
            <button
              type="button"
              className="upload-btn upload-btn-large"
              onClick={() => {
                trackClick('photo_upload_click');
                fileInputRef.current?.click();
              }}
            >
              <span className="upload-icon">+</span>
              <span className="upload-text">select your photo</span>
            </button>
          ) : (
            <div className="photo-single">
              <div
                className="photo-card photo-card-clickable"
                onClick={handleChangePhoto}
                style={{ cursor: 'pointer' }}
              >
                <div className="photo-preview" style={{ position: 'relative', width: '100%', height: 'auto', maxWidth: '280px' }}>
                  <img src={photoUrl} alt="selected photo" style={{ width: '100%', height: 'auto', display: 'block' }} />

                  {/* Change Photo Button */}
                  <button
                    type="button"
                    className="change-photo-btn"
                    onClick={handleChangePhoto}
                    aria-label="change photo"
                  >
                    change photo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="generate-btn"
          onClick={handleProceed}
          disabled={!photo}
        >
          {photo ? "continue" : "select photo"}
        </button>

        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
