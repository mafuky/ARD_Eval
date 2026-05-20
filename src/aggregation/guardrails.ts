import { PairDelta } from "./pairing.js";

const ZERO_EPS = 1e-9;
const DEFAULT_SENTINEL_TOLERANCE = 2;

export interface DirectionRangeStat {
  arm: string;
  n: number;
  positive: number;
  negative: number;
  zero: number;
  dominant_direction: "positive" | "negative" | "none";
  same_direction_ratio: number;
  min_delta: number;
  max_delta: number;
  range: number;
  mean_delta: number;
}

export interface SentinelStat extends DirectionRangeStat {
  tolerance: number;
  verdict: "clean" | "contaminated";
}

export interface GuardrailReport {
  direction_range: DirectionRangeStat[];
  sentinel: SentinelStat[];
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function summarize(arm: string, deltas: number[]): DirectionRangeStat {
  const n = deltas.length;
  let positive = 0;
  let negative = 0;
  let zero = 0;

  for (const delta of deltas) {
    if (delta > ZERO_EPS) positive += 1;
    else if (delta < -ZERO_EPS) negative += 1;
    else zero += 1;
  }

  const dominant = Math.max(positive, negative);
  const dominant_direction =
    positive === negative ? "none" : positive > negative ? "positive" : "negative";
  const min_delta = n > 0 ? Math.min(...deltas) : 0;
  const max_delta = n > 0 ? Math.max(...deltas) : 0;
  const mean_delta = n > 0 ? deltas.reduce((sum, delta) => sum + delta, 0) / n : 0;

  return {
    arm,
    n,
    positive,
    negative,
    zero,
    dominant_direction,
    same_direction_ratio: n > 0 ? round4(dominant / n) : 0,
    min_delta: round4(min_delta),
    max_delta: round4(max_delta),
    range: round4(max_delta - min_delta),
    mean_delta: round4(mean_delta),
  };
}

function groupByArm(pairs: PairDelta[]): Map<string, PairDelta[]> {
  const groups = new Map<string, PairDelta[]>();
  for (const pair of pairs) {
    groups.set(pair.arm, [...(groups.get(pair.arm) ?? []), pair]);
  }
  return groups;
}

export function computeGuardrails(
  pairs: PairDelta[],
  sentinelTolerance = Number(process.env.ARD_EVAL_SENTINEL_TOL ?? String(DEFAULT_SENTINEL_TOLERANCE)),
): GuardrailReport {
  const groups = [...groupByArm(pairs).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const direction_range: DirectionRangeStat[] = [];
  const sentinel: SentinelStat[] = [];

  for (const [arm, armPairs] of groups) {
    direction_range.push(summarize(arm, armPairs.map((pair) => pair.delta_final_score)));

    const structureStat = summarize(
      arm,
      armPairs.map((pair) => pair.delta_dimensions.structure_and_communication ?? 0),
    );
    sentinel.push({
      ...structureStat,
      tolerance: sentinelTolerance,
      verdict: Math.abs(structureStat.mean_delta) <= sentinelTolerance ? "clean" : "contaminated",
    });
  }

  return { direction_range, sentinel };
}
