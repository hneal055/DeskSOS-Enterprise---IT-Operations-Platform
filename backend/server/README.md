# DESKSOS Enterprise - Backend Server

Node.js + Express backend with Socket.io for real-time features and PostgreSQL database.

## Quick Start

### Local Development

1. **Install dependencies**
   \`\`\`bash
   npm install
   \`\`\`

2. **Setup environment**
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your configuration
   \`\`\`

3. **Run development server**
   \`\`\`bash
   npm run dev
   \`\`\`

   Server will start at \`http://localhost:5000\`

### Docker Setup

1. **Build and run with Docker Compose**
   \`\`\`bash
   cd ..
   docker-compose up --build
   \`\`\`

2. **Services will be available at:**
   - API Server: http://localhost:5000
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379
   - Nginx: http://localhost

## API Endpoints

### Dashboard
- \`GET /api/dashboard\` - Dashboard metrics
- \`GET /api/dashboard/metrics\` - Detailed metrics

### Chat
- \`GET /api/chat/channels\` - All channels
- \`GET /api/chat/channels/:id/messages\` - Channel messages

### Authentication
- \`POST /api/auth/login\` - User login
- \`POST /api/auth/register\` - User registration
- \`POST /api/auth/logout\` - User logout

### User
- \`GET /api/user/me\` - Current user profile

## WebSocket Events

### Client → Server
- \`user:join\` - User joins with profile
- \`message:send\` - Send message (with callback)
- \`user:typing\` - User is typing
- \`user:typing:stop\` - User stopped typing

### Server → Client
- \`message:new\` - New message received
- \`user:typing\` - User typing notification
- \`user:typing:stop\` - User stopped typing notification
- \`presence:update\` - Online users list updated

## Project Structure

\`\`\`
src/
├── config/       # Configuration files
├── database/     # Database setup
├── routes/       # API route definitions
├── services/     # Business logic (Socket.io, auth, etc)
├── middleware/   # Express middleware
└── index.ts      # Application entry point
\`\`\`

## Environment Variables

See \`.env.example\` for all available configuration options.

Key variables:
- \`NODE_ENV\` - Environment (development/production)
- \`PORT\` - Server port (default: 5000)
- \`JWT_SECRET\` - Secret for JWT tokens
- \`DB_*\` - PostgreSQL connection parameters

## Scripts

- \`npm run dev\` - Start development server with ts-node
- \`npm run build\` - Compile TypeScript to JavaScript
- \`npm start\` - Run compiled server (production)

## Technologies

- **Express** - Web framework
- **Socket.io** - Real-time bidirectional communication
- **PostgreSQL** - Relational database
- **TypeScript** - Type-safe JavaScript
- **JWT** - Token-based authentication
- **Docker** - Containerization
