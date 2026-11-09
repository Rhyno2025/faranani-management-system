# Production image for the Faranani management system.
# Node 24 is required: the API uses the built-in node:sqlite module (22.13+).
FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

# Install dependencies first so the layer is cached across code changes.
COPY package.json package-lock.json ./
RUN npm ci

# Build the SPA, then drop the build tooling from the runtime image.
COPY . .
RUN npm run build && npm prune --omit=dev

# Writable locations: SQLite database (server/data) and uploaded documents (uploads).
RUN mkdir -p server/data uploads
VOLUME ["/app/server/data", "/app/uploads"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Express serves the built frontend and the API from this single process.
CMD ["node", "server/index.js"]
