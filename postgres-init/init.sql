-- Initialize DeskSOS Database tables
CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Open',
    location JSONB,
    assigned_to VARCHAR(100) DEFAULT 'Unassigned',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial test records
INSERT INTO incidents (title, description, category, severity, status, location, assigned_to)
VALUES 
('Database Lock Latency Peak', 'Postgres transaction locks in active production cluster peaking above 3.4 seconds during batch script execution.', 'Database', 'CRITICAL', 'Open', '{"latitude": 34.0522, "longitude": -118.2437}', 'Jane Doe (DBA)'),
('API Gateway Token Validation Failure', 'GraphQL middleware token parsing returning invalid HS256 validation signatures periodically.', 'Security', 'HIGH', 'In Progress', '{"latitude": 37.7749, "longitude": -122.4194}', 'John Smith (SecOps)'),
('Redis Queue Worker Timeout', 'Background scheduler process disconnected due to redis cluster failover heartbeat packets timeout.', 'Infrastructure', 'MEDIUM', 'Resolved', '{"latitude": 40.7128, "longitude": -74.0060}', 'Bob Johnson (DevOps)')
ON CONFLICT DO NOTHING;
