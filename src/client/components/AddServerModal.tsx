import React, { useState } from "react";
import { createServer, type CreateServerPayload, type OAuthConfig } from "../api";
import { X, Terminal, Globe, Plus, Minus, Shield, Loader2, AlertCircle } from "lucide-react";

type ServerType = "local" | "remote";
type RemoteTransport = "sse" | "streamable-http";

interface AddServerModalProps {
  onClose: () => void;
  onCreated: () => void;
}

interface EnvVar {
  key: string;
  value: string;
}

interface HeaderEntry {
  key: string;
  value: string;
}

export default function AddServerModal({ onClose, onCreated }: AddServerModalProps) {
  // General
  const [serverType, setServerType] = useState<ServerType>("local");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local (stdio)
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // Remote (sse / streamable-http)
  const [remoteTransport, setRemoteTransport] = useState<RemoteTransport>("sse");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderEntry[]>([]);

  // OAuth (simplified — endpoints are auto-discovered via .well-known)
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScopes, setOauthScopes] = useState("");

  // ─── Env var management ────────────────────────────────────────────────────

  const addEnvVar = () => setEnvVars([...envVars, { key: "", value: "" }]);
  const removeEnvVar = (index: number) =>
    setEnvVars(envVars.filter((_, i) => i !== index));
  const updateEnvVar = (index: number, field: "key" | "value", val: string) =>
    setEnvVars(envVars.map((e, i) => (i === index ? { ...e, [field]: val } : e)));

  // ─── Header management ────────────────────────────────────────────────────

  const addHeader = () => setHeaders([...headers, { key: "", value: "" }]);
  const removeHeader = (index: number) =>
    setHeaders(headers.filter((_, i) => i !== index));
  const updateHeader = (index: number, field: "key" | "value", val: string) =>
    setHeaders(headers.map((h, i) => (i === index ? { ...h, [field]: val } : h)));

  // ─── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Server name is required.");
      return;
    }

    let payload: CreateServerPayload;

    if (serverType === "local") {
      if (!command.trim()) {
        setError("Command is required for local servers.");
        return;
      }

      const parsedArgs = args
        .split(/\s+/)
        .map((a) => a.trim())
        .filter(Boolean);

      const env: Record<string, string> = {};
      for (const { key, value } of envVars) {
        if (key.trim()) {
          env[key.trim()] = value;
        }
      }

      payload = {
        name: name.trim(),
        transport: "stdio" as const,
        command: command.trim(),
        args: parsedArgs.length > 0 ? parsedArgs : undefined,
        cwd: cwd.trim() || undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled,
      };
    } else {
      if (!url.trim()) {
        setError("URL is required for remote servers.");
        return;
      }

      try {
        new URL(url.trim());
      } catch {
        setError("Please enter a valid URL.");
        return;
      }

      const hdrs: Record<string, string> = {};
      for (const { key, value } of headers) {
        if (key.trim()) {
          hdrs[key.trim()] = value;
        }
      }

      let oauth: OAuthConfig | undefined;
      if (oauthEnabled) {
        const scopes = oauthScopes
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);

        oauth = {
          enabled: true,
          clientId: oauthClientId.trim() || undefined,
          clientSecret: oauthClientSecret.trim() || undefined,
          scopes: scopes.length > 0 ? scopes : undefined,
        };
      }

      payload = {
        name: name.trim(),
        transport: remoteTransport,
        url: url.trim(),
        headers: Object.keys(hdrs).length > 0 ? hdrs : undefined,
        oauth,
        enabled,
      };
    }

    setSubmitting(true);
    try {
      await createServer(payload);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server.");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Close on backdrop click ──────────────────────────────────────────────

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Add MCP Server</h2>
          <button onClick={onClose} className="btn-icon">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20 border border-red-900/30 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Server Type Tabs */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setServerType("local")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-150 ${
                serverType === "local"
                  ? "border-gateway-500 bg-gateway-500/10 text-white"
                  : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
              }`}
            >
              <Terminal className="w-5 h-5" />
              <div className="text-left">
                <div className="text-sm font-medium">Local Server</div>
                <div className="text-xs opacity-60">stdio transport</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setServerType("remote")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-150 ${
                serverType === "remote"
                  ? "border-gateway-500 bg-gateway-500/10 text-white"
                  : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
              }`}
            >
              <Globe className="w-5 h-5" />
              <div className="text-left">
                <div className="text-sm font-medium">Remote Server</div>
                <div className="text-xs opacity-60">SSE / HTTP transport</div>
              </div>
            </button>
          </div>

          {/* Server Name */}
          <div>
            <label htmlFor="server-name" className="label">
              Server Name
            </label>
            <input
              id="server-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My MCP Server"
              className="input-field"
              autoFocus
              required
            />
          </div>

          {/* ─── Local Server Fields ────────────────────────────────────────── */}
          {serverType === "local" && (
            <>
              <div>
                <label htmlFor="command" className="label">
                  Command
                </label>
                <input
                  id="command"
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g., npx, node, python"
                  className="input-field font-mono"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  The executable to run the MCP server.
                </p>
              </div>

              <div>
                <label htmlFor="args" className="label">
                  Arguments
                </label>
                <input
                  id="args"
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="e.g., -y @modelcontextprotocol/server-filesystem /tmp"
                  className="input-field font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Space-separated arguments to pass to the command.
                </p>
              </div>

              <div>
                <label htmlFor="cwd" className="label">
                  Working Directory <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  id="cwd"
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="e.g., /home/user/project"
                  className="input-field font-mono"
                />
              </div>

              {/* Environment Variables */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">
                    Environment Variables{" "}
                    <span className="text-gray-600">(optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={addEnvVar}
                    className="btn-ghost text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
                {envVars.length > 0 && (
                  <div className="space-y-2">
                    {envVars.map((envVar, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={envVar.key}
                          onChange={(e) => updateEnvVar(index, "key", e.target.value)}
                          placeholder="KEY"
                          className="input-field font-mono flex-1"
                        />
                        <span className="text-gray-600">=</span>
                        <input
                          type="text"
                          value={envVar.value}
                          onChange={(e) => updateEnvVar(index, "value", e.target.value)}
                          placeholder="value"
                          className="input-field font-mono flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeEnvVar(index)}
                          className="btn-icon text-red-400 hover:text-red-300"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {envVars.length === 0 && (
                  <p className="text-xs text-gray-600 italic">
                    No environment variables configured.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ─── Remote Server Fields ───────────────────────────────────────── */}
          {serverType === "remote" && (
            <>
              {/* Transport Type */}
              <div>
                <label className="label">Transport Protocol</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRemoteTransport("sse")}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      remoteTransport === "sse"
                        ? "border-gateway-500 bg-gateway-500/10 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    SSE (Server-Sent Events)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoteTransport("streamable-http")}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      remoteTransport === "streamable-http"
                        ? "border-gateway-500 bg-gateway-500/10 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    Streamable HTTP
                  </button>
                </div>
              </div>

              {/* URL */}
              <div>
                <label htmlFor="url" className="label">
                  Server URL
                </label>
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    remoteTransport === "sse"
                      ? "https://mcp-server.example.com/sse"
                      : "https://mcp.atlassian.com/v1/mcp"
                  }
                  className="input-field font-mono"
                  required
                />
              </div>

              {/* Custom Headers */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">
                    Custom Headers <span className="text-gray-600">(optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={addHeader}
                    className="btn-ghost text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
                {headers.length > 0 && (
                  <div className="space-y-2">
                    {headers.map((header, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={header.key}
                          onChange={(e) => updateHeader(index, "key", e.target.value)}
                          placeholder="Header-Name"
                          className="input-field font-mono flex-1"
                        />
                        <span className="text-gray-600">:</span>
                        <input
                          type="text"
                          value={header.value}
                          onChange={(e) => updateHeader(index, "value", e.target.value)}
                          placeholder="value"
                          className="input-field font-mono flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeHeader(index)}
                          className="btn-icon text-red-400 hover:text-red-300"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {headers.length === 0 && (
                  <p className="text-xs text-gray-600 italic">
                    No custom headers configured.
                  </p>
                )}
              </div>

              {/* ─── OAuth Configuration (auto-discovery) ──────────────────── */}
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOauthEnabled(!oauthEnabled)}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                    oauthEnabled
                      ? "bg-blue-900/20 border-blue-800"
                      : "bg-gray-800/30 hover:bg-gray-800/60"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                      oauthEnabled
                        ? "bg-gateway-500 border-gateway-500"
                        : "border-gray-600"
                    }`}
                  >
                    {oauthEnabled && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  <Shield className={`w-4 h-4 ${oauthEnabled ? "text-blue-400" : "text-gray-500"}`} />
                  <div className="text-left flex-1">
                    <div className={`text-sm font-medium ${oauthEnabled ? "text-white" : "text-gray-400"}`}>
                      OAuth Authentication
                    </div>
                    <div className="text-xs text-gray-500">
                      Enable if this server requires OAuth 2.0 for access
                    </div>
                  </div>
                </button>

                {oauthEnabled && (
                  <div className="p-4 space-y-4 border-t border-gray-800 bg-gray-900/30">
                    {/* Auto-discovery info box */}
                    <div className="text-xs text-gray-400 bg-blue-900/20 border border-blue-900/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                      <Shield className="w-3.5 h-3.5 mt-0.5 text-blue-400 flex-shrink-0" />
                      <div>
                        <span className="font-medium text-blue-300">Auto-discovery enabled.</span>{" "}
                        OAuth authorization server metadata is automatically discovered from the
                        server's{" "}
                        <code className="text-blue-300 bg-blue-900/30 px-1 rounded">
                          .well-known/oauth-authorization-server
                        </code>{" "}
                        endpoint. You only need to provide a Client ID if the server requires a
                        pre-registered application. Otherwise, dynamic client registration will be
                        attempted automatically.
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="oauth-client-id" className="label">
                          Client ID{" "}
                          <span className="text-gray-600">(optional)</span>
                        </label>
                        <input
                          id="oauth-client-id"
                          type="text"
                          value={oauthClientId}
                          onChange={(e) => setOauthClientId(e.target.value)}
                          placeholder="your-client-id"
                          className="input-field font-mono text-sm"
                        />
                        <p className="text-xs text-gray-600 mt-1">
                          Required for pre-registered OAuth apps. Leave blank for dynamic registration.
                        </p>
                      </div>
                      <div>
                        <label htmlFor="oauth-client-secret" className="label">
                          Client Secret{" "}
                          <span className="text-gray-600">(optional)</span>
                        </label>
                        <input
                          id="oauth-client-secret"
                          type="password"
                          value={oauthClientSecret}
                          onChange={(e) => setOauthClientSecret(e.target.value)}
                          placeholder="••••••••"
                          className="input-field font-mono text-sm"
                        />
                        <p className="text-xs text-gray-600 mt-1">
                          Only needed for confidential clients. Public clients can omit this.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="oauth-scopes" className="label">
                        Scopes <span className="text-gray-600">(optional)</span>
                      </label>
                      <input
                        id="oauth-scopes"
                        type="text"
                        value={oauthScopes}
                        onChange={(e) => setOauthScopes(e.target.value)}
                        placeholder="read write offline_access (space or comma separated)"
                        className="input-field font-mono text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        If omitted, the server's default scopes will be used.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                enabled ? "bg-gateway-500" : "bg-gray-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <label className="text-sm text-gray-300 cursor-pointer" onClick={() => setEnabled(!enabled)}>
              {enabled ? "Connect immediately after adding" : "Add without connecting"}
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {submitting ? "Adding..." : "Add Server"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}