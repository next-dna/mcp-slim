/**
 * Lossless compressor.
 *
 * Produces a minified, semantically-identical version of a client config:
 *   - strips all insignificant JSON whitespace, and
 *   - collapses runs of whitespace inside human-readable `description` fields
 *     (lossless for consumers, since MCP descriptions are free text).
 *
 * The output parses to an object that is deep-equal to the input for all
 * structural data; only cosmetic whitespace is removed. We report the token
 * savings using the same heuristic as the analyzer.
 */

import type { McpConfigFile } from '../types';
import { estimateTokens } from '../analyzer/token-calculator';

export interface CompressionResult {
  /** Minified JSON string, ready to write back to disk. */
  output: string;
  beforeChars: number;
  afterChars: number;
  beforeTokens: number;
  afterTokens: number;
  /** Tokens saved (never negative). */
  savedTokens: number;
  /** Fraction saved in [0, 1]. */
  savedRatio: number;
}

/**
 * Recursively collapse whitespace in any `description` string field.
 *
 * Returns a new structure; the input is not mutated.
 */
function trimDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(trimDescriptions);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'description' && typeof child === 'string') {
        out[key] = child.replace(/\s+/g, ' ').trim();
      } else {
        out[key] = trimDescriptions(child);
      }
    }
    return out;
  }
  return value;
}

/**
 * Compress a config file losslessly and compute token savings.
 */
export function compressConfig(config: McpConfigFile): CompressionResult {
  const beforeJson = JSON.stringify(config.raw, null, 2);
  const trimmed = trimDescriptions(config.raw);
  const afterJson = JSON.stringify(trimmed);

  const beforeChars = beforeJson.length;
  const afterChars = afterJson.length;
  const beforeTokens = estimateTokens(beforeJson);
  const afterTokens = estimateTokens(afterJson);
  const savedTokens = Math.max(0, beforeTokens - afterTokens);
  const savedRatio = beforeTokens === 0 ? 0 : savedTokens / beforeTokens;

  return {
    output: afterJson,
    beforeChars,
    afterChars,
    beforeTokens,
    afterTokens,
    savedTokens,
    savedRatio,
  };
}
