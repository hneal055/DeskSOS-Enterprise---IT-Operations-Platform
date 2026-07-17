import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:32769';

function App() {
  const [incidents, setIncidents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [apiStatus, setApiStatus] = useState('Checking...');
  const [servicesStatus, setServicesStatus] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form Fields
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('Infrastructure');
  const [newSeverity, setNewSeverity] = useState('MEDIUM');
  const [newLat, setNewLat] = useState('34.0522');
  const [newLng, setNewLng] = useState('-118.2437');

  // Load Incidents and Health status
  const loadData = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/incidents`);
      if (response.ok) {
        const data = await response.json();
        setIncidents(data);
        if (data.length > 0 && selectedId === null) {
          setSelectedId(data[0].id);
        }
      }
    } catch (e) {
      console.warn('API unavailable, rendering fallback mock incidents.');
    }
  };

  const checkHealth = async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const data = await response.json();
        setApiStatus(data.status === 'ok' ? 'Online' : 'Degraded');
        setServicesStatus(data.services);
      } else {
        setApiStatus('Degraded');
      }
    } catch (e) {
      setApiStatus('Offline');
      setServicesStatus(null);
    }
  };

  useEffect(() => {
    // Initial fetch
    loadData();
    checkHealth();

    // Poll status checks every 5 seconds
    const interval = setInterval(() => {
      loadData();
      checkHealth();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Compute Metrics
  const activeIncidents = incidents.filter(inc => inc.status !== 'Resolved');
  const criticalCount = activeIncidents.filter(inc => inc.severity === 'CRITICAL').length;
  const highCount = activeIncidents.filter(inc => inc.severity === 'HIGH').length;
  const resolvedCount = incidents.filter(inc => inc.status === 'Resolved').length;

  const selectedIncident = incidents.find(inc => inc.id === selectedId) || incidents[0];

  // Submit new incident ticket
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) {
      alert('Please fill out all required fields.');
      return;
    }

    const payload = {
      title: newTitle,
      description: newDesc,
      category: newCategory,
      severity: newSeverity,
      location: {
        latitude: parseFloat(newLat) || 34.0522,
        longitude: parseFloat(newLng) || -118.2437
      },
      assignedTo: 'Unassigned',
      status: 'Open'
    };

    try {
      const response = await fetch(`${API_BASE}/api/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const added = await response.json();
        setIncidents([added, ...incidents]);
        setSelectedId(added.id);
        setIsCreating(false);
        // Reset form
        setNewTitle('');
        setNewDesc('');
        setNewSeverity('MEDIUM');
      } else {
        throw new Error('Server validation failed');
      }
    } catch (e) {
      // In-memory local fallback update
      const localAdded = {
        id: Date.now(),
        ...payload,
        created_at: new Date().toISOString()
      };
      setIncidents([localAdded, ...incidents]);
      setSelectedId(localAdded.id);
      setIsCreating(false);
      setNewTitle('');
      setNewDesc('');
      setNewSeverity('MEDIUM');
    }
  };

  // Modify active incident status
  const handleUpdateStatus = async (id, status) => {
    try {
      const response = await fetch(`${API_BASE}/api/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (response.ok) {
        const updated = await response.json();
        setIncidents(incidents.map(inc => inc.id === id ? updated : inc));
      }
    } catch (e) {
      // Local fallback
      setIncidents(incidents.map(inc => inc.id === id ? { ...inc, status } : inc));
    }
  };

  // Helper for formatting times
  const formatDate = (isoString) => {
    try {
      return new Date(isoString).toLocaleString();
    } catch (e) {
      return 'N/A';
    }
  };

  return (
    <div className="ops-container">
      
      {/* Ops Center Header */}
      <div className="ops-header">
        <div className="ops-title-group">
          <span className="ops-title-logo">📡</span>
          <div>
            <h1>DeskSOS Enterprise</h1>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Security & Infrastructure Operations Center</div>
          </div>
        </div>
        
        <div className="status-indicator">
          <span className={`status-dot ${apiStatus === 'Offline' ? 'offline' : apiStatus === 'Degraded' ? 'degraded' : ''}`}></span>
          <span>Gateway: {apiStatus}</span>
          {servicesStatus && (
            <span style={{ fontSize: '0.75rem', opacity: 0.8, marginLeft: '6px' }}>
              (DB: {servicesStatus.database === 'connected' ? '✓' : '✗'}, Cache: {servicesStatus.cache === 'connected' ? '✓' : '✗'})
            </span>
          )}
        </div>
      </div>

      {/* Metric Counters Grid */}
      <div className="metrics-grid">
        <div className="metric-card critical">
          <div className="metric-label">Critical Alerts</div>
          <div className="metric-value">{criticalCount}</div>
        </div>
        <div className="metric-card high">
          <div className="metric-label">High Severity</div>
          <div className="metric-value">{highCount}</div>
        </div>
        <div className="metric-card active-tickets">
          <div className="metric-label">Total Active</div>
          <div className="metric-value">{activeIncidents.length}</div>
        </div>
        <div className="metric-card resolved">
          <div className="metric-label">Resolved (Cycle)</div>
          <div className="metric-value">{resolvedCount}</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left Card: Incident List */}
        <div className="ops-card">
          <div className="ops-card-title">
            <span>🚨 Live Incident Stream</span>
            {!isCreating && (
              <button 
                onClick={() => setIsCreating(true)}
                style={{ 
                  background: 'linear-gradient(135deg, #f43f5e, #a855f7)', 
                  border: 'none', 
                  color: 'white', 
                  padding: '4px 12px', 
                  borderRadius: '6px', 
                  fontSize: '0.8rem', 
                  fontWeight: '700', 
                  cursor: 'pointer' 
                }}
              >
                + LOG TICKET
              </button>
            )}
          </div>

          {isCreating ? (
            /* Log New Ticket Form */
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexVisual: 'column', flexDirection: 'column', gap: '8px' }}>
              <div className="form-input-group">
                <label className="form-label">Incident title</label>
                <input 
                  type="text" 
                  value={newTitle} 
                  onChange={(e) => setNewTitle(e.target.value)} 
                  placeholder="e.g. Docker Daemon crash on production node" 
                  required
                />
              </div>

              <div className="form-input-group">
                <label className="form-label">Detailed description</label>
                <textarea 
                  rows="3" 
                  value={newDesc} 
                  onChange={(e) => setNewDesc(e.target.value)} 
                  placeholder="Enter details of system failure or log anomalies..." 
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-input-group">
                  <label className="form-label">Category</label>
                  <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                    <option value="Infrastructure">Infrastructure</option>
                    <option value="Database">Database</option>
                    <option value="Security">Security</option>
                    <option value="Application">Application</option>
                  </select>
                </div>
                <div className="form-input-group">
                  <label className="form-label">Severity Level</label>
                  <select value={newSeverity} onChange={(e) => setNewSeverity(e.target.value)}>
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-input-group">
                  <label className="form-label">Latitude Coordinate</label>
                  <input type="text" value={newLat} onChange={(e) => setNewLat(e.target.value)} />
                </div>
                <div className="form-input-group">
                  <label className="form-label">Longitude Coordinate</label>
                  <input type="text" value={newLng} onChange={(e) => setNewLng(e.target.value)} />
                </div>
              </div>

              <div className="btn-group">
                <button type="submit" className="btn-primary">SUBMIT TICKET</button>
                <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)}>CANCEL</button>
              </div>
            </form>
          ) : (
            /* Incident List view */
            <div className="incident-list-wrapper">
              {incidents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '20px 0', textAlign: 'center' }}>
                  No active incidents queued.
                </div>
              ) : (
                incidents.map(inc => (
                  <div 
                    key={inc.id} 
                    className={`incident-row ${selectedIncident?.id === inc.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(inc.id)}
                  >
                    <div className="incident-row-header">
                      <span className="incident-row-title">{inc.title}</span>
                      <span className={`badge-tag ${inc.severity.toLowerCase()} ${inc.status === 'Resolved' ? 'resolved' : ''}`}>
                        {inc.status === 'Resolved' ? 'Resolved' : inc.severity}
                      </span>
                    </div>
                    <div className="incident-row-meta">
                      <span>Cat: {inc.category}</span>
                      <span>{formatDate(inc.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right Card: Incident Inspector Details */}
        <div className="ops-card">
          <div className="ops-card-title">🔍 Incident Inspection Console</div>
          
          {selectedIncident ? (
            <div className="detail-view">
              <div className="detail-header">
                <div className="detail-title">{selectedIncident.title}</div>
                <span className={`badge-tag ${selectedIncident.severity.toLowerCase()} ${selectedIncident.status === 'Resolved' ? 'resolved' : ''}`}>
                  {selectedIncident.status}
                </span>
              </div>

              <div className="detail-meta-grid">
                <div className="detail-meta-item">
                  <span className="detail-meta-label">Category</span>
                  <span className="detail-meta-val">{selectedIncident.category}</span>
                </div>
                <div className="detail-meta-item">
                  <span className="detail-meta-label">Assigned Operator</span>
                  <span className="detail-meta-val">{selectedIncident.assignedTo}</span>
                </div>
                <div className="detail-meta-item">
                  <span className="detail-meta-label">Timestamp</span>
                  <span className="detail-meta-val" style={{ fontSize: '0.8rem' }}>{formatDate(selectedIncident.created_at)}</span>
                </div>
              </div>

              <div className="detail-description">
                <div style={{ fontWeight: '700', color: 'white', marginBottom: '4px' }}>Incident Summary:</div>
                {selectedIncident.description}
              </div>

              {/* Mock Radar Target Location Map */}
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  🎯 Targeting Location Geo-Matrix
                </div>
                <div className="mock-map">
                  <div className="map-radar-ring"></div>
                  <div className="map-pulse-point"></div>
                  <div className="map-info-overlay">
                    LAT: {selectedIncident.location?.latitude.toFixed(4) || 'N/A'} | 
                    LNG: {selectedIncident.location?.longitude.toFixed(4) || 'N/A'}
                  </div>
                </div>
              </div>

              {/* Status Update Actions */}
              <div style={{ marginTop: '10px' }}>
                <label className="form-label">Transition State</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="btn-secondary" 
                    style={{ flex: 1, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.2)' }}
                    onClick={() => handleUpdateStatus(selectedIncident.id, 'In Progress')}
                    disabled={selectedIncident.status === 'Resolved'}
                  >
                    ⚙️ IN PROGRESS
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ flex: 1, color: '#10b981', borderColor: 'rgba(16,185,129,0.2)' }}
                    onClick={() => handleUpdateStatus(selectedIncident.id, 'Resolved')}
                    disabled={selectedIncident.status === 'Resolved'}
                  >
                    ✓ RESOLVE TICKET
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>
              Select an incident from the stream to view full diagnostics.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default App;
