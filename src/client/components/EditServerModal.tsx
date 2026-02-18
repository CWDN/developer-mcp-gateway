import React, { useState } from "react";
import { updateServer, type ServerEntry, type UpdateServerPayload, type AuthConfig, type AuthMode } from "../api";
import { X, Save, Minus, Plus, Shield, Loader2, AlertCircle, Key, Lock } from "lucide-react";

interface EditServerModalProps {
  server: ServerEntry;
  onClose: () => void;
  onUpdated: () => void;
}

interface EnvVar {
  key: string;
  value: string;
}

interface HeaderEntry {
  key: string;
  value: string;
}

export default function EditServerModal({ server, onClose, onUpdated }: EditServerModalProps) {
  const isLocal = server.transport === "stdio";
  const isRemote = !isLocal;

  // General
  const [name, setName] = useState(server.name);
  const [enabled, setEnabled] = useState(server.enabled);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local (stdio)
  const [command, setCommand] = useState(server.command ?? "");
  const [args, setArgs] = useState(server.args?.join(" ") ?? "");
  const [cwd, setCwd] = useState(server.cwd ?? "");
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    if (server.env) {
      return Object.entries(server.env).map(([key, value]) => ({ key, value }));
    }
    return [];
  });

  // Remote (sse / streamable-http)
  const [url, setUrl] = useState(server.url ?? "");
  const [headers, setHeaders] = useState<HeaderEntry[]>(() => {
    if (server.headers) {
      return Object.entries(server.headers).map(([key, value]) => ({ key, value }));
    }
    return [];
  });

  // Authentication configuration
  // Determine initial auth mode from server config (new auth field takes precedence over legacy oauth)
  const getInitialAuthMode = (): AuthMode => {
    if (server.authConfig) {
      return server.authConfig.mode;
    }
    if (server.oauth?.enabled) {
      return "oauth";
    }
    return "none";
  };
  
  const [authMode, setAuthMode] = useState<AuthMode>(getInitialAuthMode());
  
  // OAuth fields
  const [oauthClientId, setOauthClientId] = useState(() => {
    if (server.authConfig?.mode === "oauth") {
      return server.authConfig.clientId ?? "";
    }
    return server.oauth?.clientId ?? "";
  });
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScopes, setOauthScopes] = useState(() => {
    if (server.authConfig?.mode === "oauth") {
      return server.authConfig.scopes?.join(", ") ?? "";
    }
    return server.oauth?.scopes?.join(", ") ?? "";
  });
  
  // Bearer token fields
  const [bearerToken, setBearerToken] = useState(() => {
    if (server.authConfig?.mode === "bearer") {
      return server.authConfig.token;
    }
    return "";
  });
  
  // API key fields
  const [apiKey, setApiKey] = useState(() => {
    if (server.authConfig?.mode === "api-key") {
      return server.authConfig.key;
    }
    return "";
  });
  const [apiKeyHeaderName, setApiKeyHeaderName] = useState(() => {
    if (server.authConfig?.mode === "api-key") {
      return server.authConfig.headerName ?? "X-API-Key";
    }
    return "X-API-Key";
  });
  const [apiKeyHeaderPrefix, setApiKeyHeaderPrefix] = useState(() => {
    if (server.authConfig?.mode === "api-key") {
      return server.authConfig.headerPrefix ?? "";
    }
    return "";
  });
  
  // Custom auth headers
  const [customAuthHeaders, setCustomAuthHeaders] = useState<HeaderEntry[]>(() => {
    if (server.authConfig?.mode === "custom") {
      return Object.entries(server.authConfig.headers).map(([key, value]) => ({ key, value }));
    }
    return [];
  });
  
  // ─── Custom auth header management ────────────────────────────────────────
  
  const addCustomAuthHeader = () => setCustomAuthHeaders([...customAuthHeaders, { key: "", value: "" }]);
  const removeCustomAuthHeader = (index: number) =>
    setCustomAuthHeaders(customAuthHeaders.filter((_, i) => i !== index));
  const updateCustomAuthHeader = (index: number, field: "key" | "value", val: string) =>
    setCustomAuthHeaders(customAuthHeaders.map((h, i) => (i === index ? { ...h, [field]: val } : h)));

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

    const payload: UpdateServerPayload = {};

    // Name (only send if changed)
    if (name.trim() !== server.name) {
      payload.name = name.trim();
    }

    // Enabled (only send if changed)
    if (enabled !== server.enabled) {
      payload.enabled = enabled;
    }

    if (isLocal) {
      if (!command.trim()) {
        setError("Command is required for local servers.");
        return;
      }

      payload.command = command.trim();

      const parsedArgs = args
        .split(/\s+/)
        .map((a) => a.trim())
        .filter(Boolean);
      payload.args = parsedArgs;

      payload.cwd = cwd.trim() || undefined;

      const env: Record<string, string> = {};
      for (const { key, value } of envVars) {
        if (key.trim()) {
          env[key.trim()] = value;
        }
      }
      payload.env = Object.keys(env).length > 0 ? env : undefined;
    }

    if (isRemote) {
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

      payload.url = url.trim();

      const hdrs: Record<string, string> = {};
      for (const { key, value } of headers) {
        if (key.trim()) {
          hdrs[key.trim()] = value;
        }
      }
      payload.headers = Object.keys(hdrs).length > 0 ? hdrs : undefined;

      // Build the auth configuration based on the selected mode
      const previousAuthMode = getInitialAuthMode();
      
      switch (authMode) {
        case "none":
          // If previously had auth, explicitly set to null to remove
          if (previousAuthMode !== "none") {
            payload.auth = null;
          }
          break;
        
        case "oauth": {
          const scopes = oauthScopes
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          payload.auth = {
            mode: "oauth",
            clientId: oauthClientId.trim() || undefined,
            clientSecret: oauthClientSecret.trim() || 
              (server.authConfig?.mode === "oauth" ? server.authConfig.clientSecret : server.oauth?.clientSecret) || 
              undefined,
            scopes: scopes.length > 0 ? scopes : undefined,
          };
          break;
        }
        
        case "bearer":
          if (!bearerToken.trim()) {
            // If no new token provided but previously had bearer auth, keep the old token
            if (server.authConfig?.mode === "bearer" && server.authConfig.token) {
              payload.auth = {
                mode: "bearer",
                token: server.authConfig.token,
              };
            } else {
              setError("Bearer token is required.");
              return;
            }
          } else {
            payload.auth = {
              mode: "bearer",
              token: bearerToken.trim(),
            };
          }
          break;
        
        case "api-key":
          if (!apiKey.trim()) {
            // If no new key provided but previously had api-key auth, keep the old key
            if (server.authConfig?.mode === "api-key" && server.authConfig.key) {
              payload.auth = {
                mode: "api-key",
                key: server.authConfig.key,
                headerName: apiKeyHeaderName.trim() || "X-API-Key",
                headerPrefix: apiKeyHeaderPrefix.trim() || undefined,
              };
            } else {
              setError("API key is required.");
              return;
            }
          } else {
            payload.auth = {
              mode: "api-key",
              key: apiKey.trim(),
              headerName: apiKeyHeaderName.trim() || "X-API-Key",
              headerPrefix: apiKeyHeaderPrefix.trim() || undefined,
            };
          }
          break;
        
        case "custom": {
          const customHdrs: Record<string, string> = {};
          for (const { key, value } of customAuthHeaders) {
            if (key.trim()) {
              customHdrs[key.trim()] = value;
            }
          }
          if (Object.keys(customHdrs).length === 0) {
            setError("At least one custom auth header is required.");
            return;
          }
          payload.auth = {
            mode: "custom",
            headers: customHdrs,
          };
          break;
        }
      }
    }

    setSubmitting(true);
    try {
      await updateServer(server.id, payload);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update server.");
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

  // ─── Transport label ──────────────────────────────────────────────────────

  const transportLabel =
    server.transport === "stdio"
      ? "Local (stdio)"
      : server.transport === "sse"
        ? "Remote (SSE)"
        : "Remote (Streamable HTTP)";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-white">Edit Server</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {transportLabel} — <span className="font-mono">{server.id.slice(0, 8)}...</span>
            </p>
          </div>
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

          {/* Transport badge (read-only) */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Transport:</span>
            <span className="badge-blue">{transportLabel}</span>
            <span className="text-xs text-gray-600 italic">(cannot be changed)</span>
          </div>

          {/* Server Name */}
          <div>
            <label htmlFor="edit-server-name" className="label">
              Server Name
            </label>
            <input
              id="edit-server-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My MCP Server"
              className="input-field"
              required
            />
          </div>

          {/* ─── Local Server Fields ────────────────────────────────────────── */}
          {isLocal && (
            <>
              <div>
                <label htmlFor="edit-command" className="label">
                  Command
                </label>
                <input
                  id="edit-command"
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
                <label htmlFor="edit-args" className="label">
                  Arguments
                </label>
                <input
                  id="edit-args"
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
                <label htmlFor="edit-cwd" className="label">
                  Working Directory <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  id="edit-cwd"
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
          {isRemote && (
            <>
              {/* URL */}
              <div>
                <label htmlFor="edit-url" className="label">
                  Server URL
                </label>
                <input
                  id="edit-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    server.transport === "sse"
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

              {/* ─── Authentication Configuration ──────────────────────────── */}
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-gray-800/30 border-b border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-white">Authentication</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Choose how to authenticate with this MCP server
                  </p>
                </div>
                
                {/* Auth Mode Selector */}
                <div className="p-4 space-y-4 bg-gray-900/30">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      { mode: "none" as AuthMode, label: "None", icon: null },
                      { mode: "oauth" as AuthMode, label: "OAuth", icon: Shield },
                      { mode: "bearer" as AuthMode, label: "Bearer", icon: Key },
                      { mode: "api-key" as AuthMode, label: "API Key", icon: Key },
                      { mode: "custom" as AuthMode, label: "Custom", icon: Lock },
                    ].map(({ mode, label, icon: Icon }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAuthMode(mode)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          authMode === mode
                            ? "border-gateway-500 bg-gateway-500/10 text-white"
                            : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                        }`}
                      >
                        {Icon && <Icon className="w-3 h-3" />}
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* ─── OAuth Fields ─────────────────────────────────────── */}
                  {authMode === "oauth" && (
                    <div className="space-y-4 pt-2">
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
                          pre-registered application.
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="edit-oauth-client-id" className="label">
                            Client ID{" "}
                            <span className="text-gray-600">(optional)</span>
                          </label>
                          <input
                            id="edit-oauth-client-id"
                            type="text"
                            value={oauthClientId}
                            onChange={(e) => setOauthClientId(e.target.value)}
                            placeholder="your-client-id"
                            className="input-field font-mono text-sm"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Leave blank for dynamic registration.
                          </p>
                        </div>
                        <div>
                          <label htmlFor="edit-oauth-client-secret" className="label">
                            Client Secret{" "}
                            <span className="text-gray-600">(optional)</span>
                          </label>
                          <input
                            id="edit-oauth-client-secret"
                            type="password"
                            value={oauthClientSecret}
                            onChange={(e) => setOauthClientSecret(e.target.value)}
                            placeholder="••••••••"
                            className="input-field font-mono text-sm"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Only needed for confidential clients.
                          </p>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="edit-oauth-scopes" className="label">
                          Scopes <span className="text-gray-600">(optional)</span>
                        </label>
                        <input
                          id="edit-oauth-scopes"
                          type="text"
                          value={oauthScopes}
                          onChange={(e) => setOauthScopes(e.target.value)}
                          placeholder="read write offline_access (space or comma separated)"
                          className="input-field font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {/* ─── Bearer Token Fields ─────────────────────────────── */}
                  {authMode === "bearer" && (
                    <div className="space-y-4 pt-2">
                      <div className="text-xs text-gray-400 bg-amber-900/20 border border-amber-900/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                        <Key className="w-3.5 h-3.5 mt-0.5 text-amber-400 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-amber-300">Static bearer token.</span>{" "}
                          Use this for APIs that require a pre-authenticated token (e.g., GitHub Copilot MCP).
                          The token will be sent as <code className="text-amber-300 bg-amber-900/30 px-1 rounded">Authorization: Bearer &lt;token&gt;</code>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="edit-bearer-token" className="label">
                          Bearer Token
                          {server.authConfig?.mode === "bearer" && (
                            <span className="text-gray-600"> (leave blank to keep current)</span>
                          )}
                        </label>
                        <input
                          id="edit-bearer-token"
                          type="password"
                          value={bearerToken}
                          onChange={(e) => setBearerToken(e.target.value)}
                          placeholder={server.authConfig?.mode === "bearer" ? "••••••••" : "your-access-token"}
                          className="input-field font-mono text-sm"
                        />
                        <p className="text-xs text-gray-600 mt-1">
                          The access token to include in the Authorization header.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ─── API Key Fields ─────────────────────────────────── */}
                  {authMode === "api-key" && (
                    <div className="space-y-4 pt-2">
                      <div className="text-xs text-gray-400 bg-purple-900/20 border border-purple-900/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                        <Key className="w-3.5 h-3.5 mt-0.5 text-purple-400 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-purple-300">API key authentication.</span>{" "}
                          The key will be sent in a custom header (default: <code className="text-purple-300 bg-purple-900/30 px-1 rounded">X-API-Key</code>).
                        </div>
                      </div>

                      <div>
                        <label htmlFor="edit-api-key" className="label">
                          API Key
                          {server.authConfig?.mode === "api-key" && (
                            <span className="text-gray-600"> (leave blank to keep current)</span>
                          )}
                        </label>
                        <input
                          id="edit-api-key"
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={server.authConfig?.mode === "api-key" ? "••••••••" : "your-api-key"}
                          className="input-field font-mono text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="edit-api-key-header" className="label">
                            Header Name{" "}
                            <span className="text-gray-600">(optional)</span>
                          </label>
                          <input
                            id="edit-api-key-header"
                            type="text"
                            value={apiKeyHeaderName}
                            onChange={(e) => setApiKeyHeaderName(e.target.value)}
                            placeholder="X-API-Key"
                            className="input-field font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="edit-api-key-prefix" className="label">
                            Value Prefix{" "}
                            <span className="text-gray-600">(optional)</span>
                          </label>
                          <input
                            id="edit-api-key-prefix"
                            type="text"
                            value={apiKeyHeaderPrefix}
                            onChange={(e) => setApiKeyHeaderPrefix(e.target.value)}
                            placeholder="e.g., ApiKey (leave blank for none)"
                            className="input-field font-mono text-sm"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Prefix added before the key (e.g., "ApiKey " → "ApiKey your-key")
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ─── Custom Auth Headers ─────────────────────────────── */}
                  {authMode === "custom" && (
                    <div className="space-y-4 pt-2">
                      <div className="text-xs text-gray-400 bg-green-900/20 border border-green-900/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                        <Lock className="w-3.5 h-3.5 mt-0.5 text-green-400 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-green-300">Custom authentication headers.</span>{" "}
                          Define arbitrary headers for authentication. These will be sent with every request.
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="label mb-0">Authentication Headers</label>
                          <button
                            type="button"
                            onClick={addCustomAuthHeader}
                            className="btn-ghost text-xs flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" />
                            Add Header
                          </button>
                        </div>
                        {customAuthHeaders.length > 0 ? (
                          <div className="space-y-2">
                            {customAuthHeaders.map((header, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={header.key}
                                  onChange={(e) => updateCustomAuthHeader(index, "key", e.target.value)}
                                  placeholder="Header-Name"
                                  className="input-field font-mono flex-1 text-sm"
                                />
                                <span className="text-gray-600">:</span>
                                <input
                                  type="password"
                                  value={header.value}
                                  onChange={(e) => updateCustomAuthHeader(index, "value", e.target.value)}
                                  placeholder="value"
                                  className="input-field font-mono flex-1 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeCustomAuthHeader(index)}
                                  className="btn-icon text-red-400 hover:text-red-300"
                                >
                                  <Minus className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600 italic">
                            No custom auth headers configured. Click "Add Header" to add one.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ─── No Auth Info ────────────────────────────────────── */}
                  {authMode === "none" && (
                    <div className="text-xs text-gray-500 italic pt-2">
                      No authentication will be used. The server will be accessed without credentials.
                    </div>
                  )}
                </div>
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
            <label
              className="text-sm text-gray-300 cursor-pointer"
              onClick={() => setEnabled(!enabled)}
            >
              {enabled ? "Server enabled" : "Server disabled"}
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
                <Save className="w-4 h-4" />
              )}
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}