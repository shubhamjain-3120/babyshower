# Deploy Plan

- [x] Confirm deployment targets: FE on Render (`https://bunny-invites.onrender.com`), BE on Fly (`https://bunny-invites-api.fly.dev`) and the Fly app name.
- [x] Align config between local and prod:
  - [x] Backend CORS allows FE origin via `CORS_ORIGIN`.
  - [x] Frontend `VITE_API_URL` points to BE.
  - [x] Ensure COOP/COEP headers in production for SharedArrayBuffer (FFmpeg).
- [x] Fix backend static asset paths to use repo `frontend/public` (so prod Docker matches local).
- [x] Add deployment config files (Render blueprint / headers) if needed for reproducible FE deploy.
- [x] Validate build/deploy steps and document exact commands + env vars for both services.

## Review
- [x] Deployment verified and any follow-ups noted
- [ ] Follow-up: consider upgrading backend Docker base image to Node 20+ (build warns @google/genai requires >=20).
