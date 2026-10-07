import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { incidentMetrics } from '../metrics';

// The live socket is replaced by an inert stand-in
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

import App from '../App';

const incidents = [
  { id: 1, title: 'Core switch down', description: 'x', category: 'Network', severity: 'CRITICAL', status: 'Open', created_at: '2026-10-07T10:00:00Z' },
  { id: 2, title: 'Old outage', description: 'x', category: 'Network', severity: 'CRITICAL', status: 'Resolved', created_at: '2026-10-06T10:00:00Z' },
  { id: 3, title: 'Slow VPN', description: 'x', category: 'Network', severity: 'HIGH', status: 'Resolved', created_at: '2026-10-06T09:00:00Z' },
  { id: 4, title: 'Printer jam', description: 'x', category: 'Infrastructure', severity: 'MEDIUM', status: 'In Progress', created_at: '2026-10-07T09:00:00Z' },
];

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } });

let postResponse;
beforeEach(() => {
  postResponse = () => json(201, { id: 99 });
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    if (url.endsWith('/api/incidents') && opts.method === 'POST') return postResponse(opts);
    if (url.endsWith('/api/incidents')) return json(200, incidents);
    return json(200, []);
  }));
});

const operator = { id: 2, name: 'Jane Operator', role: 'operator' };
const renderApp = () => render(<App user={operator} onSignOut={() => {}} onSessionEnded={() => {}} onChangePassword={() => {}} />);
const counter = (label) => screen.getByText(label).nextElementSibling.textContent;

describe('incidentMetrics', () => {
  it('counts only open incidents as Critical and High', () => {
    expect(incidentMetrics(incidents)).toEqual({ critical: 1, high: 0, active: 2, resolved: 2 });
  });
  it('handles an empty list', () => {
    expect(incidentMetrics([])).toEqual({ critical: 0, high: 0, active: 0, resolved: 0 });
  });
});

describe('dashboard counters', () => {
  it('do not count resolved incidents as Critical or High', async () => {
    renderApp();
    await screen.findByText('Core switch down');
    expect(counter('Critical Alerts')).toBe('1');
    expect(counter('High Severity')).toBe('0');
    expect(counter('Total Active')).toBe('2');
    expect(counter('Resolved (Cycle)')).toBe('2');
  });
});

describe('Log New Incident Ticket form', () => {
  it('starts with empty optional fields instead of demo values', async () => {
    renderApp();
    expect(screen.getByPlaceholderText('Unassigned')).toHaveValue('');
    const [lat, lon] = screen.getAllByPlaceholderText('Optional');
    expect(lat).toHaveValue('');
    expect(lon).toHaveValue('');
  });

  it('shows the server reason and keeps the text when the incident is rejected', async () => {
    postResponse = () => json(400, { error: 'Validation failed', details: ['title: must be at most 255 characters'] });
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByPlaceholderText(/Memory leak/), 'Mail server down');
    await user.type(screen.getByPlaceholderText(/diagnostic details/), 'No mail since 9am');
    await user.click(screen.getByRole('button', { name: 'Submit Ticket' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The incident wasn't logged: title: must be at most 255 characters");
    expect(screen.getByPlaceholderText(/Memory leak/)).toHaveValue('Mail server down');
  });

  it('says so when the server cannot be reached', async () => {
    postResponse = () => { throw new TypeError('Failed to fetch'); };
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByPlaceholderText(/Memory leak/), 'Mail server down');
    await user.type(screen.getByPlaceholderText(/diagnostic details/), 'No mail since 9am');
    await user.click(screen.getByRole('button', { name: 'Submit Ticket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("server couldn't be reached");
  });

  it('clears the form and shows no error when the incident is logged', async () => {
    let sent;
    postResponse = (opts) => { sent = JSON.parse(opts.body); return json(201, { id: 99 }); };
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByPlaceholderText(/Memory leak/), 'Mail server down');
    await user.type(screen.getByPlaceholderText(/diagnostic details/), 'No mail since 9am');
    await user.click(screen.getByRole('button', { name: 'Submit Ticket' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Memory leak/)).toHaveValue(''));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Blank optional fields go to the server as "not provided"
    expect(sent.assignedTo).toBe('');
    expect(sent.location).toEqual({ latitude: null, longitude: null });
  });

  it('is not shown to viewers', async () => {
    render(<App user={{ id: 3, name: 'Val Viewer', role: 'viewer' }} onSignOut={() => {}} onSessionEnded={() => {}} onChangePassword={() => {}} />);
    await screen.findByText('Core switch down');
    expect(screen.queryByText('Log New Incident Ticket')).not.toBeInTheDocument();
  });
});
