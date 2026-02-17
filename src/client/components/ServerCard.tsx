import React, { useState } from "react";
import type { ServerEntry, ConnectionStatus } from "../api";
import {
  ChevronDown,
  ChevronUp,
  Plug,
  Unplug,
  RefreshCw,
  Edit,
  Trash2,
  Power,
  PowerOff,
  Shield,
  ShieldOff,
  ExternalLink,
  Terminal,
  Globe,
  Wrench,
  BookOpen,
  MessageSquare,
  Loader2,
  AlertCircle,
  Clock,
  Zap,
  KeyRound,
} from "lucide-react";

interface ServerCardProps {
  server: ServerEntry;
  isLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onInitiateAuth: () => void;
  onRevokeAuth: () => void;
}

function getStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    case "awaiting_oauth":
      return "Awaiting OAuth";
    default:
      return status;
  }
}

function getStatusBadgeClass(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "badge-green";
    case "connecting":
      return "badge-yellow";
    case "disconnected":
      return "badge-gray";
    case "error":
      return "badge-red";
    case "awaiting_oauth":
      return "badge-blue";
    default:
      return "badge-gray";
  }
}

function getStatusDotClass(status: ConnectionStatus): string {
  return `status-dot status-dot-${status}`;
}

function getTransportBadge(transport: string): { label: string; className: string } {
  switch (transport) {
    case "stdio":
      return { label: "Local (stdio)", className: "badge-purple" };
    case "sse":
      return { label: "Remote (SSE)", className: "badge-blue" };
    case "streamable-http":
      return { label: "Remote (HTTP)", className: "badge-blue" };
    default:
      return { label: transport, className: "badge-gray" };
  }
}

function getTransportIcon(transport: string): React.ReactNode {
  switch (transport) {
    case "stdio":
      return <Terminal className="w-4 h-4" />;
    default:
      return <Globe className="w-4 h-4" />;
  }
}

