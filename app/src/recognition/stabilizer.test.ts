import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STABILIZER_CONFIG,
  createStabilizer,
  type StabilizerInput,
} from './stabilizer';

const A: StabilizerInput = { kind: 'observation', label: 'A', confidence: 6 / 7 };
const NONE: StabilizerInput = { kind: 'absent' };
const UNRELIABLE: StabilizerInput = { kind: 'unreliable' };

function push(sequence: [StabilizerInput, number][], stabilizer = createStabilizer()) {
  return sequence.map(([input, at]) => stabilizer.update(input, at));
}

describe('temporal stabilization rules', () => {
  it('uses the frozen window, agreement and release defaults', () => {
    expect(DEFAULT_STABILIZER_CONFIG).toEqual({
      windowMs: 1000,
      minObservations: 5,
      minSpanMs: 600,
      minAgreement: 0.8,
      maxGapMs: 400,
      releaseMs: 1000,
    });
    expect(Object.isFrozen(DEFAULT_STABILIZER_CONFIG)).toBe(true);
  });

  it('reports no hand before any observation', () => {
    const stabilizer = createStabilizer();
    expect(stabilizer.update(NONE, 0)).toEqual({
      phase: 'no_hand',
      label: null,
      confidence: 0,
    });
  });

  it('keeps a held letter pending until 5 observations span 600 ms', () => {
    const decisions = push([
      [A, 0],
      [A, 200],
      [A, 400],
      [A, 600],
      [A, 800],
    ]);

    expect(decisions.slice(0, 4).every((decision) => decision.phase === 'pending')).toBe(true);
    expect(decisions[0]).toEqual({ phase: 'pending', label: 'A', confidence: 6 / 7 });
    expect(decisions[4]).toEqual({ phase: 'accepted', label: 'A', confidence: 6 / 7 });
  });

  it('does not accept when the span or the observation count is too small', () => {
    const tooFast = push([
      [A, 0],
      [A, 100],
      [A, 200],
      [A, 300],
      [A, 400],
    ]);
    expect(tooFast.every((decision) => decision.phase === 'pending')).toBe(true);

    const tooShort = push([
      [A, 0],
      [A, 400],
    ]);
    expect(tooShort.every((decision) => decision.phase === 'pending')).toBe(true);
  });

  it('counts unreliable frames against agreement', () => {
    const decisions = push([
      [A, 0],
      [A, 200],
      [UNRELIABLE, 400],
      [A, 600],
      [A, 800],
      [UNRELIABLE, 1000],
      [A, 1200],
    ]);

    expect(decisions.every((decision) => decision.phase === 'pending')).toBe(true);
  });

  it('resets pending stability when the frame gap exceeds 400 ms', () => {
    const stabilizer = createStabilizer();
    const beforeGap = push(
      [
        [A, 0],
        [A, 200],
        [A, 400],
        [A, 600],
      ],
      stabilizer,
    );
    expect(beforeGap.every((decision) => decision.phase === 'pending')).toBe(true);

    const afterGap = stabilizer.update(A, 1500);
    expect(afterGap.phase).toBe('pending');
  });

  it('accepts once, locks until zero hands for 1000 ms, then accepts the repeated letter', () => {
    const stabilizer = createStabilizer();
    push(
      [
        [A, 0],
        [A, 200],
        [A, 400],
        [A, 600],
        [A, 800],
      ],
      stabilizer,
    );

    expect(stabilizer.update(A, 1000).phase).toBe('release_required');
    expect(stabilizer.update(A, 1200).phase).toBe('release_required');
    expect(stabilizer.update(NONE, 1400).phase).toBe('release_required');
    for (const t of [1600, 1800, 2000, 2200]) expect(stabilizer.update(NONE, t).phase).toBe('release_required');
    expect(stabilizer.update(NONE, 2400).phase).toBe('no_hand');

    const repeated = push(
      [
        [A, 2700],
        [A, 2900],
        [A, 3100],
        [A, 3300],
        [A, 3500],
      ],
      stabilizer,
    );
    expect(repeated.at(-1)).toEqual({ phase: 'accepted', label: 'A', confidence: 6 / 7 });
  });

  it('treats unreliable frames as hands present, never as release progress', () => {
    const stabilizer = createStabilizer();
    push(
      [
        [A, 0],
        [A, 200],
        [A, 400],
        [A, 600],
        [A, 800],
      ],
      stabilizer,
    );

    expect(stabilizer.update(UNRELIABLE, 1000).phase).toBe('release_required');
    expect(stabilizer.update(NONE, 1900).phase).toBe('release_required');
    for (const t of [2100, 2300, 2500, 2700]) expect(stabilizer.update(NONE, t).phase).toBe('release_required');
    expect(stabilizer.update(NONE, 2900).phase).toBe('no_hand');
  });

  it('requires a fresh release interval after requireRelease', () => {
    const stabilizer = createStabilizer();
    stabilizer.requireRelease(0);

    expect(stabilizer.update(A, 100).phase).toBe('release_required');
    expect(stabilizer.update(A, 800).phase).toBe('release_required');
    expect(stabilizer.update(NONE, 1000).phase).toBe('release_required');
    for (const t of [1200, 1400, 1600, 1800]) expect(stabilizer.update(NONE, t).phase).toBe('release_required');
    expect(stabilizer.update(NONE, 2000).phase).toBe('no_hand');

    const repeated = push(
      [
        [A, 2000],
        [A, 2200],
        [A, 2400],
        [A, 2600],
        [A, 2800],
      ],
      stabilizer,
    );
    expect(repeated.at(-1)).toEqual({
      phase: 'accepted',
      label: 'A',
      confidence: 6 / 7,
    });
  });

  it('clears pending and release state on reset', () => {
    const stabilizer = createStabilizer();
    push(
      [
        [A, 0],
        [A, 200],
        [A, 400],
        [A, 600],
        [A, 800],
      ],
      stabilizer,
    );
    expect(stabilizer.update(A, 1000).phase).toBe('release_required');

    stabilizer.reset();

    expect(stabilizer.update(A, 1200)).toEqual({
      phase: 'pending',
      label: 'A',
      confidence: 6 / 7,
    });
  });

  it('honors tightened test configuration', () => {
    const stabilizer = createStabilizer({
      minObservations: 2,
      minSpanMs: 100,
      minAgreement: 1,
    });

    expect(stabilizer.update(A, 0).phase).toBe('pending');
    expect(stabilizer.update(A, 150).phase).toBe('accepted');
    expect(stabilizer.update({ kind: 'observation', label: 'B', confidence: 1 }, 300).phase).toBe(
      'release_required',
    );
  });
});
