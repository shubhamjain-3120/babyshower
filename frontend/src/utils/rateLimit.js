/**
 * Client-side rate limiting utility
 * Tracks generation count per week using localStorage
 * 
 * Note: This is a soft limit - users can bypass by clearing localStorage.
 * For actual abuse prevention, server-side enforcement is required.
 */

const STORAGE_KEY = 'wedding-invite-rate-limit';
const MAX_GENERATIONS = 10;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/**
 * Get the current rate limit state
 * @returns {{ count: number, remaining: number, resetAt: number, canGenerate: boolean }}
 */
export function getRateLimitState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      
      // Check if window has expired
      if (Date.now() > data.resetAt) {
        // Reset the counter
        const newState = {
          count: 0,
          resetAt: Date.now() + WINDOW_MS,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        return {
          count: 0,
          remaining: MAX_GENERATIONS,
          resetAt: newState.resetAt,
          canGenerate: true,
        };
      }
      
      return {
        count: data.count,
        remaining: Math.max(0, MAX_GENERATIONS - data.count),
        resetAt: data.resetAt,
        canGenerate: data.count < MAX_GENERATIONS,
      };
    }
  } catch (e) {
    console.warn('[RateLimit] Failed to read state:', e);
  }
  
  // Initialize fresh state
  const newState = {
    count: 0,
    resetAt: Date.now() + WINDOW_MS,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  } catch (e) {
    console.warn('[RateLimit] Failed to initialize state:', e);
  }
  
  return {
    count: 0,
    remaining: MAX_GENERATIONS,
    resetAt: newState.resetAt,
    canGenerate: true,
  };
}

/**
 * Increment the generation counter
 * Call this after a successful generation
 * @returns {{ count: number, remaining: number, resetAt: number, canGenerate: boolean }}
 */
export function incrementGenerationCount() {
  try {
    const state = getRateLimitState();
    const newCount = state.count + 1;
    
    const newState = {
      count: newCount,
      resetAt: state.resetAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    
    return {
      count: newCount,
      remaining: Math.max(0, MAX_GENERATIONS - newCount),
      resetAt: state.resetAt,
      canGenerate: newCount < MAX_GENERATIONS,
    };
  } catch (e) {
    console.warn('[RateLimit] Failed to increment count:', e);
    return getRateLimitState();
  }
}

/**
 * Check if user can generate (without incrementing)
 * @returns {boolean}
 */
export function canGenerate() {
  return getRateLimitState().canGenerate;
}

/**
 * Format reset time as human-readable string
 * @param {number} resetAt - Unix timestamp in ms
 * @returns {string}
 */
export function formatResetTime(resetAt) {
  const now = Date.now();
  const diff = resetAt - now;
  
  if (diff <= 0) return 'now';
  
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  
  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  
  const minutes = Math.floor(diff / (60 * 1000));
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

/**
 * Get max generations allowed
 * @returns {number}
 */
export function getMaxGenerations() {
  return MAX_GENERATIONS;
}
