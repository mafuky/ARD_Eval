import { ScoreResult } from "../types.js";
import { CANONICAL_DIMENSIONS } from "../config/loadRubric.js";

export const PAIRING_DIMENSIONS = CANONICAL_DIMENSIONS;

export type DeltaDimension = (typeof PAIRING_DIMENSIONS)[number];

const ANCHOR_LEVEL = "base";
const GROUP_FIELDS = [
  "sample_id",
  "query_id",
  "model",
  "context_format",
  "run_id",
  "scored_by",
] as const;

export interface PairDelta {
  sample_id: string;
  query_id: string;
  model: string;
  context_format: string;
  run_id: string;
  scored_by: string;
  arm: string;
  base_final_score: number;
  arm_final_score: number;
  delta_final_score: number;
  delta_dimensions: Record<DeltaDimension, number>;
}

export type SkipReason = "missing_anchor" | "multiple_anchors";

export interface SkippedGroup {
  group_key: string;
  reason: SkipReason;
  record_count: number;
  anchor_count: number;
  context_levels: string[];
}

export interface PairingResult {
  pairs: PairDelta[];
  skipped: SkippedGroup[];
  total_groups: number;
  paired_groups: number;
}

function groupKey(score: ScoreResult): string {
  return GROUP_FIELDS.map((field) => String(score[field] ?? "")).join(" | ");
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

export function buildPairs(scores: ScoreResult[]): PairingResult {
  const groups = new Map<string, ScoreResult[]>();
  for (const score of scores) {
    const key = groupKey(score);
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }

  const pairs: PairDelta[] = [];
  const skipped: SkippedGroup[] = [];
  let pairedGroups = 0;

  for (const [key, members] of groups) {
    const contextLevels = [...new Set(members.map((member) => member.context_level))];
    const anchors = members.filter((member) => member.context_level === ANCHOR_LEVEL);

    if (anchors.length === 0) {
      console.warn(
        `[pairing] SKIP group { ${key} }: no "${ANCHOR_LEVEL}" anchor ` +
          `(${members.length} record(s), levels: ${contextLevels.join(", ")})`,
      );
      skipped.push({
        group_key: key,
        reason: "missing_anchor",
        record_count: members.length,
        anchor_count: 0,
        context_levels: contextLevels,
      });
      continue;
    }

    if (anchors.length > 1) {
      console.warn(
        `[pairing] SKIP group { ${key} }: ${anchors.length} "${ANCHOR_LEVEL}" anchors, ` +
          `expected exactly 1 (${members.length} record(s), levels: ${contextLevels.join(", ")})`,
      );
      skipped.push({
        group_key: key,
        reason: "multiple_anchors",
        record_count: members.length,
        anchor_count: anchors.length,
        context_levels: contextLevels,
      });
      continue;
    }

    const base = anchors[0]!;
    const arms = members.filter((member) => member.context_level !== ANCHOR_LEVEL);
    if (arms.length === 0) continue;

    for (const arm of arms) {
      const deltaDimensions = {} as Record<DeltaDimension, number>;
      for (const dimension of PAIRING_DIMENSIONS) {
        const armWeighted = arm.dimension_scores[dimension]?.weighted_score ?? 0;
        const baseWeighted = base.dimension_scores[dimension]?.weighted_score ?? 0;
        deltaDimensions[dimension] = round4(armWeighted - baseWeighted);
      }

      pairs.push({
        sample_id: arm.sample_id,
        query_id: arm.query_id,
        model: arm.model,
        context_format: arm.context_format,
        run_id: arm.run_id,
        scored_by: arm.scored_by,
        arm: arm.context_level,
        base_final_score: base.final_score,
        arm_final_score: arm.final_score,
        delta_final_score: round4(arm.final_score - base.final_score),
        delta_dimensions: deltaDimensions,
      });
    }

    pairedGroups += 1;
  }

  return {
    pairs,
    skipped,
    total_groups: groups.size,
    paired_groups: pairedGroups,
  };
}
