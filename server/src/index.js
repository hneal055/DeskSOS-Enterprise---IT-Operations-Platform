const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// In-memory mock fallback in case Postgres is offline/unreachable
let mockIncidents = [
    {
        id: 1,
        title: "Database Lock Latency Peak",
        description: "Postgres transaction locks in active production cluster peaking above 3.4 seconds during batch script execution.",
        category: "Database",
        severity: "CRITICAL",
        status: "Open",
        location: { latitude: 34.0522, longitude: -118.2437 }, // LA
        assignedTo: "Jane Doe (DBA)",
        created_at: new Date(Date.now() - 3600000 * 2).toISOString()
    },
    {
        id: 2,
        title: "API Gateway Token Validation Failure",
        description: "GraphQL middleware token parsing returning invalid HS256 validation signatures periodically.",
        category: "Security",
        severity: "HIGH",
        status: "In Progress",
        location: { latitude: 37.7749, longitude: -122.4194 }, // SF
        assignedTo: "John Smith (SecOps)",
        created_at: new Date(Date.now() - 3600000 * 5).toISOString()
    },
    {
        id: 3,
        title: "Redis Queue Worker Timeout",
        description: "Background scheduler process disconnected due to redis cluster failover heartbeat packets timeout.",
        category: "Infrastructure",
        severity: "MEDIUM",
        status: "Resolved",
        location: { latitude: 40.7128, longitude: -74.0060 }, // NYC
        assignedTo: "Bob Johnson (DevOps)",
        created_at: new Date(Date.now() - 3600000 * 12).toISOString()
    }
];

// Setup Postgres Pool connection
const dbConfig = {
    host: process.env.DB_HOST || 'db',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'desksos_db',
    user: process.env.DB_USER || 'desksos_user',
    password: process.env.DB_PASSWORD || 'secure-db-password',
};

const pool = new Pool(dbConfig);
let pgConnected = false;

// Attempt database connection check
pool.query('SELECT NOW()')
    .then(() => {
        pgConnected = true;
        console.log('✓ Successfully connected to PostgreSQL Database');
    })
    .catch(err => {
        console.warn('⚠ PostgreSQL connection failed. API will fallback to memory-store list.', err.message);
    });

// Setup Redis Client connection
const redisUrl = `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`;
let redisConnected = false;
let redis;

try {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    redis.on('connect', () => {
        redisConnected = true;
        console.log('✓ Successfully connected to Redis Cache Broker');
    });
    redis.on('error', (err) => {
        redisConnected = false;
        console.warn('⚠ Redis connection error:', err.message);
    });
} catch (e) {
    console.warn('⚠ Redis initialization failed:', e.message);
}

// ---------- API Routes ----------

// 1. GET /health
app.get('/health', async (req, res) => {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    try {
        await pool.query('SELECT 1');
        dbStatus = 'connected';
        pgConnected = true;
    } catch (e) {
        dbStatus = `offline (${e.message})`;
        pgConnected = false;
    }

    try {
        if (redis && redis.status === 'ready') {
            redisStatus = 'connected';
            redisConnected = true;
        } else {
            redisStatus = 'offline';
            redisConnected = false;
        }
    } catch (e) {
        redisStatus = `offline (${e.message})`;
        redisConnected = false;
    }

    const overall = (dbStatus === 'connected' && redisStatus === 'connected') ? 'ok' : 'degraded';

    res.json({
        status: overall,
        services: {
            database: dbStatus,
            cache: redisStatus
        },
        timestamp: new Date().toISOString()
    });
});

// 2. GET /api/incidents
app.get('/api/incidents', async (req, res) => {
    if (pgConnected) {
        try {
            const { rows } = await pool.query('SELECT * FROM incidents ORDER BY created_at DESC');
            return res.json(rows.length > 0 ? rows : mockIncidents);
        } catch (e) {
            console.error('Postgres fetch error - falling back to memory store:', e.message);
        }
    }
    res.json(mockIncidents);
});

// 3. POST /api/incidents
app.post('/api/incidents', async (req, res) => {
    const { title, description, category, severity, status, location, assignedTo } = req.body;

    if (!title || !description || !category || !severity) {
        return res.status(400).json({ error: 'Missing required incident fields: title, description, category, severity' });
    }

    const newIncident = {
        id: mockIncidents.length + 1,
        title,
        description,
        category,
        severity,
        status: status || 'Open',
        location: location || { latitude: 34.0522, longitude: -118.2437 },
        assignedTo: assignedTo || 'Unassigned',
        created_at: new Date().toISOString()
    };

    if (pgConnected) {
        try {
            const queryText = `
                INSERT INTO incidents (title, description, category, severity, status, location, assigned_to, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `;
            const values = [
                title, 
                description, 
                category, 
                severity, 
                newIncident.status, 
                JSON.stringify(newIncident.location), 
                newIncident.assignedTo, 
                newIncident.created_at
            ];
            const { rows } = await pool.query(queryText, values);
            
            // Queue notification event via Redis
            if (redisConnected && redis) {
                await redis.publish('incident_events', JSON.stringify({ event: 'created', data: rows[0] }));
            }

            return res.status(201).json(rows[0]);
        } catch (e) {
            console.error('Postgres insert failed - fallback to memory storage:', e.message);
        }
    }

    // Fallback storage
    mockIncidents.unshift(newIncident);

    // Queue notification event via Redis even in memory fallback if Redis is online
    if (redisConnected && redis) {
        try {
            await redis.publish('incident_events', JSON.stringify({ event: 'created', data: newIncident }));
        } catch (e) {
            // Ignore channel publish logs
        }
    }

    res.status(201).json(newIncident);
});

// 4. PATCH /api/incidents/:id
app.patch('/api/incidents/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { status, assignedTo } = req.body;

    if (pgConnected) {
        try {
            const queryText = `
                UPDATE incidents
                SET status = COALESCE($1, status), assigned_to = COALESCE($2, assigned_to)
                WHERE id = $3
                RETURNING *
            `;
            const { rows } = await pool.query(queryText, [status, assignedTo, id]);
            if (rows.length > 0) {
                if (redisConnected && redis) {
                    await redis.publish('incident_events', JSON.stringify({ event: 'updated', data: rows[0] }));
                }
                return res.json(rows[0]);
            }
        } catch (e) {
            console.error('Postgres update failed - fallback to memory storage:', e.message);
        }
    }

    // In-memory update fallback
    const idx = mockIncidents.findIndex(inc => inc.id === id);
    if (idx !== -1) {
        if (status !== undefined) mockIncidents[idx].status = status;
        if (assignedTo !== undefined) mockIncidents[idx].assignedTo = assignedTo;
        
        if (redisConnected && redis) {
            try {
                await redis.publish('incident_events', JSON.stringify({ event: 'updated', data: mockIncidents[idx] }));
            } catch (e) {}
        }
        return res.json(mockIncidents[idx]);
    }

    res.status(404).json({ error: 'Incident not found' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`DeskSOS Enterprise Express server running`);
    console.log(`Port: ${PORT}`);
    console.log(`API documentation: http://localhost:${PORT}/docs`);
    console.log(`========================================`);
});
