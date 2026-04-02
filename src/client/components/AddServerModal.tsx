import React, { useState } from "react";
import { createServer, discoverCliTools, type CreateServerPayload, type AuthConfig, type AuthMode, type CliToolDefinition } from "../api";
import { X, Terminal, Globe, Plus, Minus, Shield, Loader2, AlertCircle, Key, Lock, Store, Wrench, Search } from "lucide-react";
import RegistryBrowser from "./RegistryBrowser";
import {
  type RegistryServer,
  getServerDisplayName,
  getServerTransportType,
} from "../registry";

type ServerType = "local" | "remote" | "registry" | "cli";
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
  const [serverType, setServerType] = useState<ServerType>("registry");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local (stdio)
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // CLI Tool state
  const [cliTools, setCliTools] = useState<Array<{
    name: string;
    description: string;
    args: string;
    timeoutMs: string;
  }>>([]);
  const [cliTimeoutMs, setCliTimeoutMs] = useState("");
  const [cliGlobalArgs, setCliGlobalArgs] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryDone, setDiscoveryDone] = useState(false);

  const handleDiscover = async () => {
    if (!command.trim()) {
      setError("Enter a command before discovering tools.");
      return;
    }
    setError(null);
    setDiscovering(true);
    try {
      const result = await discoverCliTools(
        command.trim(),
        cwd.trim() || undefined
      );
      setCliTools(
        result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          args: t.args.join(" "),
          timeoutMs: "",
        }))
      );
      setCliGlobalArgs(result.globalArgs);
      setDiscoveryDone(true);
      if (!name.trim() && result.description) {
        // Auto-fill the server name from the CLI description (first line)
        const firstLine = result.description.split("\n")[0].trim();
        if (firstLine.length < 60) {
          setName(command.trim().split("/").pop() ?? command.trim());
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  };

  // Remote (sse / streamable-http)
  const [remoteTransport, setRemoteTransport] = useState<RemoteTransport>("sse");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderEntry[]>([]);

  // Authentication configuration
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  
  // OAuth fields
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScopes, setOauthScopes] = useState("");
  
  // Bearer token fields
  const [bearerToken, setBearerToken] = useState("");
  
  // API key fields
  const [apiKey, setApiKey] = useState("");
  const [apiKeyHeaderName, setApiKeyHeaderName] = useState("X-API-Key");
  const [apiKeyHeaderPrefix, setApiKeyHeaderPrefix] = useState("");
  
  // Custom auth headers
  const [customAuthHeaders, setCustomAuthHeaders] = useState<HeaderEntry[]>([]);
  
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

  // ─── Apply preset ──────────────────────────────────────────────────────────

  const applyRegistryServer = (server: RegistryServer) => {
    const displayName = getServerDisplayName(server);
    const transportType = getServerTransportType(server);
    setName(displayName);
    setError(null);

    if (transportType === "stdio" && server.packages && server.packages.length > 0) {
      const pkg = server.packages.find((p) => p.transport?.type === "stdio") || server.packages[0];
      setServerType("local");
      setCommand("npx");
      setArgs(`-y ${pkg.identifier}`);
      setCwd("");
      if (pkg.environmentVariables && pkg.environmentVariables.length > 0) {
        setEnvVars(
          pkg.environmentVariables.map((v) => ({ key: v.name, value: "" }))
        );
      } else {
        setEnvVars([]);
      }
    } else if (server.remotes && server.remotes.length > 0) {
      const remote = server.remotes[0];
      setServerType("remote");
      setRemoteTransport(remote.type === "sse" ? "sse" : "streamable-http");
      setUrl(remote.url);
      setHeaders([]);

      // Detect auth requirements from headers
      const authHeader = remote.headers?.find(
        (h) => h.name.toLowerCase() === "authorization",
      );
      if (authHeader) {
        setAuthMode("bearer");
        setBearerToken("");
      } else {
        setAuthMode("none");
      }
      setOauthScopes("");
      setOauthClientId("");
      setOauthClientSecret("");
      setApiKey("");
      setCustomAuthHeaders([]);
    } else {
      // Fallback: use the first package as local stdio if available
      if (server.packages && server.packages.length > 0) {
        const pkg = server.packages[0];
        setServerType("local");
        setCommand("npx");
        setArgs(`-y ${pkg.identifier}`);
        setCwd("");
        if (pkg.environmentVariables && pkg.environmentVariables.length > 0) {
          setEnvVars(
            pkg.environmentVariables.map((v) => ({ key: v.name, value: "" }))
          );
        } else {
          setEnvVars([]);
        }
      } else {
        // No transport info — default to remote with empty URL
        setServerType("remote");
        setRemoteTransport("streamable-http");
        setUrl("");
        setHeaders([]);
        setAuthMode("none");
      }
    }
  };

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
    } else if (serverType === "cli") {
      if (!command.trim()) {
        setError("Command is required.");
        return;
      }

      const validTools = cliTools.filter((t) => t.name.trim() && t.description.trim());

      const toolDefs: CliToolDefinition[] = validTools.map((t) => ({
        name: t.name.trim(),
        description: t.description.trim(),
        args: t.args.trim().split(/\s+/).filter(Boolean),
        ...(t.timeoutMs ? { timeoutMs: parseInt(t.timeoutMs, 10) } : {}),
      }));

      const env: Record<string, string> = {};
      for (const v of envVars) {
        if (v.key.trim()) env[v.key.trim()] = v.value;
      }

      payload = {
        name: name.trim() || command.trim().split("/").pop() || command.trim(),
        transport: "cli" as const,
        command: command.trim(),
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
        ...(cliGlobalArgs.length > 0 ? { globalArgs: cliGlobalArgs } : {}),
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(cliTimeoutMs ? { timeoutMs: parseInt(cliTimeoutMs, 10) } : {}),
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

      // Build the auth configuration based on the selected mode
      let auth: AuthConfig | undefined;
      
      switch (authMode) {
        case "none":
          // No auth config needed
          break;
        
        case "oauth": {
          const scopes = oauthScopes
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          auth = {
            mode: "oauth",
            clientId: oauthClientId.trim() || undefined,
            clientSecret: oauthClientSecret.trim() || undefined,
            scopes: scopes.length > 0 ? scopes : undefined,
          };
          break;
        }
        
        case "bearer":
          if (!bearerToken.trim()) {
            setError("Bearer token is required.");
            return;
          }
          auth = {
            mode: "bearer",
            token: bearerToken.trim(),
          };
          break;
        
        case "api-key":
          if (!apiKey.trim()) {
            setError("API key is required.");
            return;
          }
          auth = {
            mode: "api-key",
            key: apiKey.trim(),
            headerName: apiKeyHeaderName.trim() || "X-API-Key",
            headerPrefix: apiKeyHeaderPrefix.trim() || undefined,
          };
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
          auth = {
            mode: "custom",
            headers: customHdrs,
          };
          break;
        }
      }

      payload = {
        name: name.trim(),
        transport: remoteTransport,
        url: url.trim(),
        headers: Object.keys(hdrs).length > 0 ? hdrs : undefined,
        auth,
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
              onClick={() => setServerType("registry")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-150 ${
                serverType === "registry"
                  ? "border-gateway-500 bg-gateway-500/10 text-white"
                  : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
              }`}
            >
              <Store className="w-5 h-5" />
              <div className="text-left">
                <div className="text-sm font-medium">Registry</div>
                <div className="text-xs opacity-60">MCP Registry</div>
              </div>
            </button>
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
              onClick={() => setServerType("cli")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-150 ${
                serverType === "cli"
                  ? "border-gateway-500 bg-gateway-500/10 text-white"
                  : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
              }`}
            >
              <Wrench className="w-5 h-5" />
              <div className="text-left">
                <div className="text-sm font-medium">CLI Tool</div>
                <div className="text-xs opacity-60">cli transport</div>
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

          {/* ─── Template Selector ──────────────────────────────────────────── */}
          {serverType === "registry" && (
            <RegistryBrowser onSelect={applyRegistryServer} />
          )}

          {/* ─── CLI Tool Fields ─────────────────────────────────────────── */}
          {serverType === "cli" && (
            <div className="space-y-4">
              {/* Command + Discover */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Command <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => {
                      setCommand(e.target.value);
                      setDiscoveryDone(false);
                    }}
                    placeholder="e.g., cymbal"
                    className="input-field flex-1"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleDiscover}
                    disabled={discovering || !command.trim()}
                    className="btn-primary flex items-center gap-1.5 px-3 whitespace-nowrap"
                  >
                    {discovering ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    {discovering ? "Discovering…" : "Discover Tools"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Enter the CLI binary name or path, then click Discover to auto-detect tools from <code>--help</code>
                </p>
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
                  placeholder={command.trim() ? command.trim().split("/").pop() : "e.g., My CLI Tool"}
                  className="input-field"
                />
              </div>

              {/* Working Directory */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Working Directory
                </label>
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="e.g., ~/projects/my-repo"
                  className="input-field"
                />
              </div>

              {/* Global Args */}
              {cliGlobalArgs.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Global Flags
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {cliGlobalArgs.map((arg) => (
                      <span
                        key={arg}
                        className="badge-green font-mono text-xs"
                      >
                        {arg}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Appended to every tool invocation automatically
                  </p>
                </div>
              )}

              {/* Default Timeout */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Default Timeout (ms)
                </label>
                <input
                  type="number"
                  value={cliTimeoutMs}
                  onChange={(e) => setCliTimeoutMs(e.target.value)}
                  placeholder="30000"
                  className="input-field"
                />
              </div>

              {/* Environment Variables — reuse existing envVars UI */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-300">
                    Environment Variables
                  </label>
                  <button
                    type="button"
                    onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
                    className="btn-ghost text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                {envVars.length > 0 && (
                  <div className="space-y-2">
                    {envVars.map((env, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={env.key}
                          onChange={(e) => updateEnvVar(i, "key", e.target.value)}
                          placeholder="KEY"
                          className="input-field font-mono flex-1"
                        />
                        <span className="text-gray-600">=</span>
                        <input
                          type="text"
                          value={env.value}
                          onChange={(e) => updateEnvVar(i, "value", e.target.value)}
                          placeholder="value"
                          className="input-field font-mono flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeEnvVar(i)}
                          className="btn-icon text-red-400 hover:text-red-300"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tool Definitions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-300">
                    Tools
                    {cliTools.length > 0 && (
                      <span className="text-xs text-gray-500 font-normal ml-1.5">
                        ({cliTools.length} {discoveryDone ? "discovered" : "defined"})
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setCliTools([
                        ...cliTools,
                        { name: "", description: "", args: "", timeoutMs: "" },
                      ])
                    }
                    className="btn-ghost text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Tool
                  </button>
                </div>
                {cliTools.length === 0 && !discoveryDone && (
                  <div className="text-center py-6 text-gray-500 bg-white/5 border border-white/10 border-dashed rounded-lg">
                    <Wrench className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No tools defined yet</p>
                    <p className="text-xs mt-1">
                      Click <strong>Discover Tools</strong> above to auto-detect, or add manually
                    </p>
                  </div>
                )}
                {cliTools.length === 0 && discoveryDone && (
                  <div className="text-center py-6 text-yellow-500/80 bg-yellow-900/10 border border-yellow-900/20 border-dashed rounded-lg">
                    <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No tools discovered</p>
                    <p className="text-xs mt-1 text-gray-500">
                      The CLI may not have subcommands, or uses a non-standard help format.
                      <br />Tools will be auto-discovered when the server connects.
                    </p>
                  </div>
                )}
                <div className="space-y-3">
                  {cliTools.map((tool, i) => (
                    <div
                      key={i}
                      className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">
                          Tool {i + 1}
                        </span>
                        {cliTools.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setCliTools(cliTools.filter((_, j) => j !== i))
                            }
                            className="btn-icon text-red-400 hover:text-red-300"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={tool.name}
                        onChange={(e) => {
                          const updated = [...cliTools];
                          updated[i] = { ...updated[i], name: e.target.value };
                          setCliTools(updated);
                        }}
                        placeholder="Tool name (e.g., search)"
                        className="input-field"
                      />
                      <input
                        type="text"
                        value={tool.description}
                        onChange={(e) => {
                          const updated = [...cliTools];
                          updated[i] = { ...updated[i], description: e.target.value };
                          setCliTools(updated);
                        }}
                        placeholder="Description (e.g., Search for symbols in the codebase)"
                        className="input-field"
                      />
                      <input
                        type="text"
                        value={tool.args}
                        onChange={(e) => {
                          const updated = [...cliTools];
                          updated[i] = { ...updated[i], args: e.target.value };
                          setCliTools(updated);
                        }}
                        placeholder="Args template (e.g., search {{query}} --json)"
                        className="input-field"
                      />
                      <p className="text-xs text-gray-500">
                        Use {"{{paramName}}"} for parameter placeholders. Space-separated.
                      </p>
                      <input
                        type="number"
                        value={tool.timeoutMs}
                        onChange={(e) => {
                          const updated = [...cliTools];
                          updated[i] = { ...updated[i], timeoutMs: e.target.value };
                          setCliTools(updated);
                        }}
                        placeholder="Timeout override (ms, optional)"
                        className="input-field"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cli-enabled"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-gateway-500 focus:ring-gateway-500"
                />
                <label htmlFor="cli-enabled" className="text-sm text-gray-300">
                  Enable server after creation
                </label>
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="btn-ghost">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex items-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Add Server
                </button>
              </div>
            </div>
          )}

          {serverType !== "registry" && serverType !== "cli" && (<>
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
                            Leave blank for dynamic registration.
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
                            Only needed for confidential clients.
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
                        <label htmlFor="bearer-token" className="label">
                          Bearer Token
                        </label>
                        <input
                          id="bearer-token"
                          type="password"
                          value={bearerToken}
                          onChange={(e) => setBearerToken(e.target.value)}
                          placeholder="your-access-token"
                          className="input-field font-mono text-sm"
                          required={authMode === "bearer"}
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
                        <label htmlFor="api-key" className="label">
                          API Key
                        </label>
                        <input
                          id="api-key"
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="your-api-key"
                          className="input-field font-mono text-sm"
                          required={authMode === "api-key"}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="api-key-header" className="label">
                            Header Name{" "}
                            <span className="text-gray-600">(optional)</span>
                          </label>
                          <input
                            id="api-key-header"
                            type="text"
                            value={apiKeyHeaderName}
                            onChange={(e) => setApiKeyHeaderName(e.target.value)}
                            placeholder="X-API-Key"
                            className="input-field font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="api-key-prefix" className="label">
                            Value Prefix{" "}
                            <span className="text-gray-600">(optional)</span>
                          </label>
                          <input
                            id="api-key-prefix"
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

          </>)}

          {/* Enabled toggle */}
          {serverType !== "registry" && (
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
          )}

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
            {serverType !== "registry" && (
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
            )}
          </div>
        </form>
      </div>
    </div>
  );
}