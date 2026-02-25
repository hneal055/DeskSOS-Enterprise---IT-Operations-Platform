# DeskSOS Enterprise API - Complete Reference Guide

## Quick Start

### Authentication
All API requests require a Bearer token in the Authorization header:

```bash
Authorization: Bearer YOUR_API_TOKEN
```

### Base URLs
- **Production:** `https://api.desksos.local/v1`
- **Development:** `http://localhost:3000/v1`

---

## Health & Diagnostics Endpoints

### GET /health
**Status Check - Get system health status**

```bash
curl -X GET https://api.desksos.local/v1/health \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "status": "healthy",
  "uptime": "5d 3h 24m",
  "services": {"docker": "running", "nginx": "running"},
  "memory": {"total": 16, "used": 8.5, "percentUsed": 53},
  "disk": {"total": 512, "used": 256, "percentFree": 50}
}
```

---

### GET /diagnostics
**Full System Diagnostics**

```bash
curl -X GET "https://api.desksos.local/v1/diagnostics?detailed=true&include=memory,disk,network" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Parameters:**
- `detailed` (boolean): Include detailed breakdown
- `include` (string): Comma-separated: `cpu,memory,disk,network,processes`

**Response:**
```json
{
  "cpu": {"cores": 8, "usage": 35.2, "temperature": 45},
  "memory": {"total": 16384, "used": 8192, "percentUsed": 50},
  "disk": [{"drive": "C:", "total": 512, "free": 256, "percentFree": 50}],
  "network": {"adapters": 2, "activeConnections": 15},
  "topProcesses": [{"pid": 1234, "name": "docker", "memory": 512, "cpu": 10.5}]
}
```

---

### GET /services
**List all services and their status**

```bash
curl -X GET https://api.desksos.local/v1/services \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**
- `status` (string): Filter by `running`, `stopped`, `error`

**Response:**
```json
{
  "services": [
    {
      "name": "docker",
      "status": "running",
      "uptime": "5d 3h",
      "restarts": 2,
      "lastRestart": "2026-02-24T08:30:00Z"
    }
  ]
}
```

---

### POST /services/{serviceName}/restart
**Restart a specific service (Admin only)**

```bash
curl -X POST https://api.desksos.local/v1/services/nginx/restart \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Service restarted successfully"
}
```

---

## User Management Endpoints

### GET /users
**Retrieve list of users**

