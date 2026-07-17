# Stage 1: Build React static assets
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx and setup Wget health check
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY --from=builder /app/build/index.html /usr/share/nginx/html/index.html
EXPOSE 80

# Use wget (available in Alpine) instead of curl to avoid the unhealthy loop bug
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q -O - http://localhost/ > /dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
