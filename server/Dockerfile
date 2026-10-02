<<<<<<< HEAD
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY . .
EXPOSE 8000
CMD ["npm", "start"]
=======
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
>>>>>>> 2a79807dc113d630d091fd830adf15c0a9d673e0
