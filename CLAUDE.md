# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wedding Invite Generator MVP - A Progressive Web App for generating personalized Marwadi wedding invitations with AI-generated couple portraits. Uses GPT-4o or Gemini for photo analysis and Imagen 3 for portrait generation, with a React frontend and Node.js Express backend. Targets iOS/Android via Capacitor and web (PWA).

## Commands

### Backend
```bash
cd backend
npm install
npm run dev                    # Development with watch mode
GEMINI_API_KEY=your_key npm run dev  # With API key
```

### Frontend
```bash
cd frontend
npm install
npm run dev                    # Vite dev server on localhost:5173
npm run build                  # Production build to dist/
npm run build:apk              # Build Android APK (requires VITE_API_URL)
npm run build:analyze          # Bundle size visualization
```

### Full Local Development
Run backend (terminal 1) and frontend (terminal 2) simultaneously. Frontend proxies API requests to backend via Vite config.

## Architecture

### Generation Pipeline
```
1. Photo Upload → 2. GPT-4o or Gemini analyzes photo → 3. Imagen 3 generates portrait
→ 4. @imgly/background-removal (client-side) → 5. FFmpeg video composition
→ 6. ResultScreen displays + share
```

### Key Files

**Backend:**
- `server.js` - Express API: `/api/generate` (portrait), `/api/convert-video`, `/api/compose-video`
- `gemini.js` - AI integration: photo analysis prompts + Imagen 3 generation

**Frontend:**
- `App.jsx` - Main orchestration, screen routing, generation flow (handleGenerate method)
- `components/InputScreen.jsx` - Form collection, photo upload, validation
- `utils/videoComposer.js` - Server-side video composition with overlays
- `utils/composerShared.js` - Shared typography and color utilities

### Video Composition Strategy
- **Client-side**: FFmpeg.wasm when SharedArrayBuffer available
- **Server-side fallback**: `/api/compose-video` for Chrome iOS and other unsupported browsers

### Canvas Layout (1080×1920px)
- 0-11.5%: Decorative arch
- 11.5-22%: Names (AlexBrush font, gold gradient)
- 22-82%: AI-generated character overlay
- 82-100%: Date/Venue (Playfair Display font)

## Environment Variables

### Backend
```bash
GEMINI_API_KEY=...                  # Required: Google Gemini API key
PORT=3001                           # Express server port
GOOGLE_GENAI_USE_VERTEXAI=true      # For Imagen 3 via Vertex AI
GOOGLE_CLOUD_PROJECT=...            # GCP project ID
OPENAI_API_KEY=...                  # Required if using GPT for photo analysis
PHOTO_ANALYSIS_PROVIDER=gpt         # Photo analysis provider: "gpt" (default) or "gemini"
DEV_MODE=true                       # Enhanced logging
```

### Frontend
```bash
VITE_API_URL=...                # Production backend URL (dev uses Vite proxy)
```

## Dev Mode

Triggered by venue name "Hotel Jain Ji Shubham" or `DEV_MODE=true`. Skips API calls, background removal, video composition, and rate limiting.

## Rate Limiting

- Backend: 10 requests/week per IP (express-rate-limit)
- Frontend: Tracks in localStorage, shows remaining count
- Reset in console: `localStorage.removeItem('generation-count')`

## Critical Implementation Notes

1. **Image validation**: Server validates magic bytes (JPEG/PNG/GIF/WebP), not just MIME type
2. **Background removal**: Uses @imgly/background-removal WASM model (~100MB, loads on first use)
3. **Chrome iOS**: FFmpeg.wasm broken (SharedArrayBuffer), always falls back to server-side
4. **Fonts**: Must be in `public/fonts/` for server-side video composition
5. **Autoplay audio**: Browsers block until user interaction


Instructions for claude
Context
I am a solo developer working on personal/small projects

This is NOT an enterprise-level project

I prefer simple, direct solutions over "best practices"

I'm a vibe coder who values shipping over perfect architecture

Default Approach
Always assume this is a POC (Proof of Concept) unless explicitly told otherwise

Keep it simple and direct - don't overthink it

Start with the most obvious solution that works

No frameworks unless absolutely necessary

Prefer single files over multiple files when reasonable

Hardcode reasonable defaults instead of building configuration systems

What NOT to do
Don't add abstractions until we actually need them

Don't build for imaginary future requirements

Don't add complex error handling for edge cases that probably won't happen

Don't suggest design patterns unless the problem actually requires them

Don't optimize prematurely

Don't add configuration for things that rarely change

Transition Guidelines
If the POC works and needs to become more robust:

Add basic error handling (try/catch, input validation)

Improve user-facing messages

Extract functions only for readability, not for "reusability"

Keep the same simple approach - just make it more reliable

Language to Use
"Quick POC to test if this works"

"Throwaway prototype"

"Just make it work"

"The dumbest thing that works"

"Keep it simple and direct"

When in Doubt
Ask: "Would copy-pasting this code be simpler than making it generic?" If yes, copy-paste it.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don’t keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 3. Self-Improvement Loop
- After ANY correction from the user, update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff your behavior between main and your changes when relevant
- Ask yourself: “Would a staff engineer approve this?”
- Run tests, check logs, demonstrate correctness

## Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Hackiness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what’s necessary. Avoid introducing bugs.





 '''
