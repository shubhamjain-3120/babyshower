/**
 * File validation utilities for image uploads
 */

// File size and type constraints (internal only)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Validates an uploaded file against size and type constraints
 * @param {File} file - The file to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export const validateFile = (file) => {
  if (!file) return { valid: false, error: "no file selected" };
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "file too large. maximum size is 10mb." };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { valid: false, error: "invalid file type. please upload a jpeg, png, webp, or gif image." };
  }
  return { valid: true };
};
