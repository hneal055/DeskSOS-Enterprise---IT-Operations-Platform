import { Router, Request, Response } from 'express';
import { listIncidents, createIncident, getIncident, updateIncidentStatus, Severity } from '../db';
import { requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createIncidentBody, updateIncidentBody, incidentIdParams } from '../validation';
import { actorFromUser, inTransaction, listEvents, recordEvent } from '../audit';

const router = Router();

// The router is mounted behind requireAuth, so every route has req.user.
// Viewers can read; changing incidents needs the operator or admin role.
const canEdit = requireRole('admin', 'operator');

// Locks are coordination state for operators currently on shift, so they
// stay in memory; incidents themselves are persisted in SQLite.
const activeLocks: Record<number, string> = {}; // incidentId -> operatorName

// GET /api/incidents
router.get('/', (req: Request, res: Response) => {
  try {
    res.json(listIncidents().map(inc => (activeLocks[inc.id] ? { ...inc, lockedBy: activeLocks[inc.id] } : inc)));
  } catch (err) {
    res.status(500).json({ error: 'Internal gateway error retrieving incident stream' });
  }
});

// POST /api/incidents (Enterprise UI). Body is validated and trimmed by zod.
router.post('/', canEdit, validate({ body: createIncidentBody }), (req: Request, res: Response) => {
  try {
    const { title, description, category, severity, location, assignedTo, status } = req.body;
    const newIncident = inTransaction(() => {
      const created = createIncident({
        title,
        description,
        category: category || 'Infrastructure',
        severity: (severity as Severity) || 'MEDIUM',
        status: status || 'Open',
        latitude: location?.latitude,
        longitude: location?.longitude,
        assignedTo: assignedTo || 'Unassigned',
        source: 'enterprise-ui',
      });
      recordEvent(created.id, 'created', actorFromUser(req.user!), {
        severity: created.severity, status: created.status,
      });
      return created;
    });

    req.app.get('io')?.emit('incident:created', newIncident);
    res.status(201).json(newIncident);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process incident transmission' });
  }
});

// PATCH /api/incidents/:id
router.patch('/:id', canEdit, validate({ params: incidentIdParams, body: updateIncidentBody }), (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    const before = getIncident(id);
    if (!before) {
      return res.status(404).json({ error: 'Incident target not found in stream' });
    }

    const incident = inTransaction(() => {
      const updated = updateIncidentStatus(id, status);
      // Only record real changes, not a status set to what it already was
      if (before.status !== status) {
        recordEvent(id, 'status_changed', actorFromUser(req.user!), { from: before.status, to: status });
      }
      return updated;
    });

    // Release the lock on resolution, only once the change has committed
    // (a failed update must leave the incident locked as it was)
    if (status === 'Resolved') {
      delete activeLocks[id];
    }

    req.app.get('io')?.emit('incident:updated', incident);
    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update incident state' });
  }
});

// GET /api/incidents/:id/history (any signed-in role)
router.get('/:id/history', validate({ params: incidentIdParams }), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!getIncident(id)) {
    return res.status(404).json({ error: 'Incident target not found in stream' });
  }
  res.json(listEvents(id));
});

// POST /api/incidents/:id/lock
router.post('/:id/lock', canEdit, validate({ params: incidentIdParams }), (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!getIncident(id)) {
      return res.status(404).json({ error: 'Incident target not found in stream' });
    }
    // The lock holder is the signed-in user, not a name sent by the client,
    // so nobody can lock incidents in someone else's name
    const operatorName = req.user!.name;

    if (activeLocks[id] && activeLocks[id] !== operatorName) {
      return res.status(409).json({ error: `Incident is currently locked by ${activeLocks[id]}` });
    }

    // Record a lock when the holder changes, not every time the same person
    // re-selects an incident they already hold
    if (activeLocks[id] !== operatorName) {
      recordEvent(id, 'locked', actorFromUser(req.user!));
    }
    activeLocks[id] = operatorName;

    req.app.get('io')?.emit('incident:locked', { incidentId: id, lockedBy: activeLocks[id] });

    res.json({ success: true, lockedBy: activeLocks[id] });
  } catch (error) {
    res.status(500).json({ error: 'Concurrency lock acquisition failed' });
  }
});

export default router;
