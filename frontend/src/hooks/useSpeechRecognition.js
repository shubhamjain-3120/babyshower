import { useState, useCallback, useRef } from "react";

/**
 * Custom hook for browser speech recognition using the Web Speech API.
 *
 * Provides voice input functionality for form fields using the browser's
 * native SpeechRecognition API. Configured for English (India) locale
 * to support transliteration of Marwadi names in English alphabets.
 *
 * @returns {Object} Speech recognition controls and state
 * @returns {boolean} returns.isListening - Whether speech recognition is currently active
 * @returns {string|null} returns.activeField - ID of the field currently being dictated to
 * @returns {Function} returns.startListening - Start listening for speech (fieldId: string, onResult: (text: string) => void)
 * @returns {Function} returns.stopListening - Stop listening for speech
 * @returns {boolean} returns.isSupported - Whether speech recognition is supported in the current browser
 *
 * @example
 * const { isListening, startListening, stopListening, isSupported } = useSpeechRecognition();
 *
 * if (isSupported) {
 *   startListening('brideName', (text) => {
 *     console.log('Received:', text);
 *   });
 * }
 */
export default function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const recognitionRef = useRef(null);
  const callbackRef = useRef(null);

  // Check if speech recognition is supported
  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // Start listening for speech
  const startListening = useCallback(
    (fieldId, onResult) => {
      if (!isSupported) {
        alert("voice input is not supported in this browser");
        return;
      }

      // Stop any existing recognition
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();

      // Configure recognition - use English (India) for transliteration in English alphabets
      recognition.lang = "en-IN";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      // Store callback
      callbackRef.current = onResult;

      recognition.onstart = () => {
        setIsListening(true);
        setActiveField(fieldId);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        // Capitalize first letter
        const capitalizedTranscript = transcript.charAt(0).toUpperCase() + transcript.slice(1);
        if (callbackRef.current) {
          callbackRef.current(capitalizedTranscript);
        }
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        setActiveField(null);

        if (event.error === "not-allowed") {
          alert("microphone access denied. please allow microphone access.");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setActiveField(null);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    },
    [isSupported]
  );

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  return {
    isListening,
    activeField,
    startListening,
    stopListening,
    isSupported,
  };
}
