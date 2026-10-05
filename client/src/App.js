import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { apiFetch, getToken } from './auth';
import UsersAdmin from './UsersAdmin';

const API_BASE = ''; // Leverages the package.json proxy to bypass CORS

export default function App({ user, onSignOut, onSessionEnded, onChangePassword }) {
  // Viewers get a read-only console; the server enforces the same rule
  const canEdit = user.role === 'admin' || user.role === 'operator';
  const isAdmin = user.role === 'admin';
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'users' (admins)

  // Incident & System States
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [gatewayStatus, setGatewayStatus] = useState('Online');
  const [isStrobing, setIsStrobing] = useState(false); // Tactical Visual Strobe State
  const [audioArmed, setAudioArmed] = useState(false); // Browser Audio Activation State
  
  // Ref to prevent stale closures in WebSocket event listeners
  const audioArmedRef = useRef(audioArmed);
  useEffect(() => {
    audioArmedRef.current = audioArmed;
  }, [audioArmed]);

  // Form Fields State
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketCategory, setTicketCategory] = useState('Infrastructure');
  const [ticketSeverity, setTicketSeverity] = useState('MEDIUM');
  const [ticketLatitude, setTicketLatitude] = useState('34.0522');
  const [ticketLongitude, setTicketLongitude] = useState('-118.2437');
  const [ticketAssignedTo, setTicketAssignedTo] = useState('Node-Ops-Lead');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState([]);

  // Load the selected incident's history; reload when its status or lock
  // changes (those arrive over the socket and update selectedIncident)
  const selectedId = selectedIncident && (selectedIncident.id || selectedIncident._id);
  const selectedVersion = selectedIncident && `${selectedIncident.updated_at}|${selectedIncident.lockedBy || ''}`;
  useEffect(() => {
    if (!selectedId) { setHistory([]); return; }
    let cancelled = false;
    // Short delay so a lock taken on selection is included
    const t = setTimeout(async () => {
      const res = await apiFetch(`${API_BASE}/api/incidents/${selectedId}/history`);
      if (!cancelled && res.ok) setHistory(await res.json());
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [selectedId, selectedVersion]);

  // Load Incidents & Health Status (Polling Fallback)
  useEffect(() => {
    loadIncidents();
    const interval = setInterval(loadIncidents, 15000);
    return () => clearInterval(interval);
  }, []);

  // Arm Audio & Speech on User Gesture
  const handleArmAudio = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
      
      // Test beep to confirm arming
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance('Tactical audio armed'));
      }

      setAudioArmed(true);
    } catch (err) {
      console.error('Failed to arm audio:', err);
    }
  };

  // Combined Tactical Audio & Visual Strobe Handler for CRITICAL severity events
  const handleCriticalAlert = async (incident) => {
    if (incident.severity === 'CRITICAL') {
      setIsStrobing(true); // Activate Visual Emergency Strobe

      if (audioArmedRef.current) {
        try {
          // 1. Synthetic Oscillator Beep
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = 880; // High-priority alert pitch
          gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.4);
        } catch (err) {
          console.error('Audio context blocked or unsupported:', err);
        }

        // 2. Text-to-Speech Voice Dispatch Callout
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(`Critical alert received: ${incident.title}`);
          utterance.rate = 1.1;
          window.speechSynthesis.speak(utterance);
        }
      }
    }
  };

  // Real-time WebSocket Synchronization
  useEffect(() => {
    // Same-origin connection. auth is a function so every (re)connect sends the
    // current token: after a password change the server closes this socket
    // and it reconnects with the new token.
    const socket = io({ auth: (cb) => cb({ token: getToken() }) });

    socket.on('connect_error', async (err) => {
      if (err.message !== 'Authentication required') return;
      // Check whether the session is really over (apiFetch signs out on 401)
      // or the socket just raced ahead of a token refresh; then retry.
      const res = await apiFetch(`${API_BASE}/api/auth/me`);
      if (res.ok) setTimeout(() => socket.connect(), 1000);
    });

    // The server closed the connection (revoked session or password change):
    // try again; a revoked session ends via the check above
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') socket.connect();
    });

    socket.on('incident:locked', ({ incidentId, lockedBy }) => {
      setIncidents(prev => 
        prev.map(inc => (inc.id === incidentId || inc._id === incidentId) ? { ...inc, lockedBy } : inc)
      );
      setSelectedIncident(curr => 
        (curr && (curr.id === incidentId || curr._id === incidentId)) ? { ...curr, lockedBy } : curr
      );
    });

    socket.on('incident:created', (newIncident) => {
      setIncidents(prev => [newIncident, ...prev.filter(i => (i.id || i._id) !== (newIncident.id || newIncident._id))]);
      handleCriticalAlert(newIncident); // Triggers audio-visual tactical response on CRITICAL alerts
    });

    socket.on('incident:updated', (updatedIncident) => {
      setIncidents(prev => 
        prev.map(inc => (inc.id === updatedIncident.id || inc._id === updatedIncident._id) ? updatedIncident : inc)
      );
      setSelectedIncident(curr => 
        (curr && (curr.id === updatedIncident.id || curr._id === updatedIncident._id)) ? updatedIncident : curr
      );
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadIncidents = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/incidents`);
      if (res.ok) {
        const data = await res.json();
        setIncidents(data);
        setGatewayStatus('Online');
      } else {
        setGatewayStatus('Offline');
      }
    } catch (err) {
      console.error('Failed to load incidents:', err);
      setGatewayStatus('Offline');
    }
  };

  // Handle selecting an incident and acquiring concurrency lock
  const handleSelectIncident = async (incident) => {
    setSelectedIncident(incident);
    if (!canEdit) return; // viewers inspect without locking
    const incidentId = incident.id || incident._id;

    try {
      // The server records the lock in the signed-in user's name
      await apiFetch(`${API_BASE}/api/incidents/${incidentId}/lock`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to acquire incident lock:', err);
    }
  };

  // Handle Form Submission to POST /api/incidents
  const handleTicketSubmit = async (e) => {
    e.preventDefault();

    if (!ticketTitle || !ticketDescription) {
      alert('Please enter a title and description for the incident.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await apiFetch(`${API_BASE}/api/incidents`, {
        method: 'POST',
        body: JSON.stringify({
          title: ticketTitle,
          description: ticketDescription,
          category: ticketCategory,
          severity: ticketSeverity,
          location: {
            latitude: parseFloat(ticketLatitude),
            longitude: parseFloat(ticketLongitude)
          },
          assignedTo: ticketAssignedTo,
          status: 'Open'
        }),
      });

      if (response.ok) {
        setTicketTitle('');
        setTicketDescription('');
      } else {
        console.error('Failed to log incident');
      }
    } catch (error) {
      console.error('Error submitting incident ticket:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle updating an incident's status (e.g. "In Progress", "Resolved")
  const handleUpdateStatus = async (incidentId, newStatus) => {
    try {
      const response = await apiFetch(`${API_BASE}/api/incidents/${incidentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        const updatedIncident = await response.json();
        console.log('Incident status updated:', updatedIncident);
      } else {
        console.error('Failed to update incident status');
      }
    } catch (error) {
      console.error('Error updating incident status:', error);
    }
  };

  // Metric Calculations
  const criticalCount = incidents.filter(i => i.severity === 'CRITICAL').length;
  const highCount = incidents.filter(i => i.severity === 'HIGH').length;
  const totalActive = incidents.filter(i => i.status !== 'Resolved').length;
  const resolvedCount = incidents.filter(i => i.status === 'Resolved').length;

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans transition-colors duration-300 ${isStrobing ? 'border-4 border-rose-500' : ''}`}>
      
      {/* Visual Emergency Strobe Banner */}
      {isStrobing && (
        <div className="bg-rose-950/90 border-b border-rose-500 px-6 py-2.5 flex justify-between items-center animate-pulse z-50">
          <div className="flex items-center space-x-3">
            <span className="h-3 w-3 rounded-full bg-rose-500 animate-ping"></span>
            <span className="text-xs font-extrabold text-rose-200 tracking-wider">TACTICAL STROBE ACTIVE: UNACKNOWLEDGED CRITICAL THREAT DETECTED</span>
          </div>
          <button 
            onClick={() => setIsStrobing(false)}
            className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-3 py-1 rounded shadow transition"
          >
            Acknowledge & Silence Strobe
          </button>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-wide bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
            DeskSOS Enterprise
          </h1>
          <p className="text-xs text-slate-400">Security & Workforce Operations Center</p>
        </div>
        <div className="flex items-center space-x-4">
          {/* Audio Arming Button */}
          <button
            onClick={handleArmAudio}
            className={`px-3 py-1.5 rounded text-xs font-semibold border transition flex items-center space-x-2 ${
              audioArmed 
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse' 
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
            }`}
          >
            <span>{audioArmed ? '🔊 Tactical Audio: Armed' : '🔇 Click to Arm Audio'}</span>
          </button>

          <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded border border-slate-800 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${gatewayStatus === 'Online' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
            <span className="text-slate-300">Gateway: {gatewayStatus}</span>
          </div>

          {isAdmin && (
            <button
              onClick={() => setView(view === 'users' ? 'dashboard' : 'users')}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded transition"
            >
              {view === 'users' ? 'Back to dashboard' : 'Users'}
            </button>
          )}

          <div className="flex items-center space-x-3 text-xs">
            <span className="text-slate-300" data-testid="signed-in-user">
              {user.name} <span className="text-slate-500 capitalize">({user.role})</span>
            </span>
            <button
              onClick={onChangePassword}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-3 py-1.5 rounded transition"
            >
              Change password
            </button>
            <button
              onClick={onSignOut}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-3 py-1.5 rounded transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
        {view === 'users' && isAdmin ? (
          <UsersAdmin currentUser={user} />
        ) : (
        <>
        {/* Metric Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Critical Alerts</p>
            <p className="text-2xl font-extrabold text-rose-500 mt-1">{criticalCount}</p>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg">
            <p className="text-xs text-slate-400 uppercase tracking-wider">High Severity</p>
            <p className="text-2xl font-extrabold text-amber-500 mt-1">{highCount}</p>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Total Active</p>
            <p className="text-2xl font-extrabold text-cyan-400 mt-1">{totalActive}</p>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Resolved (Cycle)</p>
            <p className="text-2xl font-extrabold text-emerald-400 mt-1">{resolvedCount}</p>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Live Incident Stream & Submission Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Form Fields Section (operators and admins only) */}
            {canEdit && (
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-lg">
              <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-pink-500"></span>
                <span>Log New Incident Ticket</span>
              </h2>

              <form onSubmit={handleTicketSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Incident Title</label>
                  <input 
                    type="text" 
                    value={ticketTitle} 
                    onChange={(e) => setTicketTitle(e.target.value)}
                    placeholder="e.g. Memory leak detected on worker cluster"
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Detailed Description</label>
                  <textarea 
                    value={ticketDescription} 
                    onChange={(e) => setTicketDescription(e.target.value)}
                    placeholder="Provide diagnostic details..."
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm h-20 focus:outline-none focus:border-purple-500 resize-none"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Category</label>
                    <select 
                      value={ticketCategory} 
                      onChange={(e) => setTicketCategory(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    >
                      <option value="Infrastructure">Infrastructure</option>
                      <option value="Database">Database</option>
                      <option value="Network">Network</option>
                      <option value="Security">Security</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Severity Level</label>
                    <select 
                      value={ticketSeverity} 
                      onChange={(e) => setTicketSeverity(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    >
                      <option value="CRITICAL">CRITICAL</option>
                      <option value="HIGH">HIGH</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Assigned To</label>
                    <input 
                      type="text" 
                      value={ticketAssignedTo} 
                      onChange={(e) => setTicketAssignedTo(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Latitude</label>
                    <input 
                      type="text" 
                      value={ticketLatitude} 
                      onChange={(e) => setTicketLatitude(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Longitude</label>
                    <input 
                      type="text" 
                      value={ticketLongitude} 
                      onChange={(e) => setTicketLongitude(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white font-semibold py-2.5 rounded shadow hover:opacity-90 transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Transmitting Ticket...' : 'Submit Ticket'}
                </button>
              </form>
            </div>
            )}

            {/* Live Incident Stream */}
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-lg">
              <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping"></span>
                <span>Live Incident Stream</span>
              </h2>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {incidents.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No active incidents queued.</p>
                ) : (
                  incidents.map((incident) => (
                    <div 
                      key={incident.id || incident._id} 
                      onClick={() => handleSelectIncident(incident)}
                      className={`p-3.5 rounded border cursor-pointer transition ${selectedIncident?.id === incident.id ? 'bg-slate-800 border-purple-500' : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'}`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-medium text-sm text-slate-200">{incident.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                          incident.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                          incident.severity === 'HIGH' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                          'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        }`}>
                          {incident.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-1">{incident.description}</p>

                      <div className="flex justify-between items-center text-[11px] text-slate-500 mt-2">
                        <span>Cat: {incident.category}</span>
                        {incident.lockedBy && (
                          <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                            🔒 {incident.lockedBy}
                          </span>
                        )}
                        <span>{new Date(incident.created_at || incident.timestamp || Date.now()).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Incident Inspection Console */}
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-lg flex flex-col">
            <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center space-x-2">
              <span className="h-2 w-2 rounded-full bg-purple-500"></span>
              <span>Incident Inspection Console</span>
            </h2>

            {selectedIncident ? (
              <div className="space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Selected Incident</p>
                      <h3 className="text-base font-semibold text-slate-100 mt-0.5">{selectedIncident.title}</h3>
                    </div>
                    {selectedIncident.lockedBy && (
                      <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                        🔒 Locked: {selectedIncident.lockedBy}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-500 block">Category:</span>
                      <span className="text-slate-300 font-medium">{selectedIncident.category}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Assigned To:</span>
                      <span className="text-slate-300 font-medium">{selectedIncident.assignedTo || 'Unassigned'}</span>
                    </div>
                    <div className="col-span-2 mt-2">
                      <span className="text-slate-500 block">Logged Time:</span>
                      <span className="text-slate-300">{new Date(selectedIncident.created_at || selectedIncident.timestamp || Date.now()).toLocaleString()}</span>
                    </div>
                    {selectedIncident.source && selectedIncident.source !== 'enterprise-ui' && (
                      <div className="col-span-2 mt-2">
                        <span className="text-slate-500 block">Source:</span>
                        <span className="text-slate-300 font-mono">
                          {selectedIncident.source}
                          {selectedIncident.externalId ? ` · ${selectedIncident.externalId}` : ''}
                          {selectedIncident.requester ? ` · requested by ${selectedIncident.requester}` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Diagnostic Summary</p>
                    <div className="bg-slate-950 p-3 rounded border border-slate-800 text-xs text-slate-300 min-h-[100px]">
                      {selectedIncident.description}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">History</p>
                    <ol data-testid="incident-history" className="bg-slate-950 p-3 rounded border border-slate-800 text-xs space-y-1.5 max-h-40 overflow-y-auto">
                      {history.length === 0 ? (
                        <li className="text-slate-500">No recorded changes.</li>
                      ) : history.map((e) => (
                        <li key={e.id} className="flex justify-between gap-2">
                          <span className="text-slate-300">
                            {e.action === 'created' && 'Created'}
                            {e.action === 'ingested' && `Received from ${e.actor.name}${e.details.externalId ? ` (${e.details.externalId})` : ''}`}
                            {e.action === 'status_changed' && `${e.details.from} → ${e.details.to}`}
                            {e.action === 'locked' && 'Locked'}
                            {e.actor.type === 'user' && <span className="text-slate-500"> by {e.actor.name}</span>}
                          </span>
                          <span className="text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Inspection Console Actions Footer */}
                <div className="pt-4 border-t border-slate-800 space-y-2">
                  {canEdit && (
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => handleUpdateStatus(selectedIncident.id || selectedIncident._id, 'In Progress')}
                      className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 text-xs font-semibold py-2 rounded transition"
                    >
                      Mark In Progress
                    </button>
                    <button 
                      onClick={() => handleUpdateStatus(selectedIncident.id || selectedIncident._id, 'Resolved')}
                      className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold py-2 rounded transition"
                    >
                      Resolve Incident
                    </button>
                  </div>
                  )}
                  <button 
                    onClick={() => setSelectedIncident(null)}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold py-2 rounded transition"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800 rounded">
                <p className="text-xs text-slate-500">Select an incident from the stream to view full diagnostics and management actions.</p>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}