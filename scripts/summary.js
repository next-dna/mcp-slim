#!/usr/bin/env node
'use strict';

/**
 * Turn `mcp-slim audit --json` (piped on stdin) into:
 *   - a Markdown security summary written to $GITHUB_STEP_SUMMARY, and
 *   - `grade` / `score` written to $GITHUB_OUTPUT (the action's outputs).
 *
 * Standalone Node, no dependencies. Used by action.yml. Outside GitHub Actions
 * (no env files) it just prints the Markdown to stdout.
 */

const fs = require('fs');

// Must match src/security/scorecard.ts.
const WEIGHTS = { high: 30, medium: 12, low: 4, info: 0 };

function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function emojiFor(grade) {
  if (grade === 'A' || grade === 'B') return '🟢';
  if (grade === 'C') return '🟡';
  if (grade === 'D') return '🟠';
  return '🔴';
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let data = null;
  try {
    data = JSON.parse(readStdin());
  } catch {
    data = null;
  }
  const results = Array.isArray(data)
    ? data
    : data && Array.isArray(data.results)
      ? data.results
      : [];

  const total = { high: 0, medium: 0, low: 0, info: 0 };
  for (const r of results) {
    const c = (r.scorecard && r.scorecard.counts) || {};
    total.high += c.high || 0;
    total.medium += c.medium || 0;
    total.low += c.low || 0;
    total.info += c.info || 0;
  }
  const penalty = total.high * WEIGHTS.high + total.medium * WEIGHTS.medium + total.low * WEIGHTS.low;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const grade = gradeFor(score);

  const lines = [];
  lines.push(`## ${emojiFor(grade)} MCP security: Grade ${grade} (${score}/100)`);
  lines.push('');
  if (results.length === 0) {
    lines.push('_No MCP configs found to audit._');
  } else {
    lines.push('| Config | Grade | Score | High | Medium | Low |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of results) {
      const s = r.scorecard || {};
      const c = s.counts || {};
      const src = (r.tokens && r.tokens.source) || 'config';
      lines.push(`| ${src} | ${s.grade || '?'} | ${s.score != null ? s.score : '?'} | ${c.high || 0} | ${c.medium || 0} | ${c.low || 0} |`);
    }
  }
  const md = lines.join('\n') + '\n';

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch {
      /* ignore */
    }
  } else {
    process.stdout.write(md);
  }

  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `grade=${grade}\nscore=${score}\n`);
    } catch {
      /* ignore */
    }
  }
}

main();
