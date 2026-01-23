/**
 * Dev Logger Utility (Backend/Node.js version)
 * 
 * Logs detailed step-by-step information when dev mode is enabled.
 * Dev mode is controlled via environment variable DEV_MODE.
 */

/**
 * Check if dev mode is currently enabled
 */
export function isDevMode() {
  return process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";
}

/**
 * Log a message only when dev mode is enabled
 * @param {string} component - Component/module name (e.g., "Server", "Gemini")
 * @param {string} step - Step name/description
 * @param {object} data - Optional data to log
 */
export function devLog(component, step, data = null) {
  if (!isDevMode()) return;
  
  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  const prefix = `[DEV ${timestamp}] [${component}]`;
  
  if (data !== null && data !== undefined) {
    console.log(`${prefix} ${step}`, data);
  } else {
    console.log(`${prefix} ${step}`);
  }
}

/**
 * Log an error only when dev mode is enabled
 * @param {string} component - Component/module name
 * @param {string} step - Step name/description
 * @param {Error|string} error - Error to log
 */
export function devError(component, step, error) {
  if (!isDevMode()) return;
  
  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  const prefix = `[DEV ${timestamp}] [${component}]`;
  
  console.error(`${prefix} ERROR - ${step}:`, error);
}

/**
 * Log a warning only when dev mode is enabled
 * @param {string} component - Component/module name
 * @param {string} step - Step name/description
 * @param {string} message - Warning message
 */
export function devWarn(component, step, message) {
  if (!isDevMode()) return;
  
  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  const prefix = `[DEV ${timestamp}] [${component}]`;
  
  console.warn(`${prefix} WARN - ${step}:`, message);
}

/**
 * Create a scoped logger for a specific component
 * @param {string} component - Component name
 * @returns {object} - Scoped logger with log, error, warn methods
 */
export function createDevLogger(component) {
  return {
    log: (step, data = null) => devLog(component, step, data),
    error: (step, error) => devError(component, step, error),
    warn: (step, message) => devWarn(component, step, message),
    isEnabled: isDevMode,
  };
}

export default {
  log: devLog,
  error: devError,
  warn: devWarn,
  isDevMode,
  createDevLogger,
};