function formatTimeAgo(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function ServerCard({
  server,
  isLoading,
  onConnect,
  onDisconnect,
  onReconnect,
  onToggleEnabled,
  onEdit,
  onDelete,
  onInitiateAuth,
  onRevokeAuth,
}: ServerCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { runtime, auth } = server;
  const status = runtime.status;
  const transportBadge = getTransportBadge(server.transport);
  const lastConnected = formatTimeAgo(runtime.lastConnected);
  const isRemote = server.transport !== "stdio";
  const hasOAuth = isRemote && !!server.oauth?.enabled;

  return (
    <div className="card-hover animate-fade-in">
      {/* Main Row */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Status + Info */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Status indicator */}
            <div className="mt-1.5 flex-shrink-0">
              <div className={getStatusDotClass(status)} />
            </div>

            {/* Server info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-white truncate">
                  {server.name}
                </h3>
                {!server.enabled && (
                  <span className="badge-gray text-[10px] uppercase tracking-wider">
                    Disabled
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={transportBadge.className}>
                  <span className="mr-1">{getTransportIcon(server.transport)}</span>
                  {transportBadge.label}
                </span>
                <span className={getStatusBadgeClass(status)}>
                  {getStatusLabel(status)}
                </span>
                {hasOAuth && (
                  <span className={auth.isAuthenticated ? "badge-green" : "badge-yellow"}>
                    <Shield className="w-3 h-3 mr-1" />
                    {auth.isAuthenticated
                      ? "Authenticated"
                      : "Not Authenticated"}
                  </span>
                )}
              </div>

              {/* Connection details */}
              <div className="mt-1.5 text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                {server.transport === "stdio" ? (
                  <span className="font-mono truncate max-w-xs" title={`${server.command} ${server.args?.join(" ") ?? ""}`}>
                    {server.command} {server.args?.join(" ")}
                  </span>
                ) : (
                  <span className="font-mono truncate max-w-xs" title={server.url}>
                    {server.url}
                  </span>
                )}
                {lastConnected && (
                  <span className="flex items-center gap-1 text-gray-600">
                    <Clock className="w-3 h-3" />
                    {lastConnected}
                  </span>
                )}
              </div>

              {/* Error message */}
              {runtime.error && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span className="break-all">{runtime.error}</span>
                </div>
              )}

              {/* Capability summary (when connected) */}
              {status === "connected" && (
                <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                  {runtime.tools.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Wrench className="w-3.5 h-3.5 text-green-500" />
                      {runtime.tools.length} tool{runtime.tools.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {runtime.resources.length > 0 && (
                    <span className="flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5 text-purple-500" />
                      {runtime.resources.length} resource{runtime.resources.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {runtime.prompts.length > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5 text-yellow-500" />
                      {runtime.prompts.length} prompt{runtime.prompts.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {runtime.tools.length === 0 &&
                    runtime.resources.length === 0 &&
                    runtime.prompts.length === 0 && (
                      <span className="text-gray-600 italic">No capabilities discovered</span>
                    )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {isLoading && (
              <Loader2 className="w-4 h-4 text-gateway-400 animate-spin mr-1" />
            )}

            {/* Enable/Disable toggle */}
            <button
              onClick={() => onToggleEnabled(!server.enabled)}
              disabled={isLoading}
              className="btn-icon"
              title={server.enabled ? "Disable server" : "Enable server"}
            >
              {server.enabled ? (
                <Power className="w-4 h-4 text-green-400" />
              ) : (
                <PowerOff className="w-4 h-4 text-gray-500" />
              )}
            </button>

            {/* Connection actions */}
            {server.enabled && status === "disconnected" && (
              <button
                onClick={onConnect}
                disabled={isLoading}
                className="btn-icon"
                title="Connect"
              >
                <Plug className="w-4 h-4 text-green-400" />
              </button>
            )}
            {status === "connected" && (
              <button
                onClick={onDisconnect}
                disabled={isLoading}
                className="btn-icon"
                title="Disconnect"
              >
                <Unplug className="w-4 h-4 text-yellow-400" />
              </button>
            )}
            {(status === "error" || status === "connected") && (
              <button
                onClick={onReconnect}
                disabled={isLoading}
                className="btn-icon"
                title="Reconnect"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            {/* OAuth actions */}
            {hasOAuth && !auth.isAuthenticated && (
              <button
                onClick={onInitiateAuth}
                disabled={isLoading}
                className="btn-icon"
                title="Authenticate with OAuth"
              >
                <ExternalLink className="w-4 h-4 text-blue-400" />
              </button>
            )}

            {/* Edit / Delete */}
            <button
              onClick={onEdit}
              disabled={isLoading}
              className="btn-icon"
              title="Edit server"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="btn-icon"
              title="Delete server"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>

            {/* Expand/collapse */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="btn-icon"
              title={expanded ? "Collapse" : "Expand details"}
            >
              {expanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Details Panel */}
      {expanded && (
        <div className="border-t border-gray-800 p-4 sm:p-5 space-y-5 animate-fade-in bg-gray-900/50">
          {/* Server Configuration Details */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Configuration
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">ID:</span>{" "}
                <span className="text-gray-300 font-mono text-xs">{server.id}</span>
              </div>
              <div>
                <span className="text-gray-500">Transport:</span>{" "}
                <span className="text-gray-300">{server.transport}</span>
              </div>
              {server.transport === "stdio" ? (
                <>
                  <div>
                    <span className="text-gray-500">Command:</span>{" "}
                    <span className="text-gray-300 font-mono">{server.command}</span>
                  </div>
                  {server.args && server.args.length > 0 && (
                    <div>
                      <span className="text-gray-500">Args:</span>{" "}
                      <span className="text-gray-300 font-mono">{server.args.join(" ")}</span>
                    </div>
                  )}
                  {server.cwd && (
                    <div>
                      <span className="text-gray-500">Working Dir:</span>{" "}
                      <span className="text-gray-300 font-mono">{server.cwd}</span>
                    </div>
                  )}
                  {server.env && Object.keys(server.env).length > 0 && (
                    <div className="sm:col-span-2">
                      <span className="text-gray-500">Environment:</span>{" "}
                      <span className="text-gray-300 font-mono text-xs">
                        {Object.entries(server.env)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="sm:col-span-2">
                    <span className="text-gray-500">URL:</span>{" "}
                    <span className="text-gray-300 font-mono text-xs break-all">{server.url}</span>
                  </div>
                  {server.headers && Object.keys(server.headers).length > 0 && (
                    <div className="sm:col-span-2">
                      <span className="text-gray-500">Headers:</span>{" "}
                      <span className="text-gray-300 font-mono text-xs">
                        {Object.entries(server.headers)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div>
                <span className="text-gray-500">Created:</span>{" "}
                <span className="text-gray-300 text-xs">{new Date(server.createdAt).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500">Updated:</span>{" "}
                <span className="text-gray-300 text-xs">{new Date(server.updatedAt).toLocaleString()}</span>
              </div>
            </div>
          </section>

          {/* OAuth Section (for remote servers with OAuth) */}
          {hasOAuth && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                OAuth Authentication
              </h4>
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Status:</span>{" "}
                    {auth.isAuthenticated ? (
                      <span className="text-green-400">✓ Authenticated</span>
                    ) : (
                      <span className="text-yellow-400">✗ Not Authenticated</span>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">Client:</span>{" "}
                    {auth.hasClientInfo ? (
                      <span className="text-gray-300 font-mono text-xs flex items-center gap-1">
                        <KeyRound className="w-3 h-3 text-green-500" />
                        {server.oauth?.clientId || "Dynamically registered"}
                      </span>
                    ) : server.oauth?.clientId ? (
                      <span className="text-gray-300 font-mono text-xs">
                        {server.oauth.clientId}
                      </span>
                    ) : (
                      <span className="text-gray-500 text-xs italic">
                        Will use dynamic registration
                      </span>
                    )}
                  </div>
                  {server.oauth?.scopes && server.oauth.scopes.length > 0 && (
                    <div className="sm:col-span-2">
                      <span className="text-gray-500">Scopes:</span>{" "}
                      <span className="text-gray-300 font-mono text-xs">
                        {server.oauth.scopes.join(", ")}
                      </span>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <span className="text-gray-500">Discovery:</span>{" "}
                    <span className="text-gray-400 text-xs">
                      Auto-discovered via <code className="text-blue-400">.well-known/oauth-authorization-server</code>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {!auth.isAuthenticated ? (
                    <button
                      onClick={onInitiateAuth}
                      disabled={isLoading}
                      className="btn-primary text-xs flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Authenticate
                    </button>
                  ) : null}
                  {auth.isAuthenticated && (
                    <button
                      onClick={onRevokeAuth}
                      disabled={isLoading}
                      className="btn-danger text-xs flex items-center gap-1.5"
                    >
                      <ShieldOff className="w-3.5 h-3.5" />
                      Revoke Tokens
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Tools */}
          {runtime.tools.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-green-500" />
                Tools ({runtime.tools.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {runtime.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-green-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-200 truncate">
                        {tool.name}
                      </span>
                    </div>
                    {tool.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        {tool.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Resources */}
          {runtime.resources.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-purple-500" />
                Resources ({runtime.resources.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {runtime.resources.map((resource) => (
                  <div
                    key={resource.uri}
                    className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2"
                  >
                    <div className="text-sm font-medium text-gray-200 truncate">
                      {resource.name}
                    </div>
                    <div className="text-xs text-gray-600 font-mono truncate">
                      {resource.uri}
                    </div>
                    {resource.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        {resource.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Prompts */}
          {runtime.prompts.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-yellow-500" />
                Prompts ({runtime.prompts.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {runtime.prompts.map((prompt) => (
                  <div
                    key={prompt.name}
                    className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2"
                  >
                    <div className="text-sm font-medium text-gray-200 truncate">
                      {prompt.name}
                    </div>
                    {prompt.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        {prompt.description}
                      </p>
                    )}
                    {prompt.arguments && prompt.arguments.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        {prompt.arguments.map((arg) => (
                          <span
                            key={arg.name}
                            className="text-[10px] font-mono bg-gray-700/50 text-gray-400 px-1.5 py-0.5 rounded"
                            title={arg.description}
                          >
                            {arg.name}
                            {arg.required && <span className="text-red-400">*</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* No capabilities warning when connected */}
          {status === "connected" &&
            runtime.tools.length === 0 &&
            runtime.resources.length === 0 &&
            runtime.prompts.length === 0 && (
              <div className="text-sm text-gray-500 italic bg-gray-800/30 rounded-lg p-4 text-center">
                This server is connected but did not expose any tools, resources, or prompts.
              </div>
            )}
        </div>
      )}
    </div>
  );
}