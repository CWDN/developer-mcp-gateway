import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  RefreshCw,
  Globe,
  Terminal,
  Package,
  Check,
} from "lucide-react";
import {
  searchRegistry,
  groupRegistryEntries,
  mergeGroupedEntries,
  getServerDisplayName,
  getServerTransportType,
  getServerIcon,
  getServerExternalUrl,
  type RegistryServer,
  type GroupedServer,
} from "../registry";

interface RegistryBrowserProps {
  onSelect: (server: RegistryServer) => void;
}

export default function RegistryBrowser({ onSelect }: RegistryBrowserProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [groups, setGroups] = useState<GroupedServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  // Track which version index is selected per server name (default 0 = latest)
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>({});
  // Track which server name has the version dropdown open
  const [openVersionPicker, setOpenVersionPicker] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  const fetchServers = useCallback(
    async (query: string, cursor?: string) => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const isLoadMore = !!cursor;
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setGroups([]);
        setNextCursor(undefined);
        setSelectedVersions({});
        setOpenVersionPicker(null);
      }
      setError(null);

      try {
        const result = await searchRegistry(query, cursor);
        if (controller.signal.aborted) return;

        if (isLoadMore) {
          setGroups((prev) => mergeGroupedEntries(prev, result.servers));
        } else {
          setGroups(groupRegistryEntries(result.servers));
        }
        setNextCursor(result.metadata?.nextCursor);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to fetch from registry");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  // Fetch on debounced search change (and on initial load)
  useEffect(() => {
    fetchServers(debouncedSearch);
  }, [debouncedSearch, fetchServers]);

  const handleLoadMore = () => {
    if (nextCursor && !loadingMore) {
      fetchServers(debouncedSearch, nextCursor);
    }
  };

  const handleRetry = () => {
    fetchServers(debouncedSearch);
  };

  const getTransportBadges = (server: RegistryServer) => {
    const hasRemote = server.remotes && server.remotes.length > 0;
    const hasStdio = server.packages?.some((p) => p.transport?.type === "stdio");
    const transport = getServerTransportType(server);
    const badges: React.ReactNode[] = [];

    if (hasRemote) {
      const remoteType = server.remotes![0].type;
      badges.push(
        <span
          key="remote"
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-900/40 text-blue-300 border border-blue-800/50"
        >
          <Globe className="w-2.5 h-2.5" />
          {remoteType}
        </span>,
      );
    }
    if (hasStdio) {
      badges.push(
        <span
          key="stdio"
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-900/40 text-green-300 border border-green-800/50"
        >
          <Terminal className="w-2.5 h-2.5" />
          stdio
        </span>,
      );
    }
    if (badges.length === 0 && transport === "unknown") {
      badges.push(
        <span
          key="unknown"
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-800/60 text-gray-400 border border-gray-700/50"
        >
          <Package className="w-2.5 h-2.5" />
          package
        </span>,
      );
    }
    return badges;
  };

  const getTransportEmoji = (server: RegistryServer): string => {
    const transport = getServerTransportType(server);
    switch (transport) {
      case "sse":
      case "streamable-http":
        return "🌐";
      case "stdio":
        return "⬡";
      default:
        return "📦";
    }
  };

  const renderServerCard = (group: GroupedServer) => {
    const versionIdx = selectedVersions[group.name] ?? 0;
    const selectedEntry = group.versions[versionIdx] ?? group.versions[0];
    const server = selectedEntry.server;
    const displayName = getServerDisplayName(server);
    const iconUrl = getServerIcon(server);
    const externalUrl = getServerExternalUrl(server);
    const hasMultipleVersions = group.versions.length > 1;
    const isLatest =
      selectedEntry._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest ?? false;
    const isPickerOpen = openVersionPicker === group.name;

    return (
      <div
        key={group.name}
        className="group/card relative border border-gray-700 rounded-lg hover:border-gateway-500/60 transition-all duration-150 bg-gray-800/30 hover:bg-gray-800/60"
      >
        {/* Main clickable area */}
        <button
          type="button"
          onClick={() => onSelect(server)}
          className="w-full text-left p-3"
        >
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="flex-shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center">
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt=""
                  className="w-6 h-6 rounded object-contain"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                    const parent = target.parentElement;
                    if (parent) parent.textContent = getTransportEmoji(server);
                  }}
                />
              ) : (
                <span className="text-xl">{getTransportEmoji(server)}</span>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white truncate max-w-[200px]">
                  {displayName}
                </span>
                {getTransportBadges(server)}
              </div>
              {server.description && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                  {server.description}
                </p>
              )}
              {/* Package/server name sub-line when title differs */}
              {server.title && server.title !== server.name && (
                <p className="text-[11px] text-gray-600 mt-0.5 font-mono truncate">
                  {server.name}
                </p>
              )}
            </div>

            <ChevronRight className="w-4 h-4 text-gray-600 group-hover/card:text-gateway-400 flex-shrink-0 mt-1 transition-colors" />
          </div>
        </button>

        {/* Footer row: version picker + external link */}
        <div className="flex items-center gap-3 px-3 pb-2.5 ml-10">
          {/* Version picker */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (hasMultipleVersions) {
                  setOpenVersionPicker(isPickerOpen ? null : group.name);
                }
              }}
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                hasMultipleVersions
                  ? "bg-gray-800/60 text-gray-300 border border-gray-600/50 hover:border-gray-500 hover:text-white cursor-pointer"
                  : "bg-gray-800/60 text-gray-400 border border-gray-700/50"
              }`}
            >
              v{server.version || "?"}
              {isLatest && (
                <span className="text-green-400 font-sans text-[9px] ml-0.5">latest</span>
              )}
              {hasMultipleVersions && (
                <>
                  <span className="text-gray-500 font-sans ml-0.5">
                    +{group.versions.length - 1}
                  </span>
                  <ChevronDown className={`w-2.5 h-2.5 text-gray-500 transition-transform ${isPickerOpen ? "rotate-180" : ""}`} />
                </>
              )}
            </button>

            {/* Version dropdown */}
            {isPickerOpen && hasMultipleVersions && (
              <div className="absolute z-20 top-full left-0 mt-1 min-w-[160px] max-h-[200px] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1">
                {group.versions.map((entry, idx) => {
                  const isSelected = idx === versionIdx;
                  const entryIsLatest =
                    entry._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest ?? false;
                  return (
                    <button
                      key={entry.server.version ?? idx}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedVersions((prev) => ({ ...prev, [group.name]: idx }));
                        setOpenVersionPicker(null);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        isSelected
                          ? "bg-gateway-500/15 text-gateway-300"
                          : "text-gray-400 hover:bg-gray-800 hover:text-white"
                      }`}
                    >
                      <span className="font-mono flex-1 truncate">
                        v{entry.server.version || "?"}
                      </span>
                      {entryIsLatest && (
                        <span className="text-[9px] text-green-400 bg-green-900/30 px-1 py-0.5 rounded">
                          latest
                        </span>
                      )}
                      {isSelected && <Check className="w-3 h-3 text-gateway-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* External link */}
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              {server.repository?.url ? "Repository" : "Website"}
            </a>
          )}
        </div>
      </div>
    );
  };

  // Close version picker when clicking outside
  useEffect(() => {
    if (!openVersionPicker) return;
    const handler = () => setOpenVersionPicker(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openVersionPicker]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the MCP Registry..."
          className="input-field pl-9 text-sm"
          autoFocus
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 animate-spin" />
        )}
      </div>

      {/* Results */}
      <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1 -mr-1">
        {/* Loading state (initial) */}
        {loading && groups.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-6 h-6 text-gateway-400 animate-spin" />
            <p className="text-sm text-gray-500">Searching registry...</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && groups.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">
              {search.trim()
                ? `No servers matching "${search}"`
                : "No servers found"}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              You can still add a custom server using the Local or Remote tabs.
            </p>
          </div>
        )}

        {/* Server cards */}
        {groups.map(renderServerCard)}

        {/* Load more button */}
        {nextCursor && !loading && !error && (
          <div className="pt-2 pb-1">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 bg-gray-800/30 hover:bg-gray-800/60 transition-all disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}