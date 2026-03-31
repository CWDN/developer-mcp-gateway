// ─── MCP Registry Integration ──────────────────────────────────────────────────
//
// Live integration with the MCP Registry at https://registry.modelcontextprotocol.io/
// Fetches all versions and groups them by server name so the user can pick a version.

export type {
  RegistryIcon,
  RegistryRemoteHeader,
  RegistryRemote,
  RegistryEnvironmentVariable,
  RegistryPackageTransport,
  RegistryPackage,
  RegistryRepository,
  RegistryServer,
  RegistryMeta,
  RegistryEntry,
  RegistryMetadata,
  RegistryResponse,
  GroupedServer,
  ServerTransportType,
} from "./registry-types";

import type {
  RegistryEntry,
  RegistryResponse,
  RegistryServer,
  GroupedServer,
  ServerTransportType,
} from "./registry-types";

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io/v0/servers";

// ─── Fetch Function ─────────────────────────────────────────────────────────────

export async function searchRegistry(
  query: string,
  cursor?: string,
): Promise<RegistryResponse> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("search", query.trim());
  }
  // We intentionally do NOT pass latest=true so we receive every version.
  // The client groups them and lets the user pick a version.
  params.set("limit", "50");
  if (cursor) {
    params.set("cursor", cursor);
  }
  const url = REGISTRY_BASE_URL + "?" + params.toString();
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      "Registry request failed: " + response.status + " " + response.statusText,
    );
  }
  return (await response.json()) as RegistryResponse;
}

// ─── Version Sorting ────────────────────────────────────────────────────────────

/**
 * Parses a semver-ish version string into comparable numeric parts.
 * Handles "1.2.3", "0.1", "2.0.0-beta", "1.0.0+0.7.1", etc.
 */
function parseSemver(version: string): [number, number, number] {
  const clean = version.replace(/[-+].*$/, "");
  const parts = clean.split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Compare two entries newest-first (descending).
 * Primary: semver descending. Tiebreak: isLatest flag, then publishedAt.
 */
function compareEntries(a: RegistryEntry, b: RegistryEntry): number {
  const [aMaj, aMin, aPat] = parseSemver(a.server.version ?? "0.0.0");
  const [bMaj, bMin, bPat] = parseSemver(b.server.version ?? "0.0.0");
  if (bMaj !== aMaj) return bMaj - aMaj;
  if (bMin !== aMin) return bMin - aMin;
  if (bPat !== aPat) return bPat - aPat;
  // If semver parts are equal, prefer the one marked isLatest
  const aL =
    a._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest ?? false;
  const bL =
    b._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest ?? false;
  if (aL !== bL) return aL ? -1 : 1;
  // Fall back to publishedAt descending
  const aD =
    a._meta?.["io.modelcontextprotocol.registry/official"]?.publishedAt ?? "";
  const bD =
    b._meta?.["io.modelcontextprotocol.registry/official"]?.publishedAt ?? "";
  return bD.localeCompare(aD);
}

// ─── Grouping ───────────────────────────────────────────────────────────────────

function addToMap(
  map: Map<string, RegistryEntry[]>,
  order: string[],
  entry: RegistryEntry,
): void {
  const key = entry.server.name;
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
    order.push(key);
  }
  if (!bucket.some((e) => e.server.version === entry.server.version)) {
    bucket.push(entry);
  }
}

function buildGroups(
  map: Map<string, RegistryEntry[]>,
  order: string[],
): GroupedServer[] {
  return order.map((name) => {
    const versions = map.get(name)!;
    versions.sort(compareEntries);
    return { name, versions };
  });
}

/**
 * Groups a flat list of registry entries by `server.name`, merging versions.
 * Each group's versions are sorted newest-first.
 * Groups are ordered by appearance of their first entry (registry sort order).
 */
export function groupRegistryEntries(
  entries: RegistryEntry[],
): GroupedServer[] {
  const map = new Map<string, RegistryEntry[]>();
  const order: string[] = [];
  for (const entry of entries) {
    addToMap(map, order, entry);
  }
  return buildGroups(map, order);
}

/**
 * Merge new entries into an existing grouped list without losing previously
 * loaded versions. Used when paginating ("Load more").
 */
export function mergeGroupedEntries(
  existing: GroupedServer[],
  newEntries: RegistryEntry[],
): GroupedServer[] {
  const map = new Map<string, RegistryEntry[]>();
  const order: string[] = [];
  for (const group of existing) {
    map.set(group.name, [...group.versions]);
    order.push(group.name);
  }
  for (const entry of newEntries) {
    addToMap(map, order, entry);
  }
  return buildGroups(map, order);
}

// ─── Helper Functions ───────────────────────────────────────────────────────────

export function getServerDisplayName(server: RegistryServer): string {
  return server.title || server.name;
}

export function getServerTransportType(server: RegistryServer): ServerTransportType {
  if (server.remotes && server.remotes.length > 0) {
    return server.remotes[0].type;
  }
  if (server.packages && server.packages.length > 0) {
    const stdioPackage = server.packages.find((p) => p.transport?.type === "stdio");
    if (stdioPackage) return "stdio";
  }
  return "unknown";
}

export function getServerIcon(server: RegistryServer): string | null {
  if (server.icons && server.icons.length > 0 && server.icons[0].src) {
    return server.icons[0].src;
  }
  return null;
}

export function getServerExternalUrl(server: RegistryServer): string | null {
  if (server.websiteUrl) return server.websiteUrl;
  if (server.repository?.url) return server.repository.url;
  return null;
}