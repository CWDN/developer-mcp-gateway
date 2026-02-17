import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RequestType = "tool" | "resource" | "prompt";

export interface RequestLogEntry {
  /** Unique identifier for this log entry */
  id: string;
  /** Timestamp when the request was initiated (ISO 8601) */
  timestamp: string;
  /** Type of MCP request */
  type: RequestType;
  /** The name of the tool, resource URI, or prompt name */
  method: string;
  /** Original name (unprefixed) if applicable */
  originalMethod?: string;
  /** Server that handled the request */
  server: {
    id: string;
    name: string;
  };
  /** Request arguments/parameters */
  request: Record<string, unknown>;
  /** Response content (if completed) */
  response?: {
    content: unknown;
    isError?: boolean;
  };
  /** Duration of the request in milliseconds */
  durationMs?: number;
  /** MCP session ID (if available) */
  sessionId?: string;
  /** Status of the request */
  status: "pending" | "success" | "error";
  /** Error message if status is "error" */
  errorMessage?: string;
}

export interface RequestLogFilter {
  /** Filter by request type */
  type?: RequestType;
  /** Filter by server ID */
  serverId?: string;
  /** Filter by status */
  status?: "pending" | "success" | "error";
  /** Search query (matches method name) */
  query?: string;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Start time filter (ISO 8601 or timestamp) */
  since?: string | number;
  /** End time filter (ISO 8601 or timestamp) */
  until?: string | number;
}

export interface RequestLogStats {
  total: number;
  byType: Record<RequestType, number>;
  byStatus: Record<string, number>;
  byServer: Record<string, number>;
  avgDurationMs: number;
  errorRate: number;
}

// ─── Request Log Store ─────────────────────────────────────────────────────────

/**
 * In-memory ring buffer for storing MCP request logs.
 * Emits events for real-time log streaming.
 */
export class RequestLogStore extends EventEmitter {
  private logs: RequestLogEntry[] = [];
  private maxSize: number;
  private pendingRequests: Map<string, RequestLogEntry> = new Map();

  constructor(maxSize: number = 500) {
    super();
    this.maxSize = maxSize;
  }

  /**
   * Start a new request log entry. Returns the entry ID.
   * Call `complete()` when the request finishes.
   */
  start(params: {
    type: RequestType;
    method: string;
    originalMethod?: string;
    server: { id: string; name: string };
    request: Record<string, unknown>;
    sessionId?: string;
  }): string {
    const entry: RequestLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: params.type,
      method: params.method,
      originalMethod: params.originalMethod,
      server: params.server,
      request: params.request,
      sessionId: params.sessionId,
      status: "pending",
    };

    this.pendingRequests.set(entry.id, entry);
    this.addEntry(entry);
    this.emit("log:started", entry);

