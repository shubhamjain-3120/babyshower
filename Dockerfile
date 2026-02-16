FROM node:18-slim

# Install FFmpeg, librsvg2-bin, and libgomp1 (required for server-side video + onnx runtime)
RUN apt-get update && apt-get install -y ffmpeg librsvg2-bin libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for backend
COPY backend/package*.json ./backend/

# Install backend dependencies
RUN cd backend && npm ci --only=production

# Copy backend code
COPY backend/ ./backend/

# Copy only the frontend assets we need (not the whole frontend)
COPY frontend/public/fonts/ ./frontend/public/fonts/
COPY frontend/public/assets/ ./frontend/public/assets/

# Set working directory to backend
WORKDIR /app/backend

# Expose port (Fly.io convention is 8080)
EXPOSE 8080

# Start server
CMD ["npm", "start"]
