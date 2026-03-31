// ─── MCP Registry Types ─────────────────────────────────────────────────────────
//
// Types for the MCP Registry API at https://registry.modelcontextprotocol.io/

export interface RegistryIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

export interface RegistryRemoteHeader {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  value?: string;
}

export interface RegistryRemote {
  type: "streamable-http" | "sse";
  url: string;
  headers?: RegistryRemoteHeader[];
}

export interface RegistryEnvironmentVariable {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  format?: string;
}

export interface RegistryPackageTransport {
  type: "stdio";
}

export interface RegistryPackage {
  registryType: "npm" | "oci";
  identifier: string;
  version?: string;
  transport: RegistryPackageTransport;
  environmentVariables?: RegistryEnvironmentVariable[];
}

export interface RegistryRepository {
  url: string;
  source?: string;
  id?: string;
  subfolder?: string;
}

export interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: RegistryRepository;
  icons?: RegistryIcon[];
  remotes?: RegistryRemote[];
  packages?: RegistryPackage[];
}

export interface RegistryMeta {
  "io.modelcontextprotocol.registry/official"?: {
    status?: string;
    isLatest?: boolean;
    publishedAt?: string;
    updatedAt?: string;
  };
}

export interface RegistryEntry {
  server: RegistryServer;
  _meta?: RegistryMeta;
}

export interface RegistryMetadata {
  nextCursor?: string;
  count?: number;
}

export interface RegistryResponse {
  servers: RegistryEntry[];
  metadata?: RegistryMetadata;
}

// ─── Grouped Server (multiple versions merged under one name) ───────────────────

export interface GroupedServer {
  /** The shared server name (e.g. "ai.example/my-server") */
  name: string;
  /** All known versions, sorted newest-first (by semver then by publishedAt) */
  versions: RegistryEntry[];
}

export type ServerTransportType = "sse" | "streamable-http" | "stdio" | "unknown";