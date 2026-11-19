import { computeScorecard, badgeMarkdown, gradeColor } from '../src/security/scorecard';
import type { SecurityFinding } from '../src/types';

function finding(severity: SecurityFinding['severity'], rule: string): SecurityFinding {
  return { server: 's', severity, rule, message: 'm' };
}

describe('computeScorecard', () => {
  it('grades a clean config A with a full score', () => {
    const sc = computeScorecard([]);
    expect(sc.score).toBe(100);
    expect(sc.grade).toBe('A');
    expect(sc.issues).toEqual([]);
    expect(sc.summary).toMatch(/no security issues/i);
  });

  it('deducts per severity and maps to a grade', () => {
    expect(computeScorecard([finding('high', 'shell-exec')]).grade).toBe('C'); // 70
    expect(computeScorecard([finding('high', 'shell-exec'), finding('high', 'broad-filesystem')]).grade).toBe('F'); // 40
    expect(computeScorecard([finding('medium', 'unpinned-package')]).grade).toBe('B'); // 88
  });

  it('counts by severity and derives distinct issue labels, most severe first', () => {
    const sc = computeScorecard([
      finding('medium', 'unpinned-package'),
      finding('high', 'shell-exec'),
      finding('high', 'shell-exec'),
    ]);
    expect(sc.counts).toEqual({ high: 2, medium: 1, low: 0, info: 0 });
    expect(sc.issues[0]).toBe('shell execution');
    expect(sc.issues).toContain('unpinned package');
    expect(sc.summary).toContain('2 high');
  });

  it('floors the score at 0', () => {
    const many = Array.from({ length: 10 }, () => finding('high', 'shell-exec'));
    expect(computeScorecard(many).score).toBe(0);
    expect(computeScorecard(many).grade).toBe('F');
  });
});

describe('badge', () => {
  it('colors grades sensibly', () => {
    expect(gradeColor('A')).toBe('brightgreen');
    expect(gradeColor('F')).toBe('red');
  });

  it('builds a shields.io badge markdown with the grade and score', () => {
    const md = badgeMarkdown(computeScorecard([finding('high', 'shell-exec')]));
    expect(md).toContain('https://img.shields.io/badge/');
    expect(md).toContain('C%20(70%2F100)'); // url-encoded "C (70/100)"
    expect(md).toContain('yellow');
    expect(md.startsWith('![MCP security](')).toBe(true);
  });
});
