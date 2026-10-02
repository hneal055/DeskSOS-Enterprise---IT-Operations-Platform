import { useState, useEffect } from "react";
import { useAuth } from "./contexts/AuthContext";
import Login from "./components/Login";
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import Dashboard from "./components/modules/Dashboard";
import NetworkDiagnostics from "./components/modules/NetworkDiagnostics";
import EventLog from "./components/modules/EventLog";
import DiskHealth from "./components/modules/DiskHealth";
import DiskSpace from "./components/modules/DiskSpace";
import RecentErrors from "./components/modules/RecentErrors";
import InstalledSoftware from "./components/modules/InstalledSoftware";
import WindowsUpdate from "./components/modules/WindowsUpdate";
import TicketBuilder from "./components/modules/TicketBuilder";
import NetworkAdapters from "./components/modules/NetworkAdapters";
import RunningServices from "./components/modules/RunningServices";
import MemoryConsumers from "./components/modules/MemoryConsumers";
import DashboardSamples from "./components/modules/DashboardSamples";
import NetworkFixes from "./components/modules/NetworkFixes";
import RemoteSession from "./components/modules/RemoteSession";
import Chat from "./components/modules/Chat";


function FixItModule() {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const runAction = async (action: string, command: () => Promise<any>) => {
    setLoading(true);
    setResult("");
    try {
      const res = await command();
      setResult(`✓ ${action}: ${JSON.stringify(res)}`);
    } catch (err) {
      setResult(`✗ ${action} failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-purple-400 mb-4">🌐 Network Fixes</h2>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => runAction("Flush DNS", () => invoke("flush_dns"))} disabled={loading} className="px-4 py-3 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">Flush DNS</button>
          <button type="button" onClick={() => runAction("Renew IP", () => invoke("renew_ip"))} disabled={loading} className="px-4 py-3 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">Renew IP</button>
          <button type="button" onClick={() => runAction("Reset Network", () => invoke("reset_network"))} disabled={loading} className="px-4 py-3 rounded bg-red-600 hover:bg-red-700 text-white font-semibold">Reset Network</button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-orange-400 mb-4">🖨️ Printer Rescue</h2>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => runAction("Restart Spooler", () => invoke("restart_print_spooler"))} disabled={loading} className="px-4 py-3 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">Restart Spooler</button>
          <button type="button" onClick={() => runAction("Clear Queue", () => invoke("clear_print_queue"))} disabled={loading} className="px-4 py-3 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">Clear Queue</button>
        </div>
      </div>

      {result && <div className="bg-gray-700 rounded p-4 text-gray-300">{result}</div>}
    </div>
  );
}

const PROTECTED_PROCESSES = new Set([
  "system", "system idle process", "dwm", "csrss", "wininit",
  "winlogon", "services", "lsass", "smss", "svchost", "registry",
]);

function ProcessModule() {
  const [processes, setProcesses]: any = useState([]);
  const [loading, setLoading] = useState(false);
  const [armedPid, setArmedPid] = useState<number | null>(null);

  const loadProcesses = async () => {
    setLoading(true);
    try {
      const procs = await invoke("get_top_processes", { limit: 10 });
      setProcesses(procs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProcesses();
  }, []);

  // Auto-disarm the "Confirm Kill?" state if the user doesn't confirm within 4 seconds
  useEffect(() => {
    if (armedPid === null) return;
    const timer = setTimeout(() => setArmedPid(null), 4000);
    return () => clearTimeout(timer);
  }, [armedPid]);

  const handleKillClick = async (p: any) => {
    const isProtected = PROTECTED_PROCESSES.has((p.name || "").toLowerCase());
    if (isProtected) {
      alert(`"${p.name}" is a protected system process and cannot be killed from here — doing so would crash or force-restart this machine.`);
      return;
    }

    if (armedPid !== p.pid) {
      // First click: arm it, require a second click to confirm
      setArmedPid(p.pid);
      return;
    }

    // Second click within the window: actually kill it
    setArmedPid(null);
    try {
      await invoke("kill_process", { pid: p.pid });
      loadProcesses();
    } catch (e) {
      alert(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-yellow-400 mb-4">📊 Top Processes</h2>
        <button type="button" onClick={loadProcesses} disabled={loading} className="mb-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Refresh</button>
        <div className="space-y-2">
          {processes.map((p: any, i: number) => {
            const isProtected = PROTECTED_PROCESSES.has((p.name || "").toLowerCase());
            const isArmed = armedPid === p.pid;
            return (
              <div key={i} className="bg-gray-700 p-3 rounded flex justify-between items-center">
                <div>
                  <div className="text-white font-semibold">
                    {p.name}
                    {isProtected && <span className="ml-2 text-xs text-gray-400">(protected)</span>}
                  </div>
                  <div className="text-gray-400 text-sm">PID: {p.pid} | CPU: {p.cpu_percent}% | Memory: {p.memory_mb}MB</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleKillClick(p)}
                  disabled={isProtected}
                  className={`px-3 py-1 rounded text-white text-sm ${
                    isProtected
                      ? "bg-gray-600 cursor-not-allowed opacity-50"
                      : isArmed
                        ? "bg-orange-500 hover:bg-orange-600 animate-pulse"
                        : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {isProtected ? "Locked" : isArmed ? "Confirm Kill?" : "Kill"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PowerShellModule() {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const runCommand = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setOutput("");
    try {
      const result = await invoke("run_custom_powershell", { command });
      setOutput(result as string);
    } catch (err) {
      setOutput(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-cyan-400 mb-4">💻 PowerShell Console</h2>
        <textarea value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Enter PowerShell command..." className="w-full bg-gray-700 text-white p-3 rounded font-mono h-32 mb-3" />
        <button type="button" onClick={runCommand} disabled={loading} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">{loading ? "Running..." : "Execute"}</button>
        {output && <pre className="mt-4 bg-gray-900 text-green-400 p-4 rounded font-mono text-sm overflow-auto max-h-96">{output}</pre>}
      </div>
    </div>
  );
}

function AppShell() {
  const { user, logout } = useAuth();
  const [activeModule, setActiveModule] = useState("dashboard");

  const modules = [
    { id: "dashboard",  name: "🏠 Dashboard",   component: <Dashboard /> },
    { id: "network",    name: "🌐 Network",      component: <NetworkDiagnostics /> },
    { id: "adapters",   name: "🔌 Adapters",     component: <NetworkAdapters /> },
    { id: "eventlog",   name: "📋 Event Log",    component: <EventLog /> },
    { id: "errors",     name: "🚨 Errors",       component: <RecentErrors /> },
    { id: "diskhealth", name: "💾 Disk Health",  component: <DiskHealth /> },
    { id: "diskspace",  name: "🗂️ Disk Space",  component: <DiskSpace /> },
    { id: "memory",     name: "🧠 Memory",       component: <MemoryConsumers /> },
    { id: "processes",  name: "📊 Processes",    component: <ProcessModule /> },
    { id: "software",   name: "📦 Software",     component: <InstalledSoftware /> },
    { id: "services",   name: "🧰 Services",     component: <RunningServices /> },
    { id: "updates",    name: "🔄 Updates",      component: <WindowsUpdate /> },
    { id: "ticket",     name: "🎫 Ticket",       component: <TicketBuilder /> },
    { id: "fixit",      name: "🔧 Fix It",       component: <FixItModule /> },
    { id: "netfixes",   name: "🛠️ Net Fixes",   component: <NetworkFixes /> },
    { id: "samples",    name: "🎛️ Samples",     component: <DashboardSamples /> },
    { id: "powershell", name: "💻 PowerShell",   component: <PowerShellModule /> },
    { id: "remote",     name: "📡 Remote",        component: <RemoteSession /> },
    { id: "chat",      name: "💬 Chat",        component: <Chat /> },
  ];

  return (
    <div className="flex h-screen bg-gray-900">
      <div className="w-48 bg-gray-800 p-4 border-r border-gray-700 flex flex-col overflow-hidden">
        <div className="shrink-0 mb-4">
          <h1 className="text-xl font-bold text-blue-400">DeskSOS</h1>
          {user && (
            <div className="mt-1 text-xs text-gray-500 truncate" title={user.email}>
              {user.name} · {user.role}
            </div>
          )}
        </div>
        <div className="space-y-1 overflow-y-auto flex-1">
          {modules.map((mod) => (
            <button type="button" key={mod.id} onClick={() => setActiveModule(mod.id)} className={`w-full text-left px-3 py-2 rounded transition ${activeModule === mod.id ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-700"}`}>{mod.name}</button>
          ))}
        </div>
        <button
            type="button"
            onClick={logout}
            className="mt-3 w-full text-left px-3 py-2 rounded text-red-400 hover:bg-gray-700 text-sm shrink-0"
          >
            ⇠ Sign out
          </button>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {modules.find((m) => m.id === activeModule)?.component}
        </div>
      </div>
    </div>
  );
}
export default function App() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <AppShell /> : <Login />;
}
