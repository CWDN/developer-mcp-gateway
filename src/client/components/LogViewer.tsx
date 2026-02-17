import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getRequestLogs,
  clearRequestLogs,
  subscribeToEvents,
  type RequestLogEntry,
  type RequestLogFilter,
  type RequestType,
  type GatewayEventData,
} from "../api";
import {
  Activity,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
  Search,
  Filter,
  X,
  Wrench,
  BookOpen,
  MessageSquare,
} from "lucide-react";

// ─── Type Icons ────────────────────────────────────────────────────────────────

const TypeIcon: React.FC<{ type: RequestType; className?: string }> = ({
  type,
  className = "w-4 h-4",
}) => {
  switch (type) {
    case "tool":
      return <Wrench className={className} />;
    case "resource":
      return <BookOpen className={className} />;
    case "prompt":
      return <MessageSquare className={className} />;
  }
};

// ─── Status Badge ──────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: RequestLogEntry["status"] }> = ({
  status,
}) => {
  const config = {
    pending: {
      bg: "bg-yellow-900/30",
      text: "text-yellow-400",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    success: {
      bg: "bg-green-900/30",
      text: "text-green-400",
      icon: <CheckCircle className="w-3 h-3" />,
    },
    error: {
      bg: "bg-red-900/30",
      text: "text-red-400",
      icon: <AlertCircle className="w-3 h-3" />,
    },
  };

  const { bg, text, icon } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}
    >
      {icon}
      {status}
    </span>
  );
};

// ─── Duration Badge ────────────────────────────────────────────────────────────

