import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listServers,
  deleteServer,
  connectServer,
  disconnectServer,
  reconnectServer,
  enableServer,
  disableServer,
  initiateAuth,
  revokeAuth,
  subscribeToEvents,
  type ServerEntry,
  type GatewayEventData,
} from "./api";
import ServerCard from "./components/ServerCard";
import AddServerModal from "./components/AddServerModal";
import EditServerModal from "./components/EditServerModal";
import OAuthNotification from "./components/OAuthNotification";
import LogViewer from "./components/LogViewer";
import {
  Plus,
  RefreshCw,
  Server,
  Wrench,
  BookOpen,
  MessageSquare,
  Activity,
  Loader2,
  ScrollText,
} from "lucide-react";

type ModalState =
  | { type: "none" }
  | { type: "add" }
  | { type: "edit"; server: ServerEntry };

export default function App() {
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const [showLogViewer, setShowLogViewer] = useState(false);

  // ─── OAuth callback notification ─────────────────────────────────────────
  const oauthStatus = searchParams.get("oauth");
  const oauthMessage = searchParams.get("message");
  const oauthServerId = searchParams.get("serverId");

  const clearOAuthParams = useCallback(() => {
    searchParams.delete("oauth");
    searchParams.delete("message");
    searchParams.delete("serverId");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // ─── Fetch servers ──────────────────────────────────────────────────────
  const fetchServers = useCallback(async () => {
    try {
      const data = await listServers();
      setServers(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch servers:", err);
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  // ─── SSE subscription for live updates ───────────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToEvents(
      (event: GatewayEventData) => {
        switch (event.type) {
          case "server:status":
            setServers((prev) =>
              prev.map((s) =>
                s.id === event.status.id
                  ? {
                      ...s,
                      runtime: {
                        status: event.status.status,
                        error: event.status.error,
                        tools: event.status.tools,
                        resources: event.status.resources,
                        prompts: event.status.prompts,
                        lastConnected: event.status.lastConnected,
                      },
                    }
                  : s
              )
            );
            break;
          case "server:added":
          case "server:updated":
            fetchServers();
            break;
          case "server:removed":
            setServers((prev) => prev.filter((s) => s.id !== event.serverId));
            break;
          case "oauth:required":
            // Auto-open auth URL in a new tab
            window.open(event.authUrl, "_blank");
            break;
          default:
            break;
        }
      },
      () => {
        // On SSE error, try to refetch
        setTimeout(fetchServers, 3000);
      }
    );

    return unsubscribe;
  }, [fetchServers]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const setActionLoadingFor = (id: string, value: boolean) => {
    setActionLoading((prev) => ({ ...prev, [id]: value }));
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this server?")) return;
    setActionLoadingFor(id, true);
    try {
      await deleteServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Failed to delete server:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleConnect = async (id: string) => {
    setActionLoadingFor(id, true);
    try {
      await connectServer(id);
    } catch (err) {
      console.error("Failed to connect:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleDisconnect = async (id: string) => {
    setActionLoadingFor(id, true);
    try {
      await disconnectServer(id);
    } catch (err) {
      console.error("Failed to disconnect:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleReconnect = async (id: string) => {
    setActionLoadingFor(id, true);
    try {
      await reconnectServer(id);
    } catch (err) {
      console.error("Failed to reconnect:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    setActionLoadingFor(id, true);
    try {
      if (enabled) {
        await enableServer(id);
      } else {
        await disableServer(id);
      }
      await fetchServers();
    } catch (err) {
      console.error("Failed to toggle server:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleInitiateAuth = async (id: string) => {
    setActionLoadingFor(id, true);
    try {
      const response = await initiateAuth(id);
      if (response.result === "REDIRECT" && response.authUrl) {
        window.open(response.authUrl, "_blank");
      } else if (response.result === "AUTHORIZED") {
        // Already authorized — refresh the server list to pick up the new status
        await fetchServers();
      }
    } catch (err) {
      console.error("Failed to initiate auth:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleRevokeAuth = async (id: string) => {
    if (!window.confirm("Revoke OAuth tokens for this server? You will need to re-authenticate.")) return;
    setActionLoadingFor(id, true);
    try {
      await revokeAuth(id);
      await fetchServers();
    } catch (err) {
      console.error("Failed to revoke auth:", err);
    } finally {
      setActionLoadingFor(id, false);
    }
  };

  const handleServerCreated = () => {
    setModal({ type: "none" });
    fetchServers();
  };

  const handleServerUpdated = () => {
    setModal({ type: "none" });
    fetchServers();
  };

  // ─── Aggregated stats ─────────────────────────────────────────────────────
  const connectedCount = servers.filter(
    (s) => s.runtime.status === "connected"
  ).length;
  const totalTools = servers.reduce(
    (acc, s) => acc + (s.runtime.tools?.length ?? 0),
    0
  );
  const totalResources = servers.reduce(
    (acc, s) => acc + (s.runtime.resources?.length ?? 0),
    0
  );
  const totalPrompts = servers.reduce(
    (acc, s) => acc + (s.runtime.prompts?.length ?? 0),
    0
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950">
      {/* OAuth callback notification */}
      {oauthStatus && (
        <OAuthNotification
          status={oauthStatus as "success" | "error"}
          message={oauthMessage}
          serverId={oauthServerId}
          onDismiss={clearOAuthParams}
        />
      )}

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-gateway-500 to-gateway-700 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight">
                  MCP Gateway
                </h1>
                <p className="text-xs text-gray-500 -mt-0.5">
                  Model Context Protocol Server Manager
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLogViewer(true)}
                className="btn-ghost flex items-center gap-1.5 text-sm"
                title="View request logs"
              >
                <ScrollText className="w-4 h-4" />
                <span className="hidden sm:inline">Logs</span>
              </button>
              <button
                onClick={fetchServers}
                className="btn-ghost flex items-center gap-1.5 text-sm"
                title="Refresh servers"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                onClick={() => setModal({ type: "add" })}
                className="btn-primary flex items-center gap-1.5 text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add Server</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<Server className="w-5 h-5" />}
            label="Servers"
            value={`${connectedCount}/${servers.length}`}
            sublabel="connected"
            color="blue"
          />
          <StatCard
            icon={<Wrench className="w-5 h-5" />}
            label="Tools"
            value={totalTools}
            sublabel="available"
            color="green"
          />
          <StatCard
            icon={<BookOpen className="w-5 h-5" />}
            label="Resources"
            value={totalResources}
            sublabel="available"
            color="purple"
          />
          <StatCard
            icon={<MessageSquare className="w-5 h-5" />}
            label="Prompts"
            value={totalPrompts}
            sublabel="available"
            color="yellow"
          />
        </div>

        {/* Server List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-gateway-500 animate-spin" />
            <span className="ml-3 text-gray-400">Loading servers...</span>
          </div>
        ) : error ? (
          <div className="card p-8 text-center">
            <div className="text-red-400 mb-2 font-medium">
              Failed to load servers
            </div>
            <p className="text-gray-500 text-sm mb-4">{error}</p>
            <button onClick={fetchServers} className="btn-primary text-sm">
              Retry
            </button>
          </div>
        ) : servers.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Server className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">
              No MCP servers registered
            </h3>
            <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
              Get started by adding your first MCP server. You can register local
              servers (via stdio) or remote servers (via SSE or Streamable HTTP),
              with optional OAuth authentication.
            </p>
            <button
              onClick={() => setModal({ type: "add" })}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Your First Server
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                isLoading={!!actionLoading[server.id]}
                onConnect={() => handleConnect(server.id)}
                onDisconnect={() => handleDisconnect(server.id)}
                onReconnect={() => handleReconnect(server.id)}
                onToggleEnabled={(enabled) =>
                  handleToggleEnabled(server.id, enabled)
                }
                onEdit={() => setModal({ type: "edit", server })}
                onDelete={() => handleDelete(server.id)}
                onInitiateAuth={() => handleInitiateAuth(server.id)}
                onRevokeAuth={() => handleRevokeAuth(server.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      {modal.type === "add" && (
        <AddServerModal
          onClose={() => setModal({ type: "none" })}
          onCreated={handleServerCreated}
        />
      )}
      {modal.type === "edit" && (
        <EditServerModal
          server={modal.server}
          onClose={() => setModal({ type: "none" })}
          onUpdated={handleServerUpdated}
        />
      )}

      {/* Log Viewer */}
      {showLogViewer && (
        <LogViewer onClose={() => setShowLogViewer(false)} />
      )}
    </div>
  );
}

// ─── Stat Card Component ─────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sublabel,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel: string;
  color: "blue" | "green" | "purple" | "yellow";
}) {
  const colorClasses = {
    blue: "text-blue-400 bg-blue-900/30",
    green: "text-green-400 bg-green-900/30",
    purple: "text-purple-400 bg-purple-900/30",
    yellow: "text-yellow-400 bg-yellow-900/30",
  };

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses[color]}`}
        >
          {icon}
        </div>
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-white">{value}</span>
            <span className="text-xs text-gray-500">{sublabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}