export interface StabilizerConfig {
  windowMs: number;
  minObservations: number;
  minSpanMs: number;
  minAgreement: number;
  maxGapMs: number;
  releaseMs: number;
}

export const DEFAULT_STABILIZER_CONFIG: Readonly<StabilizerConfig> = Object.freeze({
  windowMs: 1000,
  minObservations: 5,
  minSpanMs: 600,
  minAgreement: 0.8,
  maxGapMs: 400,
  releaseMs: 1000,
});

export type StabilizerInput =
  | { kind: 'absent' }
  | { kind: 'unreliable' }
  | { kind: 'observation'; label: string; confidence: number };

export type StabilizerPhase = 'no_hand' | 'pending' | 'accepted' | 'release_required';

export interface StabilizerDecision {
  phase: StabilizerPhase;
  label: string | null;
  confidence: number;
}

export interface Stabilizer {
  update(input: StabilizerInput, at: number): StabilizerDecision;
  requireRelease(at: number): void;
  reset(): void;
}

interface Observation {
  label: string | null;
  confidence: number;
  at: number;
}

function idleDecision(phase: StabilizerPhase): StabilizerDecision {
  return { phase, label: null, confidence: 0 };
}

export function createStabilizer(config: Partial<StabilizerConfig> = {}): Stabilizer {
  const merged: StabilizerConfig = { ...DEFAULT_STABILIZER_CONFIG, ...config };
  let history: Observation[] = [];
  let lastUpdateAt: number | null = null;
  let releasingSince: number | null = null;
  let locked = false;

  function trim(at: number): void {
    history = history.filter((observation) => at - observation.at <= merged.windowMs);
  }

  function evaluate(): { winner: string | null; accepted: boolean } {
    if (history.length === 0) return { winner: null, accepted: false };
    const counts = new Map<string, number>();
    for (const observation of history) {
      if (observation.label === null) continue;
      counts.set(observation.label, (counts.get(observation.label) ?? 0) + 1);
    }
    let winner: string | null = null;
    let winnerCount = 0;
    for (const [label, count] of counts) {
      if (count > winnerCount) {
        winner = label;
        winnerCount = count;
      }
    }
    if (winner === null) return { winner: null, accepted: false };
    const agreement = winnerCount / history.length;
    const winnerTimes = history
      .filter((observation) => observation.label === winner)
      .map((observation) => observation.at);
    const span = Math.max(...winnerTimes) - Math.min(...winnerTimes);
    const accepted =
      winnerCount >= merged.minObservations &&
      span >= merged.minSpanMs &&
      agreement >= merged.minAgreement;
    return { winner, accepted };
  }

  return {
    update(input: StabilizerInput, at: number): StabilizerDecision {
      const gap = lastUpdateAt !== null && (at <= lastUpdateAt || at - lastUpdateAt > merged.maxGapMs);
      if (locked) {
        if (gap || input.kind !== 'absent') releasingSince = null;
        lastUpdateAt = at;
        if (input.kind === 'absent' && releasingSince === null) releasingSince = at;
        if (input.kind === 'absent' && releasingSince !== null && at - releasingSince >= merged.releaseMs) {
          releasingSince = null;
          locked = false;
          history = [];
          return idleDecision('no_hand');
        }
        return idleDecision('release_required');
      }

      if (gap) history = [];
      lastUpdateAt = at;

      if (input.kind === 'absent') {
        history = [];
        return idleDecision('no_hand');
      }

      if (input.kind === 'unreliable') {
        history.push({ label: null, confidence: 0, at });
        trim(at);
        return idleDecision('pending');
      }

      history.push({ label: input.label, confidence: input.confidence, at });
      trim(at);
      const outcome = evaluate();
      if (outcome.accepted && outcome.winner === input.label) {
        locked = true;
        releasingSince = null;
        history = [];
        return { phase: 'accepted', label: input.label, confidence: input.confidence };
      }
      return { phase: 'pending', label: input.label, confidence: input.confidence };
    },
    requireRelease(at: number): void {
      history = [];
      locked = true;
      releasingSince = null;
      lastUpdateAt = at;
    },
    reset(): void {
      history = [];
      lastUpdateAt = null;
      releasingSince = null;
      locked = false;
    },
  };
}
