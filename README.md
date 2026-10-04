# DeskSOS Enterprise - IT Operations Platform

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node.js](https://img.shields.io/badge/Node.js-22-green)
![React](https://img.shields.io/badge/React-18.3-61dafb)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)
![Redis](https://img.shields.io/badge/Redis-7-red)
![Docker](https://img.shields.io/badge/Docker-ready-blue)

Full-stack enterprise web platform for IT operations teams. Built with Node.js, React, PostgreSQL, and Redis. Features real-time collaboration, ticketing system, chat, and comprehensive dashboard.

## 🌐 Overview

DeskSOS Enterprise is a comprehensive web-based platform for managing IT support operations at scale. Designed for teams that need centralized ticketing, real-time collaboration, and operational visibility.

**Perfect for:**
- IT Operations teams managing enterprise infrastructure
- Help Desk departments with distributed technicians
- MSP (Managed Service Provider) operations
- Multi-site IT support coordination

## ✨ Key Features

### 📊 Operations Dashboard
- Real-time metrics and KPIs
- Ticket status visualization
- Team performance analytics
- System health monitoring
- Customizable widgets

### 🎫 Ticketing System
- Create, assign, and track support tickets
- Priority and category management
- Status workflows (Open → In Progress → Resolved → Closed)
- Attachment support
- Comment threads
- Email notifications

### 💬 Team Chat
- Real-time messaging with WebSocket
- Channel-based organization
- User presence indicators (online/offline/away)
- Typing indicators
- Message history
- @mentions and notifications

### 👥 User Management
- Role-based access control (Admin, Technician, User)
- User authentication with JWT
- Profile management
- Activity tracking
- Audit logs

### 🔔 Notifications
- Real-time push notifications
- Email alerts
- Ticket assignments
- Status updates
- System announcements

## 🚀 Quick Start

### Development Mode

```bash
# Clone repository
git clone https://github.com/hneal055/DeskSOS-Enterprise---IT-Operations-Platform.git
cd DeskSOS-Enterprise---IT-Operations-Platform

# Start with Docker Compose
docker-compose up --build

# Access application
# Frontend: http://localhost:3000
# Backend API: http://localhost:5000
# API Docs: http://localhost:5000/
```

### Local Development on Windows (PowerShell scripts)

Two scripts in the repo root manage a non-Docker dev session: the backend runs under PM2 and the React client runs with `npm start`. Postgres and Redis must already be reachable at the hosts configured in `backend/server/.env`. The backend always loads that file (not the repo-root `.env`, which belongs to a different stack), and listens on port 5100 because 5000 is used by the DESKSOS-Desktop backend.

| Script | What it does |
| ------ | ------------ |
| `start-dev.ps1` | Builds `backend/server`, (re)registers the `desksos-enterprise-backend` PM2 process, polls `http://localhost:5100/health`, then opens a PM2 log window and the React client window (<http://localhost:3000>). |
| `stop-dev.ps1` | Reverses `start-dev.ps1`. It removes `desksos-enterprise-backend` from PM2, closes the log and client windows, frees ports 5100 and 3000, sweeps orphaned PM2 daemons, and verifies the ports are free. Exits non-zero if anything is still running. |

**Clean restart of the UI dashboard:**

```powershell
.\stop-dev.ps1
.\start-dev.ps1
```

**`stop-dev.ps1` options:**

| Flag | Effect |
| ---- | ------ |
| `-DryRun` | Show what would be stopped without changing anything |
| `-Backup` | Run `backup-desksos.ps1` before tearing down |
| `-KillPm2` | Stop **all** PM2 daemons and every app they manage (full PM2 reset, also affects non-DeskSOS PM2 apps) |
| `-ClearCache` | Delete `client/node_modules/.cache` (fixes stale React builds) |
| `-Force` | Kill whatever holds ports 5100/3000, even if it doesn't look like DeskSOS |

The PM2 process name is deliberately `desksos-enterprise-backend`. The sibling `DESKSOS-Desktop` project registers its own backend as `desksos-backend` (port 5443), and sharing that name made `start-dev.ps1` restart the wrong app. Keep PM2 names unique per project.

Docker containers are never touched. The Postgres and Redis containers may be shared with other projects; stop them with `docker compose down` if you mean to.

#### Troubleshooting: `connect EPERM \\.\pipe\rpc.sock`

On Windows, PM2 communicates through the named pipe `\\.\pipe\rpc.sock`. If the PM2 daemon was started from an **elevated** ("Run as administrator") terminal, a non-elevated terminal can't connect to it. Each failed `pm2` call then starts a new daemon that also can't take the pipe, and these orphans pile up.

- Run `start-dev.ps1` and `stop-dev.ps1` from a terminal with the **same elevation** as the one that first started PM2. Pick one, always elevated or never, and stick with it.
- Both scripts detect this situation and exit with guidance instead of calling `pm2`.
- `stop-dev.ps1` removes orphaned daemons automatically. To start completely fresh, run `.\stop-dev.ps1 -KillPm2` from an elevated terminal.

### Production Deployment

```bash
# Build production containers
docker-compose -f docker-compose.prod.yml build

# Start production stack
docker-compose -f docker-compose.prod.yml up -d

# Access via Nginx (with SSL)
# https://your-domain.com
```

## 📋 System Requirements

### For Docker Deployment

| Component | Requirement |
|-----------|-------------|
| **Docker** | 20.10+ |
| **Docker Compose** | 2.0+ |
| **RAM** | 4 GB minimum (8 GB recommended) |
| **Disk Space** | 10 GB for images and data |
| **CPU** | 2 cores minimum (4 cores recommended) |

### For Manual Deployment

| Component | Version |
|-----------|---------|
| **Node.js** | 22+ |
| **PostgreSQL** | 16+ |
| **Redis** | 7+ |
| **Nginx** | 1.24+ (optional, for reverse proxy) |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Nginx (SSL/TLS)                    │
│              Reverse Proxy & Load Balancer          │
└─────────────────────┬───────────────────────────────┘
                      │
        ┌─────────────┴──────────────┐
        │                            │
┌───────▼────────┐          ┌────────▼────────┐
│  React Client  │          │  Express Server │
│   (Port 3000)  │◄────────►│   (Port 5000)   │
│                │ WebSocket│                 │
│  - Dashboard   │ Socket.io│  - REST API     │
│  - Chat UI     │          │  - WebSocket    │
│  - Ticketing   │          │  - Auth/JWT     │
└────────────────┘          └─────┬───┬───────┘
                                  │   │
                      ┌───────────┘   └─────────┐
                      │                          │
              ┌───────▼────────┐        ┌───────▼──────┐
              │   PostgreSQL   │        │    Redis     │
              │   (Port 5432)  │        │  (Port 6379) │
              │                │        │              │
              │  - Users       │        │  - Sessions  │
              │  - Tickets     │        │  - Cache     │
              │  - Messages    │        │  - Pub/Sub   │
              └────────────────┘        └──────────────┘
```

## 🛠️ Technology Stack

### Frontend
- **React 18.3** - UI library
- **TypeScript** - Type safety
- **Vite 6.4** - Build tool
- **Tailwind CSS** - Styling
- **TanStack Query** - Data fetching
- **Socket.io Client** - WebSocket communication

### Backend
- **Node.js 22** - Runtime
- **Express 4.21** - Web framework
- **TypeScript** - Type safety
- **Socket.io 4.8** - WebSocket server
- **JWT** - Authentication
- **Bcrypt** - Password hashing

### Database & Cache
- **PostgreSQL 16** - Primary database
- **Redis 7** - Caching and pub/sub
- **node-postgres (pg)** - PostgreSQL client

### Infrastructure
- **Docker & Docker Compose** - Containerization
- **Nginx** - Reverse proxy and SSL termination
- **PM2** - Process management (optional)

## 📦 Project Structure

```
DESKSOS-ENTERPRISE/
├── client/                       # React frontend
│   ├── src/
│   │   ├── components/          # UI components
│   │   ├── pages/               # Page components
│   │   ├── services/            # API clients
│   │   ├── hooks/               # Custom React hooks
│   │   ├── store/               # State management
│   │   └── App.tsx              # Root component
│   ├── package.json
│   └── vite.config.ts
├── backend/server/               # Node.js backend
│   ├── src/
│   │   ├── routes/              # API routes
│   │   │   ├── auth.ts
│   │   │   ├── dashboard.ts
│   │   │   ├── chat.ts
│   │   │   └── user.ts
│   │   ├── services/            # Business logic
│   │   │   ├── socket.ts        # WebSocket handling
│   │   │   └── auth.ts
│   │   ├── config/              # Configuration
│   │   │   ├── database.ts
│   │   │   └── index.ts
│   │   └── index.ts             # Entry point
│   ├── package.json
│   └── tsconfig.json
├── database/                     # Database migrations
│   └── init.sql
├── nginx/                        # Nginx configuration
│   ├── nginx.conf
│   └── ssl/                      # SSL certificates
├── docker-compose.yml           # Development
├── docker-compose.prod.yml      # Production
├── .env.example                 # Environment template
├── .env.production              # Production config
└── README.md                    # This file
```

## 🔧 Configuration

### Environment Variables

Create `.env` file:

```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=desksos_db
DB_USER=desksos_user
DB_PASSWORD=your-secure-password

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# API
NODE_ENV=production
PORT=5000
API_BASE_URL=http://nginx/api
WS_URL=ws://localhost/socket.io

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=notifications@company.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=noreply@desksos.com
```

## 🚀 Deployment

### Docker Compose (Recommended)

**Development:**
```bash
docker-compose up --build
```

**Production:**
```bash
# Build images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop services
docker-compose -f docker-compose.prod.yml down
```

### Manual Deployment

**1. Install Dependencies**
```bash
# Backend
cd backend/server
npm install
npm run build

# Frontend
cd ../../client
npm install
npm run build
```

**2. Setup Database**
```bash
# Create PostgreSQL database
createdb desksos_db

# Run migrations
psql desksos_db < database/init.sql
```

**3. Start Services**
```bash
# Redis
redis-server

# Backend (with PM2)
cd backend/server
pm2 start dist/index.js --name desksos-enterprise-backend

# Frontend (via Nginx)
# Configure Nginx to serve client/dist/
```

## 📡 API Documentation

### REST Endpoints

**Authentication:**
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout

**Dashboard:**
- `GET /api/dashboard` - Get dashboard data
- `GET /api/dashboard/metrics` - Get system metrics

**Chat:**
- `GET /api/chat/channels` - List channels
- `GET /api/chat/channels/:id/messages` - Get messages
- `POST /api/chat/channels/:id/messages` - Send message

**User:**
- `GET /api/user/me` - Get current user profile
- `PUT /api/user/me` - Update profile

### WebSocket Events

**Client → Server:**
- `user:join` - User joins platform
- `message:send` - Send chat message
- `user:typing` - User is typing

**Server → Client:**
- `message:new` - New message received
- `presence:update` - User presence changed
- `notification:new` - New notification

## 🧪 Testing

```bash
# Backend tests
cd backend/server
npm test

# Frontend tests
cd client
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:coverage
```

## 🔐 Security

- **JWT Authentication** - Secure token-based auth
- **Password Hashing** - Bcrypt with salt
- **SQL Injection Protection** - Parameterized queries
- **XSS Prevention** - Input sanitization
- **CORS Configuration** - Controlled origins
- **Rate Limiting** - API throttling
- **SSL/TLS** - HTTPS encryption
- **Environment Variables** - Sensitive data protection

## 📊 Monitoring

**Logs:**
```bash
# Application logs
docker-compose logs -f server

# Nginx access logs
docker-compose logs -f nginx

# Database logs
docker-compose logs -f postgres
```

**Health Checks:**
- Backend: `http://localhost:5000/health`
- Database: `docker exec postgres pg_isready`
- Redis: `docker exec redis redis-cli ping`

## 🚧 Roadmap

- [x] Core ticketing system
- [x] Real-time chat
- [x] User authentication
- [x] Dashboard analytics
- [ ] Advanced reporting
- [ ] Mobile app (React Native)
- [ ] Integrations (Slack, Teams, Jira)
- [ ] AI-powered ticket routing
- [ ] Knowledge base module
- [ ] Self-service portal
- [ ] Multi-language support
- [ ] Custom workflows

## 🤝 Contributing

Contributions welcome! Please follow these guidelines:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/NewFeature`)
3. Commit changes (`git commit -m 'Add NewFeature'`)
4. Push to branch (`git push origin feature/NewFeature`)
5. Open Pull Request

### Code Style

- **TypeScript** - Strict mode enabled
- **ESLint** - Airbnb config
- **Prettier** - Code formatting
- **Conventional Commits** - Commit message format

## 📝 License

This project is proprietary software for internal use only.

**© 2026 DeskSOS Team. All rights reserved.**

## 👥 Authors

- **DeskSOS Team** - Initial development

## 🐛 Bug Reports & Feature Requests

Found a bug or have a feature request?

- **GitHub Issues:** [Open an issue](https://github.com/hneal055/DeskSOS-Enterprise---IT-Operations-Platform/issues)
- **Email:** support@desksos.com

Please include:
- Clear description
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots/logs if applicable
- Environment details (browser, OS, Docker version)

## 💬 Support

- **Documentation:** [Wiki](https://github.com/hneal055/DeskSOS-Enterprise---IT-Operations-Platform/wiki)
- **Email:** support@desksos.com
- **Chat:** Internal Slack channel

## 🙏 Acknowledgments

- Built with [Express](https://expressjs.com/)
- Real-time powered by [Socket.io](https://socket.io/)
- UI built with [React](https://react.dev/)
- Containerized with [Docker](https://www.docker.com/)

---

**Made with ❤️ for IT Operations Teams**
