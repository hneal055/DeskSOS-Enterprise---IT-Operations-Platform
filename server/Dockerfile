FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Create uploads directory
RUN mkdir -p uploads

# Expose ports
EXPOSE 5000

# Start application
CMD ["npm", "run", "start"]
