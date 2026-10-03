import { Router, Request, Response } from 'express';

const router = Router();

// In-memory sample storage for operational incidents
let incidents = [
  {
    id: 1,
    title: 'Docker Daemon crash on production node',
    description: 'Primary container engine terminated unexpectedly due to OOM killer invocation.',
    category: 'Infrastructure',
    severity: 'CRITICAL',
    status: 'Open',
    location: { latitude: 34.0522, longitude: -118.2437 },
    assignedTo: 'Node-Ops-Lead',
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 2,
    title: 'PostgreSQL Connection Pool Saturation',
    description: 'Active database connections exceeded max pool limit under heavy analytics query load.',
    category: 'Database',
    severity: 'HIGH',
    status: 'In Progress',
    location: { latitude: 34.0550, longitude: -118.2450 },
    assignedTo: 'DBA-Alpha',
    created_at: new Date(Date.now() - 7200000).toISOString()
  }
];

let activeLocks: Record<number, string> = {}; // incidentId -> operatorName

// GET /api/incidents
router.get('/', (req: Request, res: Response) => {
  try {
    res.json(incidents);
  } catch (err) {
    res.status(500).json({ error: 'Internal gateway error retrieving incident stream' });
  }
});

// POST /api/incidents
router.post('/', (req: Request, res: Response) => {
  try {
    const { title, description, category, severity, location, assignedTo, status } = req.body;
    
    if (!title || typeof title !== 'string' || !description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Valid title and description strings are required' });
    }

    const newIncident = {
      id: Date.now(),
      title: title.trim(),
      description: description.trim(),
      category: category || 'Infrastructure',
      severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severity) ? severity : 'MEDIUM',
      status: status || 'Open',
      location: {
        latitude: location?.latitude ? Number(location.latitude) : 34.0522,
        longitude: location?.longitude ? Number(location.longitude) : -118.2437
      },
      assignedTo: assignedTo || 'Unassigned',
      created_at: new Date().toISOString()
    };

    incidents.unshift(newIncident);

    // Keep memory footprint bounded (max 500 active records)
    if (incidents.length > 500) {
      incidents = incidents.slice(0, 500);
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('incident:created', newIncident);
    }

    res.status(201).json(newIncident);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process incident transmission' });
  }
});

// PATCH /api/incidents/:id
router.patch('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const incident = incidents.find(inc => inc.id === id);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident target not found in stream' });
    }

    if (status) {
      incident.status = status;
      if (status === 'Resolved') {
        // Release lock automatically upon resolution
        delete activeLocks[id];
      }
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('incident:updated', incident);
    }

    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update incident state' });
  }
});

// POST /api/incidents/:id/lock
router.post('/:id/lock', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { operatorName } = req.body;

    if (activeLocks[id] && activeLocks[id] !== operatorName) {
      return res.status(409).json({ error: `Incident is currently locked by ${activeLocks[id]}` });
    }

    activeLocks[id] = operatorName || 'Anonymous-Operator';

    const io = req.app.get('io');
    if (io) {
      io.emit('incident:locked', { incidentId: id, lockedBy: activeLocks[id] });
    }

    res.json({ success: true, lockedBy: activeLocks[id] });
  } catch (error) {
    res.status(500).json({ error: 'Concurrency lock acquisition failed' });
  }
});

export default router;