import React, { useState, useRef, useEffect } from "react";
import {
  exportServers,
  importServers,
  type ServerEntry,
  type ExportResult,
  type SharedServerConfig,
  type ConnectionStatus,
  type ImportMode,
} from "../api";
import {
  Share2,
  Download,
  Upload,
  Copy,
  Check,
  X,
  FileJson,
  AlertTriangle,
  Loader2,
  AlertCircle,
  Terminal,
  Globe,
  Trash2,
  RefreshCw,
  SkipForward,
  Layers,
  ShieldAlert,
} from "lucide-react";

// --- Props ------------------------------------------------------------------

interface ShareServersModalProps {
  servers: ServerEntry[];
  onClose: () => void;
  onImported: () => void;
  initialTab?: "export" | "import";
  preselectedServerIds?: string[];
}

// --- Helpers ----------------------------------------------------------------

function getTransportBadge(transport: string): {
  label: string;
  className: string;
} {
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

function getStatusDotClass(status: ConnectionStatus): string {
  return `status-dot status-dot-${status}`;
}

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const REPLACE_ME_PATTERN = /<REPLACE_ME:/;

function hasAuthPlaceholders(server: SharedServerConfig): boolean {
  if (!server.authConfig) return false;
  const auth = server.authConfig;
  switch (auth.mode) {
    case "bearer":
      return REPLACE_ME_PATTERN.test(auth.token ?? "");
    case "api-key":
      return REPLACE_ME_PATTERN.test(auth.key ?? "");
    case "custom":
      return Object.values(auth.headers ?? {}).some((v) => REPLACE_ME_PATTERN.test(v));
    default:
      return false;
  }
}

function hasEnvPlaceholders(server: SharedServerConfig): boolean {
  if (!server.env) return false;
  return Object.values(server.env).some((v) => REPLACE_ME_PATTERN.test(v));
}

function hasArgPlaceholders(server: SharedServerConfig): boolean {
  if (!server.args) return false;
  return server.args.some((a) => REPLACE_ME_PATTERN.test(a));
}

function hasHeaderPlaceholders(server: SharedServerConfig): boolean {
  if (!server.headers) return false;
  return Object.values(server.headers).some((v) => REPLACE_ME_PATTERN.test(v));
}

// --- Component --------------------------------------------------------------

export default function ShareServersModal({
  servers,
  onClose,
  onImported,
  initialTab = "export",
  preselectedServerIds,
}: ShareServersModalProps) {
  const [activeTab, setActiveTab] = useState<"export" | "import">(initialTab);

  // Export state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (preselectedServerIds && preselectedServerIds.length > 0) {
      return new Set(preselectedServerIds);
    }
    return new Set<string>();
  });
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);

  // Import state
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExportResult | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // --- Export handlers ---

  const toggleServer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === servers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(servers.map((s) => s.id)));
    }
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) return;
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      const result = await exportServers(
        Array.from(selectedIds),
        includeSecrets ? { includeSecrets: true } : undefined
      );
      setExportResult(JSON.stringify(result, null, 2));
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export servers"
      );
    } finally {
      setExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    if (!exportResult) return;
    try {
      await navigator.clipboard.writeText(exportResult);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = exportResult;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
    }
  };

  const handleDownload = () => {
    if (!exportResult) return;
    const blob = new Blob([exportResult], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mcp-servers-export-${formatDate()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Import handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setImportText(text);
        setPreview(null);
        setImportError(null);
        setImportSuccess(null);
      }
    };
    reader.onerror = () => {
      setImportError("Failed to read file");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handlePreview = () => {
    setImportError(null);
    setPreview(null);
    setPreviewWarnings([]);
    setImportSuccess(null);

    if (!importText.trim()) {
      setImportError("Please paste JSON or upload a file first.");
      return;
    }

    let parsed: ExportResult;
    try {
      parsed = JSON.parse(importText) as ExportResult;
    } catch {
      setImportError("Invalid JSON. Please check the format and try again.");
      return;
    }

    if (!parsed.metadata || !Array.isArray(parsed.servers)) {
      setImportError(
        "Invalid export format. Expected an object with ‘metadata’ and ‘servers’ fields."
      );
      return;
    }

    if (parsed.servers.length === 0) {
      setImportError("The export file contains no servers.");
      return;
    }

    const warnings: string[] = [];
    const existingNames = new Set(servers.map((s) => s.name.toLowerCase()));
    let conflictCount = 0;

    for (const srv of parsed.servers) {
      const placeholders: string[] = [];
      if (hasAuthPlaceholders(srv)) {
        placeholders.push(`auth (${srv.authConfig!.mode})`);
      }
      if (hasEnvPlaceholders(srv)) {
        placeholders.push("environment variables");
      }
      if (hasArgPlaceholders(srv)) {
        placeholders.push("command-line arguments");
      }
      if (hasHeaderPlaceholders(srv)) {
        placeholders.push("HTTP headers");
      }
      if (placeholders.length > 0) {
        warnings.push(
          `"${srv.name}" has <REPLACE_ME> placeholders in ${placeholders.join(", ")} — fill in the actual values after import.`
        );
      }
      if (existingNames.has(srv.name.toLowerCase())) {
        conflictCount++;
      }
    }

    if (conflictCount > 0) {
      const names = parsed.servers
        .filter((srv) => existingNames.has(srv.name.toLowerCase()))
        .map((srv) => `"${srv.name}"`)
        .join(", ");
      warnings.push(
        `${conflictCount} server${conflictCount !== 1 ? "s" : ""} already exist${conflictCount === 1 ? "s" : ""} (${names}). Use the import mode below to choose how to handle them.`
      );
    }

    setPreviewWarnings(warnings);
    setPreview(parsed);
  };

  const handleImport = async () => {
    if (!preview) return;

    if (importMode === "replace" && servers.length > 0) {
      if (
        !window.confirm(
          `This will remove all ${servers.length} existing server${servers.length !== 1 ? "s" : ""} before importing. Are you sure?`
        )
      ) {
        return;
      }
    }

    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const result = await importServers(preview, { mode: importMode });
      const importedCount = result.imported.length;
      const skippedCount = result.skipped.length;
      const parts: string[] = [];

      if (importedCount > 0) {
        parts.push(`${importedCount} server${importedCount !== 1 ? "s" : ""} imported`);
      }
      if (skippedCount > 0) {
        parts.push(`${skippedCount} skipped (${result.skipped.join(", ")})`);
      }
      if (importMode === "replace") {
        parts.unshift("Existing servers cleared");
      }

      setImportSuccess(parts.join(". ") + ".");
      setPreview(null);
      setImportText("");
      onImported();
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Failed to import servers"
      );
    } finally {
      setImporting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // --- Derived values ---

  const allSelected = servers.length > 0 && selectedIds.size === servers.length;
  const exportBtnLabel = exporting
    ? "Exporting..."
    : `Export ${selectedIds.size} Server${selectedIds.size !== 1 ? "s" : ""}`;
  const importBtnLabel = importing
    ? "Importing..."
    : preview
      ? importMode === "replace"
        ? `Replace All & Import ${preview.servers.length}`
        : `Import ${preview.servers.length} Server${preview.servers.length !== 1 ? "s" : ""}`
      : "Import";

  // --- Render ---

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div
        className="modal-content max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-gateway-400" />
            <h2 className="text-lg font-semibold text-white">
              Share Server Configurations
            </h2>
          </div>
          <button onClick={onClose} className="btn-icon">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-6 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab("export")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-150 ${
              activeTab === "export"
                ? "border-gateway-500 bg-gateway-500/10 text-white"
                : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
            }`}
          >
            <Upload className="w-5 h-5" />
            <div className="text-left">
              <div className="text-sm font-medium">Export</div>
              <div className="text-xs opacity-60">Share your servers</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-150 ${
              activeTab === "import"
                ? "border-gateway-500 bg-gateway-500/10 text-white"
                : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
            }`}
          >
            <Download className="w-5 h-5" />
            <div className="text-left">
              <div className="text-sm font-medium">Import</div>
              <div className="text-xs opacity-60">Load shared servers</div>
            </div>
          </button>
        </div>

        {/* Tab content */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-200px)]">
          {activeTab === "export" ? renderExportTab() : renderImportTab()}
        </div>
      </div>
    </div>
  );

  // --- Export tab ---

  function renderExportTab() {
    return (
      <>
        {exportError && (
          <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20 border border-red-900/30 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{exportError}</span>
          </div>
        )}

        {!exportResult ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">
                Select servers to export ({selectedIds.size} of {servers.length}{" "} selected)
              </p>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-gateway-400 hover:text-gateway-300 transition-colors"
              >
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {servers.map((server) => {
                const badge = getTransportBadge(server.transport);
                const isSelected = selectedIds.has(server.id);
                return (
                  <label
                    key={server.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "border-gateway-500 bg-gateway-500/10"
                        : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleServer(server.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-gateway-500 focus:ring-gateway-500 focus:ring-offset-0"
                    />
                    <span className={getStatusDotClass(server.runtime.status)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {server.name}
                      </div>
                    </div>
                    <span className={badge.className}>
                      {server.transport === "stdio" ? (
                        <Terminal className="w-3 h-3 mr-1 inline" />
                      ) : (
                        <Globe className="w-3 h-3 mr-1 inline" />
                      )}
                      {badge.label}
                    </span>
                  </label>
                );
              })}

              {servers.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">
                  No servers to export. Add a server first.
                </p>
              )}
            </div>

            {/* Include secrets toggle */}
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={includeSecrets}
                  onChange={(e) => setIncludeSecrets(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-gateway-500 focus:ring-gateway-500 focus:ring-offset-0"
                />
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                    Include secrets &amp; tokens
                  </span>
                </div>
              </label>
              {includeSecrets && (
                <div className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-900/30 rounded-lg px-4 py-3">
                  <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    The exported file will contain <strong>plaintext secrets</strong> (API keys, tokens, passwords).
                    Only share it through secure channels — never post it publicly.
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={selectedIds.size === 0 || exporting}
                className={`flex items-center gap-2 ${
                  includeSecrets
                    ? "bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors"
                    : "btn-primary"
                }`}
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : includeSecrets ? (
                  <ShieldAlert className="w-4 h-4" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
                {exportBtnLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={`flex items-center gap-2 text-sm rounded-lg px-4 py-3 ${
              includeSecrets
                ? "text-yellow-400 bg-yellow-900/20 border border-yellow-900/30"
                : "text-green-400 bg-green-900/20 border border-green-900/30"
            }`}>
              {includeSecrets ? (
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              ) : (
                <Check className="w-4 h-4 flex-shrink-0" />
              )}
              <span>
                {includeSecrets
                  ? "Export complete — contains secrets! Share only through secure channels."
                  : "Export complete! Copy or download the configuration below."}
              </span>
            </div>

            <textarea
              readOnly
              value={exportResult}
              className="input-field font-mono text-xs h-64 resize-none"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopyToClipboard}
                className="btn-primary flex items-center gap-2"
              >
                {copied ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="btn-secondary flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download as File
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setExportResult(null);
                  setExportError(null);
                }}
                className="btn-ghost text-sm"
              >
                Back
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  // --- Import tab ---

  const importModes: { value: ImportMode; label: string; description: string; icon: React.ReactNode; color: string }[] = [
    {
      value: "merge",
      label: "Merge",
      description: "Add all servers; rename duplicates with \"(imported)\" suffix",
      icon: <Layers className="w-4 h-4" />,
      color: "gateway",
    },
    {
      value: "overwrite",
      label: "Overwrite",
      description: "Update existing servers in-place when names match; add new ones",
      icon: <RefreshCw className="w-4 h-4" />,
      color: "yellow",
    },
    {
      value: "skip",
      label: "Skip Duplicates",
      description: "Add new servers only; skip any whose name already exists",
      icon: <SkipForward className="w-4 h-4" />,
      color: "blue",
    },
    {
      value: "replace",
      label: "Replace All",
      description: "Remove all existing servers first, then import",
      icon: <Trash2 className="w-4 h-4" />,
      color: "red",
    },
  ];

  function renderImportTab() {
    return (
      <>
        {importError && (
          <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20 border border-red-900/30 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{importError}</span>
          </div>
        )}

        {importSuccess && (
          <div className="flex items-start gap-2 text-sm text-green-400 bg-green-900/20 border border-green-900/30 rounded-lg px-4 py-3">
            <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{importSuccess}</span>
          </div>
        )}

        {!preview ? (
          <>
            <div>
              <label className="label">Paste exported JSON</label>
              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportError(null);
                  setImportSuccess(null);
                }}
                placeholder='{ "metadata": {...}, "servers": [...] }'
                className="input-field font-mono text-xs h-48 resize-none"
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1 border-t border-gray-700" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">or</span>
              <div className="flex-1 border-t border-gray-700" />
            </div>

            <div className="flex justify-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary flex items-center gap-2"
              >
                <FileJson className="w-4 h-4" />
                Choose File
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handlePreview}
                disabled={!importText.trim()}
                className="btn-primary flex items-center gap-2"
              >
                <FileJson className="w-4 h-4" />
                Preview
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-medium text-white mb-2">Import Preview</h3>
              <p className="text-xs text-gray-500 mb-3">
                {`Exported on ${new Date(preview.metadata.exportedAt).toLocaleDateString()} — ${preview.servers.length} server${preview.servers.length !== 1 ? "s" : ""}`}
              </p>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {preview.servers.map((srv, i) => {
                  const badge = getTransportBadge(srv.transport);
                  const existingNames = new Set(servers.map((s) => s.name.toLowerCase()));
                  const isConflict = existingNames.has(srv.name.toLowerCase());
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-700 bg-gray-800/50"
                    >
                      {srv.transport === "stdio" ? (
                        <Terminal className="w-4 h-4 text-gray-400" />
                      ) : (
                        <Globe className="w-4 h-4 text-gray-400" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">
                          {srv.name}
                        </div>
                        {isConflict && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {importMode === "merge" && "→ will be renamed"}
                            {importMode === "skip" && "→ will be skipped"}
                            {importMode === "overwrite" && "→ will update existing"}
                            {importMode === "replace" && "→ existing will be removed first"}
                          </div>
                        )}
                      </div>
                      <span className={badge.className}>{badge.label}</span>
                      {isConflict && importMode !== "replace" && (
                        <span className={
                          importMode === "skip"
                            ? "badge-gray"
                            : importMode === "overwrite"
                              ? "badge-yellow"
                              : "badge-blue"
                        }>
                          {importMode === "skip" ? "skip" : importMode === "overwrite" ? "update" : "rename"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Import mode picker */}
            <div>
              <h3 className="text-sm font-medium text-white mb-2">Import Mode</h3>
              <div className="grid grid-cols-2 gap-2">
                {importModes.map((m) => {
                  const isActive = importMode === m.value;
                  const borderColor = isActive
                    ? m.color === "red"
                      ? "border-red-500 bg-red-500/10"
                      : m.color === "yellow"
                        ? "border-yellow-500 bg-yellow-500/10"
                        : m.color === "blue"
                          ? "border-blue-500 bg-blue-500/10"
                          : "border-gateway-500 bg-gateway-500/10"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600";
                  const iconColor = isActive
                    ? m.color === "red"
                      ? "text-red-400"
                      : m.color === "yellow"
                        ? "text-yellow-400"
                        : m.color === "blue"
                          ? "text-blue-400"
                          : "text-gateway-400"
                    : "text-gray-500";
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setImportMode(m.value)}
                      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all duration-150 ${borderColor}`}
                    >
                      <span className={`mt-0.5 ${iconColor}`}>{m.icon}</span>
                      <div className="min-w-0">
                        <div className={`text-sm font-medium ${isActive ? "text-white" : "text-gray-300"}`}>
                          {m.label}
                        </div>
                        <div className="text-xs text-gray-500 leading-tight mt-0.5">
                          {m.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {importMode === "replace" && servers.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-red-400 bg-red-900/20 border border-red-900/30 rounded-lg px-4 py-3">
                <Trash2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  This will permanently remove {servers.length} existing server{servers.length !== 1 ? "s" : ""} and
                  all associated OAuth state before importing.
                </span>
              </div>
            )}

            {previewWarnings.length > 0 && (
              <div className="space-y-2">
                {previewWarnings.map((warning, i) => (
                  <div
                    key={`warn-${i}`}
                    className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-900/30 rounded-lg px-4 py-3"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setPreviewWarnings([]);
                }}
                className="btn-ghost text-sm"
              >
                Back
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className={`flex items-center gap-2 ${
                  importMode === "replace"
                    ? "bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors"
                    : "btn-primary"
                }`}
              >
                {importing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : importMode === "replace" ? (
                  <Trash2 className="w-4 h-4" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {importBtnLabel}
              </button>
            </div>
          </>
        )}
      </>
    );
  }
}
