import { describe, expect, it } from 'vitest';
import { companySimilarity, similarityScore } from '../src/match.js';

describe('similarity suggestions', () => {
  it('treats company suffixes as equivalent', () => {
    expect(companySimilarity('Northwind Robotics, Inc.', 'northwind robotics')).toBe(1);
  });
  it('flags a different location as a reason, lowering the score', () => {
    const same = similarityScore({ company: 'Acme', title: 'SWE Co-op', location: 'Boston, MA' }, { company: 'Acme', title: 'SWE Co-op', location: 'Boston, MA' });
    const diff = similarityScore({ company: 'Acme', title: 'SWE Co-op', location: 'Boston, MA' }, { company: 'Acme', title: 'SWE Co-op', location: 'Austin, TX' });
    expect(diff.score).toBeLessThan(same.score);
    expect(diff.reasons).toContain('Different location');
  });
});
