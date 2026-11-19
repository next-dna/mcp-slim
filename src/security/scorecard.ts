/**
 * Security scorecard.
 *
 * Turns a set of {@link SecurityFinding}s into a letter grade (A–F), a numeric
 * score, and a one-line verdict — the shareable headline of an audit. Also
 * builds a shields.io badge for READMEs. Zero runtime dependencies.
 */

import type { Grade, Scorecard, SecurityFinding, Severity } from '../types';

/** Points deducted per finding, by severity. */
const WEIGHTS: Record<Severity, number> = { high: 30, medium: 12, low: 4, info: 0 };

/** Short, human-readable labels for each rule id, most-severe intent first. */
const RULE_LABELS: Record<string, string> = {
  'shell-exec': 'shell execution',
  'shell-command-flag': 'inline shell command',
  'broad-filesystem': 'broad filesystem access',
  'insecure-transport': 'insecure http endpoint',
  'unknown-transport': 'non-standard transport',
  'unpinned-package': 'unpinned package',
  'plaintext-secret': 'plaintext secret',
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function gradeForScore(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

/** Compute a {@link Scorecard} from findings. */
export function computeScorecard(findings: SecurityFinding[]): Scorecard {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    counts[f.severity] += 1;
  }

  const penalty = findings.reduce((sum, f) => sum + WEIGHTS[f.severity], 0);
  const score = clamp(100 - penalty, 0, 100);
  const grade = gradeForScore(score);

  // Distinct issue labels, ordered by the most severe finding that produced them.
  const seen = new Map<string, number>();
  for (const f of findings) {
    const label = RULE_LABELS[f.rule] ?? f.rule;
    const rank = SEVERITY_RANK[f.severity];
    if (!seen.has(label) || rank > (seen.get(label) ?? 0)) {
      seen.set(label, rank);
    }
  }
  const issues = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);

  const summary = buildSummary(grade, counts, issues);
  return { score, grade, counts, issues, summary };
}

function buildSummary(
  grade: Grade,
  counts: Scorecard['counts'],
  issues: string[],
): string {
  if (issues.length === 0) {
    return `Grade ${grade} — no security issues found`;
  }
  const parts: string[] = [];
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  if (counts.low) parts.push(`${counts.low} low`);
  const top = issues.slice(0, 3).join(', ');
  return `Grade ${grade} — ${parts.join(', ')}: ${top}`;
}

/** Badge color for a grade, as a shields.io color name. */
export function gradeColor(grade: Grade): string {
  switch (grade) {
    case 'A':
      return 'brightgreen';
    case 'B':
      return 'green';
    case 'C':
      return 'yellow';
    case 'D':
      return 'orange';
    case 'F':
      return 'red';
  }
}

/** Markdown for a shields.io badge of the grade, ready to paste into a README. */
export function badgeMarkdown(scorecard: Scorecard): string {
  const label = encodeURIComponent('MCP security');
  const message = encodeURIComponent(`${scorecard.grade} (${scorecard.score}/100)`);
  const url = `https://img.shields.io/badge/${label}-${message}-${gradeColor(scorecard.grade)}`;
  return `![MCP security](${url})`;
}
