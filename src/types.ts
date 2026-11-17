/**
 * Shared types for mcp-slim.
 *
 * These model the subset of an MCP client configuration that we can inspect
 * statically (i.e. without launching the servers). Live tool-schema
 * introspection over JSON-RPC is intentionally out of scope for v1.0.
 */

/** A single registered MCP server, as written in a client config file. */
export interface McpServerConfig {
  /** Executable for stdio transports (e.g. "npx", "node", "uvx"). */
  command?: string;
  /** Arguments passed to {@link command}. */
  args?: string[];
  /** Environment variables provided to the server process. */
  env?: Record<string, string>;
  /** Endpoint for remote transports (SSE / streamable HTTP). */
  url?: string;
  /** Explicit transport type, when the client records one. */
  type?: string;
  /** Any other fields the client stored; preserved for round-tripping. */
  [key: string]: unknown;
}

/** A parsed client config file plus provenance about where it came from. */
export interface McpConfigFile {
  /** Absolute path the config was read from. */
  path: string;
  /** Human-readable origin, e.g. "Claude Desktop", "Cursor". */
  source: string;
  /** Map of server name -> server definition. */
  servers: Record<string, McpServerConfig>;
  /** The full parsed JSON, preserved so `compress` can round-trip it. */
  raw: Record<string, unknown>;
}

/** Severity levels for security findings, ordered least to most severe. */
export type Severity = 'info' | 'low' | 'medium' | 'high';

/** A single security finding against one server. */
export interface SecurityFinding {
  server: string;
  severity: Severity;
  /** Short machine-readable rule id, e.g. "shell-exec". */
  rule: string;
  /** Human-readable explanation of the risk. */
  message: string;
}

/** Token footprint of a single server's definition. */
export interface ServerTokenReport {
  server: string;
  /** Characters of serialized JSON for this server's definition. */
  chars: number;
  /** Estimated token count (~4 chars/token). */
  tokens: number;
}

/** Aggregated token footprint for one config file. */
export interface ConfigTokenReport {
  path: string;
  source: string;
  servers: ServerTokenReport[];
  totalTokens: number;
}

/** A single recorded point in the token-footprint history (one per config per run). */
export interface TokenSnapshot {
  /** ISO 8601 timestamp of the audit run that produced this snapshot. */
  ts: string;
  /** Config origin, e.g. "Claude Desktop". */
  source: string;
  /** Absolute path of the config file. */
  path: string;
  /** Estimated total token footprint of that config at this time. */
  totalTokens: number;
  /** Number of servers registered in that config. */
  serverCount: number;
}

/** Time granularity for a trend report. */
export type TrendPeriod =
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly';

/** Aggregated token footprint for one period bucket. */
export interface TrendBucket {
  /** Human-readable bucket key, e.g. "2026-11-17" or "2026-Q4". */
  bucket: string;
  /** Number of audit runs that fell in this bucket. */
  samples: number;
  /** Average per-run total footprint in this bucket (rounded). */
  avgTokens: number;
  minTokens: number;
  maxTokens: number;
  /** Footprint of the most recent run in this bucket. */
  lastTokens: number;
}