const DurationBadge: React.FC<{ durationMs?: number }> = ({ durationMs }) => {
  if (durationMs === undefined) return null;

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const colorClass =
    durationMs < 500
      ? "text-green-400"
      : durationMs < 2000
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${colorClass}`}
      title={`${durationMs}ms`}
    >
      <Clock className="w-3 h-3" />
      {formatDuration(durationMs)}
    </span>
  );
};

// ─── Log Entry Row ─────────────────────────────────────────────────────────────

const LogEntryRow: React.FC<{
  entry: RequestLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ entry, isExpanded, onToggle }) => {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const typeColorClass = {
    tool: "text-blue-400",
    resource: "text-purple-400",
    prompt: "text-yellow-400",
  };

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      {/* Summary Row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <span className="text-gray-500">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>

        <span className="text-gray-500 text-xs font-mono w-20">
          {formatTime(entry.timestamp)}
        </span>

        <span className={`${typeColorClass[entry.type]}`}>
          <TypeIcon type={entry.type} />
        </span>

        <span className="flex-1 font-mono text-sm text-gray-200 truncate">
          {entry.method}
        </span>

        <span className="text-xs text-gray-500 truncate max-w-32">
          {entry.server.name}
        </span>

        <DurationBadge durationMs={entry.durationMs} />

        <StatusBadge status={entry.status} />
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 bg-gray-900/50 border-t border-gray-800">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Request */}
            <div>
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Request
              </h4>
              <pre className="bg-gray-950 rounded-lg p-3 text-xs text-gray-300 overflow-auto max-h-64 font-mono">
                {JSON.stringify(entry.request, null, 2)}
              </pre>
            </div>

            {/* Response */}
            <div>
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Response
              </h4>
              {entry.response ? (
                <pre
                  className={`bg-gray-950 rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono ${
                    entry.response.isError ? "text-red-400" : "text-gray-300"
                  }`}
                >
                  {JSON.stringify(entry.response.content, null, 2)}
                </pre>
              ) : (
                <div className="bg-gray-950 rounded-lg p-3 text-xs text-gray-500 italic">
                  Pending...
                </div>
              )}
            </div>
          </div>

          {/* Metadata */}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
            <span>
              <strong className="text-gray-400">ID:</strong>{" "}
              <code className="font-mono">{entry.id}</code>
            </span>
            <span>
              <strong className="text-gray-400">Server ID:</strong>{" "}
              <code className="font-mono">{entry.server.id}</code>
            </span>
            {entry.originalMethod && entry.originalMethod !== entry.method && (
              <span>
                <strong className="text-gray-400">Original Method:</strong>{" "}
                <code className="font-mono">{entry.originalMethod}</code>
              </span>
            )}
            {entry.sessionId && (
              <span>
                <strong className="text-gray-400">Session:</strong>{" "}
                <code className="font-mono">{entry.sessionId}</code>
              </span>
            )}
            {entry.errorMessage && (
              <span className="text-red-400">
                <strong>Error:</strong> {entry.errorMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Filter Bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filter: RequestLogFilter;
  onFilterChange: (filter: RequestLogFilter) => void;
  servers: { id: string; name: string }[];
}

const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  onFilterChange,
  servers,
}) => {
  const [searchInput, setSearchInput] = useState(filter.query ?? "");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onFilterChange({ ...filter, query: searchInput || undefined });
  };

  const clearFilters = () => {
    setSearchInput("");
    onFilterChange({});
  };

  const hasFilters =
    filter.type || filter.status || filter.serverId || filter.query;

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-900/50 border-b border-gray-800">
      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex-1 min-w-48">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search methods..."
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gateway-500 focus:border-transparent"
          />
        </div>
      </form>

      {/* Type Filter */}
      <div className="flex items-center gap-1">
        <Filter className="w-4 h-4 text-gray-500" />
        <select
          value={filter.type ?? ""}
          onChange={(e) =>
            onFilterChange({
              ...filter,
              type: (e.target.value as RequestType) || undefined,
            })
          }
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-gateway-500"
        >
          <option value="">All Types</option>
          <option value="tool">Tools</option>
          <option value="resource">Resources</option>
          <option value="prompt">Prompts</option>
        </select>
      </div>

      {/* Status Filter */}
      <select
        value={filter.status ?? ""}
        onChange={(e) =>
          onFilterChange({
            ...filter,
            status:
              (e.target.value as "pending" | "success" | "error") || undefined,
          })
        }
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-gateway-500"
      >
        <option value="">All Statuses</option>
        <option value="success">Success</option>
        <option value="error">Error</option>
        <option value="pending">Pending</option>
      </select>

      {/* Server Filter */}
      {servers.length > 0 && (
        <select
          value={filter.serverId ?? ""}
          onChange={(e) =>
            onFilterChange({
              ...filter,
              serverId: e.target.value || undefined,
            })
          }
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-gateway-500 max-w-40"
        >
          <option value="">All Servers</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {/* Clear Filters */}
      {hasFilters && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          <X className="w-4 h-4" />
          Clear
        </button>
      )}
    </div>
  );
};

// ─── Main Log Viewer Component ─────────────────────────────────────────────────

interface LogViewerProps {
  onClose?: () => void;
}

export default function LogViewer({ onClose }: LogViewerProps) {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RequestLogFilter>({ limit: 100 });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [total, setTotal] = useState(0);
  const [servers, setServers] = useState<{ id: string; name: string }[]>([]);

  const logsContainerRef = useRef<HTMLDivElement>(null);

  // ─── Fetch Logs ────────────────────────────────────────────────────────────

  const fetchLogs = useCallback(async () => {
    try {
      const response = await getRequestLogs(filter);
      setLogs(response.logs);
      setTotal(response.total);

      // Extract unique servers
      const serverMap = new Map<string, string>();
      for (const log of response.logs) {
        serverMap.set(log.server.id, log.server.name);
      }
      setServers(
        Array.from(serverMap.entries()).map(([id, name]) => ({ id, name }))
      );

      setError(null);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Initial load
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // ─── Real-time Updates via SSE ─────────────────────────────────────────────

  useEffect(() => {
    if (!autoRefresh) return;

    const unsubscribe = subscribeToEvents(
      (event: GatewayEventData) => {
        if (event.type === "log:started" || event.type === "log:completed") {
          const updatedLog = event.log;

          setLogs((prev) => {
            // Check if log already exists
            const existingIndex = prev.findIndex((l) => l.id === updatedLog.id);

            if (existingIndex >= 0) {
              // Update existing log
              const updated = [...prev];
              updated[existingIndex] = updatedLog;
              return updated;
            } else if (event.type === "log:started") {
              // Add new log at the beginning
              return [updatedLog, ...prev].slice(0, filter.limit ?? 100);
            }

            return prev;
          });

          setTotal((prev) =>
            event.type === "log:started" ? prev + 1 : prev
          );
        }
      },
      () => {
        // On SSE error, disable auto-refresh
        setAutoRefresh(false);
      }
    );

    return unsubscribe;
  }, [autoRefresh, filter.limit]);

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const handleClearLogs = async () => {
    if (!window.confirm("Clear all request logs?")) return;

    try {
      await clearRequestLogs();
      setLogs([]);
      setTotal(0);
      setExpandedIds(new Set());
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleFilterChange = (newFilter: RequestLogFilter) => {
    setFilter({ ...newFilter, limit: newFilter.limit ?? 100 });
    setLoading(true);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-gateway-500 to-gateway-700 rounded-lg flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Request Logs</h1>
            <p className="text-xs text-gray-500">
              {total} total request{total !== 1 ? "s" : ""}
              {autoRefresh && (
                <span className="ml-2 text-green-400">● Live</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-gateway-500 focus:ring-gateway-500 focus:ring-offset-gray-900"
            />
            Auto-refresh
          </label>

          <button
            onClick={fetchLogs}
            className="btn-ghost flex items-center gap-1.5 text-sm"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            onClick={handleClearLogs}
            className="btn-ghost flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
            title="Clear all logs"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="btn-ghost flex items-center gap-1.5 text-sm"
            >
              <X className="w-4 h-4" />
              Close
            </button>
          )}
        </div>
      </header>

      {/* Filter Bar */}
      <FilterBar
        filter={filter}
        onFilterChange={handleFilterChange}
        servers={servers}
      />

      {/* Logs List */}
      <div ref={logsContainerRef} className="flex-1 overflow-auto">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-gateway-500 animate-spin" />
            <span className="ml-3 text-gray-400">Loading logs...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-red-400 mb-2 font-medium">
              Failed to load logs
            </div>
            <p className="text-gray-500 text-sm mb-4">{error}</p>
            <button onClick={fetchLogs} className="btn-primary text-sm">
              Retry
            </button>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Activity className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No requests logged yet</p>
            <p className="text-sm mt-1">
              MCP client requests will appear here in real-time
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {logs.map((entry) => (
              <LogEntryRow
                key={entry.id}
                entry={entry}
                isExpanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpanded(entry.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer / Pagination Info */}
      {logs.length > 0 && (
        <footer className="px-6 py-3 border-t border-gray-800 bg-gray-900/50 text-sm text-gray-500">
          Showing {logs.length} of {total} requests
        </footer>
      )}
    </div>
  );
}