    return entry.id;
  }

  /**
   * Complete a pending request with its response.
   */
  complete(
    id: string,
    result: {
      content: unknown;
      isError?: boolean;
    }
  ): void {
    const entry = this.pendingRequests.get(id);
    if (!entry) return;

    const startTime = new Date(entry.timestamp).getTime();
    entry.durationMs = Date.now() - startTime;
    entry.status = result.isError ? "error" : "success";
    entry.response = result;

    if (result.isError && typeof result.content === "string") {
      entry.errorMessage = result.content;
    } else if (
      result.isError &&
      Array.isArray(result.content) &&
      result.content[0]?.text
    ) {
      entry.errorMessage = result.content[0].text;
    }

    this.pendingRequests.delete(id);
    this.updateEntry(entry);
    this.emit("log:completed", entry);
  }

  /**
   * Mark a request as failed with an error message.
   */
  fail(id: string, errorMessage: string): void {
    const entry = this.pendingRequests.get(id);
    if (!entry) return;

    const startTime = new Date(entry.timestamp).getTime();
    entry.durationMs = Date.now() - startTime;
    entry.status = "error";
    entry.errorMessage = errorMessage;
    entry.response = {
      content: [{ type: "text", text: errorMessage }],
      isError: true,
    };

    this.pendingRequests.delete(id);
    this.updateEntry(entry);
    this.emit("log:completed", entry);
  }

  /**
   * Add a complete log entry directly (for entries that don't use start/complete flow).
   */
  add(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
    const fullEntry: RequestLogEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.addEntry(fullEntry);
    this.emit("log:added", fullEntry);

    return fullEntry;
  }

  /**
   * Get all log entries, optionally filtered.
   */
  getAll(filter?: RequestLogFilter): RequestLogEntry[] {
    let results = [...this.logs];

    // Apply filters
    if (filter?.type) {
      results = results.filter((l) => l.type === filter.type);
    }

    if (filter?.serverId) {
      results = results.filter((l) => l.server.id === filter.serverId);
    }

    if (filter?.status) {
      results = results.filter((l) => l.status === filter.status);
    }

    if (filter?.query) {
      const query = filter.query.toLowerCase();
      results = results.filter(
        (l) =>
          l.method.toLowerCase().includes(query) ||
          l.originalMethod?.toLowerCase().includes(query) ||
          l.server.name.toLowerCase().includes(query)
      );
    }

    if (filter?.since) {
      const sinceTime =
        typeof filter.since === "number"
          ? filter.since
          : new Date(filter.since).getTime();
      results = results.filter(
        (l) => new Date(l.timestamp).getTime() >= sinceTime
      );
    }

    if (filter?.until) {
      const untilTime =
        typeof filter.until === "number"
          ? filter.until
          : new Date(filter.until).getTime();
      results = results.filter(
        (l) => new Date(l.timestamp).getTime() <= untilTime
      );
    }

    // Sort by timestamp descending (newest first)
    results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply pagination
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? results.length;

    return results.slice(offset, offset + limit);
  }

  /**
   * Get a single log entry by ID.
   */
  get(id: string): RequestLogEntry | undefined {
    return this.logs.find((l) => l.id === id);
  }

  /**
   * Get aggregated statistics about the logs.
   */
  getStats(): RequestLogStats {
    const stats: RequestLogStats = {
      total: this.logs.length,
      byType: { tool: 0, resource: 0, prompt: 0 },
      byStatus: { pending: 0, success: 0, error: 0 },
      byServer: {},
      avgDurationMs: 0,
      errorRate: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;
    let errorCount = 0;

    for (const log of this.logs) {
      // By type
      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;

      // By status
      stats.byStatus[log.status] = (stats.byStatus[log.status] || 0) + 1;

      // By server
      stats.byServer[log.server.name] =
        (stats.byServer[log.server.name] || 0) + 1;

      // Duration tracking
      if (log.durationMs !== undefined) {
        totalDuration += log.durationMs;
        completedCount++;
      }

      // Error tracking
      if (log.status === "error") {
        errorCount++;
      }
    }

    stats.avgDurationMs =
      completedCount > 0 ? Math.round(totalDuration / completedCount) : 0;
    stats.errorRate =
      this.logs.length > 0 ? errorCount / this.logs.length : 0;

    return stats;
  }

  /**
   * Clear all logs.
   */
  clear(): void {
    this.logs = [];
    this.pendingRequests.clear();
    this.emit("log:cleared");
  }

  /**
   * Get the number of stored logs.
   */
  size(): number {
    return this.logs.length;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private addEntry(entry: RequestLogEntry): void {
    // Add to the beginning (newest first)
    this.logs.unshift(entry);

    // Trim if over max size
    if (this.logs.length > this.maxSize) {
      this.logs = this.logs.slice(0, this.maxSize);
    }
  }

  private updateEntry(updated: RequestLogEntry): void {
    const index = this.logs.findIndex((l) => l.id === updated.id);
    if (index !== -1) {
      this.logs[index] = updated;
    }
  }
}

// ─── Singleton instance ────────────────────────────────────────────────────────

let requestLogStore: RequestLogStore | null = null;

/**
 * Get the shared request log store instance.
 */
export function getRequestLogStore(maxSize?: number): RequestLogStore {
  if (!requestLogStore) {
    requestLogStore = new RequestLogStore(maxSize);
  }
  return requestLogStore;
}