```bash
curl -X GET "https://api.desksos.local/v1/users?page=1&limit=20&role=admin" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**
- `page` (integer): Page number (default: 1)
- `limit` (integer): Results per page (default: 20, max: 100)
- `role` (string): Filter by `admin`, `user`, `viewer`
- `search` (string): Search by email or name

**Response:**
```json
{
  "users": [
    {
      "id": "user_001",
      "email": "admin@desksos.local",
      "name": "Administrator",
      "role": "admin",
      "status": "active",
      "createdAt": "2026-01-15T10:00:00Z",
      "lastLogin": "2026-02-25T09:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

---

### POST /users
**Create a new user**

```bash
curl -X POST https://api.desksos.local/v1/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@desksos.local",
    "name": "New User",
    "password": "SecurePassword123!",
    "role": "user"
  }'
```

**Request Body:**
```json
{
  "email": "string (required)",
  "name": "string (required)",
  "password": "string (required, min 8 chars)",
  "role": "admin|user|viewer (default: user)"
}
```

**Response (201):**
```json
{
  "id": "user_002",
  "email": "newuser@desksos.local",
  "name": "New User",
  "role": "user",
  "status": "active",
  "createdAt": "2026-02-25T09:43:13Z"
}
```

---

### GET /users/{userId}
**Get specific user details**

```bash
curl -X GET https://api.desksos.local/v1/users/user_001 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "id": "user_001",
  "email": "admin@desksos.local",
  "name": "Administrator",
  "role": "admin",
  "status": "active"
}
```

---

### PUT /users/{userId}
**Update user information**

```bash
curl -X PUT https://api.desksos.local/v1/users/user_001 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name",
    "role": "admin"
  }'
```

**Response:**
```json
{
  "id": "user_001",
  "name": "Updated Name",
  "role": "admin",
  "email": "admin@desksos.local"
}
```

---

### DELETE /users/{userId}
**Delete a user account (Admin only)**

```bash
curl -X DELETE https://api.desksos.local/v1/users/user_002 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

## Configuration Endpoints

### GET /config
**Retrieve system configuration**

```bash
curl -X GET https://api.desksos.local/v1/config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "appName": "DeskSOS Enterprise",
  "version": "1.0.0",
  "environment": "production",
  "features": {
    "monitoring": true,
    "alerts": true,
    "reporting": true
  },
  "limits": {
    "maxUsers": 1000,
    "maxSessions": 5000,
    "apiRateLimit": 1000
  }
}
```

---

### PUT /config
**Update system configuration (Admin only)**

```bash
curl -X PUT https://api.desksos.local/v1/config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "features": {"monitoring": true, "alerts": false},
    "limits": {"apiRateLimit": 2000}
  }'
```

**Response:**
```json
{
  "success": true,
  "updated": true,
  "timestamp": "2026-02-25T09:43:13Z"
}
```

---

## Deployment Endpoints

### GET /deployments
**List deployment history**

```bash
curl -X GET "https://api.desksos.local/v1/deployments?page=1&status=success" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**
- `page` (integer): Page number
- `limit` (integer): Results per page
- `status` (string): `pending`, `in_progress`, `success`, `failed`, `cancelled`

**Response:**
```json
{
  "deployments": [
    {
      "id": "deploy_001",
      "version": "1.0.0",
      "status": "success",
      "timestamp": "2026-02-25T08:30:00Z",
      "duration": 120,
      "deployedBy": "admin@desksos.local",
      "services": ["api", "web"]
    }
  ]
}
```

---

### POST /deployments
**Initiate a new deployment**

```bash
curl -X POST https://api.desksos.local/v1/deployments \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.1",
    "environment": "production",
    "services": ["api", "web", "worker"]
  }'
```

**Request Body:**
```json
{
  "version": "string (required)",
  "environment": "development|staging|production (required)",
  "services": ["array of service names"]
}
```

**Response (202):**
```json
{
  "deploymentId": "deploy_002",
  "status": "in_progress",
  "startedAt": "2026-02-25T09:43:13Z"
}
```

---

## Logs Endpoints

### GET /logs
**Retrieve system and application logs**

```bash
curl -X GET "https://api.desksos.local/v1/logs?service=api&level=error&limit=50" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**
- `service` (string): Filter by service name
- `level` (string): `debug`, `info`, `warn`, `error`
- `limit` (integer): Number of logs (default: 100, max: 1000)
- `from` (string): Start timestamp (ISO 8601)
- `to` (string): End timestamp (ISO 8601)

**Response:**
```json
{
  "logs": [
    {
      "timestamp": "2026-02-25T09:43:13Z",
      "service": "api",
      "level": "error",
      "message": "Database connection failed",
      "details": {"code": "ECONNREFUSED", "port": 5432}
    }
  ],
  "pagination": {"page": 1, "limit": 50, "total": 156}
}
```

---

## Error Responses

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": "Additional context"
  },
  "timestamp": "2026-02-25T09:43:13Z"
}
```

### Common Error Codes

| Code | HTTP | Description | Solution |
|------|------|-------------|----------|
| INVALID_REQUEST | 400 | Missing/invalid parameters | Check request format |
| UNAUTHORIZED | 401 | Missing/invalid token | Provide valid Bearer token |
| FORBIDDEN | 403 | Insufficient permissions | Check user role |
| NOT_FOUND | 404 | Resource not found | Verify resource ID |
| CONFLICT | 409 | Resource exists | Use different identifier |
| RATE_LIMITED | 429 | Too many requests | Wait before retrying |
| SERVER_ERROR | 500 | Internal error | Contact support |

---

## Rate Limiting

**Standard Users:** 1,000 requests/hour  
**Admin Users:** 5,000 requests/hour  
**Service Accounts:** 10,000 requests/hour

**Rate Limit Headers:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

**When rate limited (429):**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded",
    "retryAfter": 3600
  }
}
```

---

## Examples by Language

### JavaScript/Node.js
```javascript
const fetch = require('node-fetch');

async function getHealth() {
  const response = await fetch('https://api.desksos.local/v1/health', {
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  });
  return response.json();
}

getHealth().then(console.log);
```

### Python
```python
import requests

headers = {'Authorization': 'Bearer YOUR_TOKEN'}
response = requests.get('https://api.desksos.local/v1/health', headers=headers)
print(response.json())
```

### cURL
```bash
curl -X GET https://api.desksos.local/v1/health \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### PowerShell
```powershell
$headers = @{'Authorization' = 'Bearer YOUR_TOKEN'}
$response = Invoke-RestMethod -Uri 'https://api.desksos.local/v1/health' -Headers $headers
$response | ConvertTo-Json
```

---

## Support & Resources

- **Issues:** https://github.com/hneal055/DESKSOS-Desktop-App-/issues
- **Email:** support@desksos.local
- **Documentation:** https://docs.desksos.local

---

**Last Updated:** 2026-02-25 | **API Version:** 1.0.0