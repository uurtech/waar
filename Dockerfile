# Use Node.js 20 on Alpine Linux for smaller image size
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ sqlite

# Set working directory
WORKDIR /var/app

# Copy package files
COPY app/package*.json ./

# Install dependencies
RUN npm install --only=production && \
    npm cache clean --force

# Production stage
FROM node:20-alpine AS production

# Install runtime dependencies and build tools for native modules
RUN apk add --no-cache sqlite dumb-init python3 make g++

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Set working directory
WORKDIR /var/app

# Create required directories with proper permissions
RUN mkdir -p /var/app/temp && \
    mkdir -p /var/app/logs && \
    mkdir -p /var/app/data && \
    mkdir -p /var/app/mapped_source && \
    chown -R appuser:appgroup /var/app

# Copy application files
COPY --from=builder /var/app/node_modules ./node_modules
COPY app/ .
COPY .env .env

# Set proper ownership
RUN chown -R appuser:appgroup /var/app

# Switch to non-root user
USER appuser

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/var/app/data/well_architected.db
ENV LOG_LEVEL=info

# Expose port
EXPOSE 8080

# Add labels for better maintainability
LABEL maintainer="Well-Architected Reviewer" \
      version="1.0.0" \
      description="AWS Well-Architected Framework reviewer with Bedrock AI integration" \
      config.format=".env" \
      config.mount="/var/app/.env" \
      source.mount="/var/app/mapped_source"

# Use dumb-init as PID 1 to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"] 