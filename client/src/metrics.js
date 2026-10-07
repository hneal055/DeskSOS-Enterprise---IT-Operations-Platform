// Dashboard counters. "Critical Alerts" and "High Severity" count only open
// incidents (anything not Resolved), so resolving an incident lowers them;
// "Resolved (Cycle)" counts the resolved ones.
export function incidentMetrics(incidents) {
  const open = incidents.filter((i) => i.status !== 'Resolved');
  return {
    critical: open.filter((i) => i.severity === 'CRITICAL').length,
    high: open.filter((i) => i.severity === 'HIGH').length,
    active: open.length,
    resolved: incidents.length - open.length,
  };
}
