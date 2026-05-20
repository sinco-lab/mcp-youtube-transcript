# Stage 1: Build the application
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build

# Stage 2: Create the production image
FROM node:18-alpine AS production

LABEL org.opencontainers.image.title="MCP YouTube Transcript Server"
LABEL org.opencontainers.image.description="TypeScript MCP server for retrieving YouTube transcripts"
LABEL org.opencontainers.image.source="https://github.com/sinco-lab/mcp-youtube-transcript"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy the built files from the builder stage
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev

# Change ownership to non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Specify the default command
ENTRYPOINT ["node", "dist/index.js"]
