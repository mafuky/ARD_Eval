import { readFileSync } from "node:fs";
import YAML from "yaml";
import { projectPath } from "../utils/fs.js";

export const CANONICAL_DIMENSIONS = [
  "task_alignment",
  "analytical_depth",
  "business_insight",
  "decision_usefulness",
  "structure_and_communication",
  "risk_and_boundary_awareness",
] as const;

export type DimensionName = (typeof CANONICAL_DIMENSIONS)[number];
export type DimensionRole = "primary" | "sentinel" | "observ";

export interface RubricDimension {
  name: DimensionName;
  weight: number;
  role: DimensionRole;
  description: string;
  scale: Record<number, string>;
}

export interface GradeBand {
  grade: string;
  min: number;
  max: number;
}

export interface Rubric {
  dimensions: RubricDimension[];
  primary: RubricDimension[];
  sentinel: RubricDimension;
  observ: RubricDimension;
  primaryWeightSum: number;
  rawScoreMax: number;
  gradeBands: GradeBand[];
  gradeFor: (finalScore: number) => string;
}

export function parseRubric(yamlText: string): Rubric {
  const doc = (YAML.parse(yamlText) ?? {}) as Record<string, unknown>;
  const dimsRaw = doc.dimensions;
  if (typeof dimsRaw !== "object" || dimsRaw === null) {
    throw new Error("[rubric] missing or invalid `dimensions` block");
  }

  const rawScoreMax = doc.raw_score_max;
  if (typeof rawScoreMax !== "number" || !Number.isInteger(rawScoreMax) || rawScoreMax < 1) {
    throw new Error(`[rubric] raw_score_max must be an integer >= 1, got ${String(rawScoreMax)}`);
  }

  const dimsObj = dimsRaw as Record<
    string,
    { weight?: unknown; role?: unknown; description?: unknown; scale?: unknown }
  >;
  const names = Object.keys(dimsObj);
  const canonical = new Set<string>(CANONICAL_DIMENSIONS);
  const missing = [...canonical].filter((name) => !names.includes(name));
  const unexpected = names.filter((name) => !canonical.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `[rubric] dimension names diverge from canonical set ` +
        `(missing: ${missing.join(",") || "none"}; unexpected: ${unexpected.join(",") || "none"})`,
    );
  }

  const dimensions: RubricDimension[] = CANONICAL_DIMENSIONS.map((name) => {
    const dim = dimsObj[name] ?? {};
    const weight = dim.weight;
    const role = dim.role;
    const description = dim.description;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      throw new Error(`[rubric] ${name}.weight must be a positive number`);
    }
    if (role !== "primary" && role !== "sentinel" && role !== "observ") {
      throw new Error(`[rubric] ${name}.role must be primary|sentinel|observ`);
    }
    if (typeof description !== "string" || description.trim() === "") {
      throw new Error(`[rubric] ${name}.description must be a non-empty string`);
    }
    if (typeof dim.scale !== "object" || dim.scale === null) {
      throw new Error(`[rubric] ${name}.scale must be an object`);
    }
    const scaleRaw = dim.scale as Record<string, unknown>;
    const scale: Record<number, string> = {};
    for (let score = 0; score <= rawScoreMax; score += 1) {
      const anchor = scaleRaw[String(score)];
      if (typeof anchor !== "string" || anchor.trim() === "") {
        throw new Error(`[rubric] ${name}.scale missing anchor for raw_score ${score}`);
      }
      scale[score] = anchor;
    }
    return { name, weight, role, description: description.trim(), scale };
  });

  const primary = dimensions.filter((dimension) => dimension.role === "primary");
  const sentinels = dimensions.filter((dimension) => dimension.role === "sentinel");
  const observs = dimensions.filter((dimension) => dimension.role === "observ");
  if (primary.length !== 4 || sentinels.length !== 1 || observs.length !== 1) {
    throw new Error(
      `[rubric] role composition must be 4 primary + 1 sentinel + 1 observ, got ` +
        `${primary.length} primary / ${sentinels.length} sentinel / ${observs.length} observ`,
    );
  }

  const primaryWeightSum = primary.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (primaryWeightSum !== 100) {
    throw new Error(`[rubric] primary weights must sum to exactly 100, got ${primaryWeightSum}`);
  }

  const gradeMapping = doc.grade_mapping;
  if (typeof gradeMapping !== "object" || gradeMapping === null) {
    throw new Error("[rubric] missing `grade_mapping`");
  }

  const gradeBands: GradeBand[] = Object.entries(gradeMapping as Record<string, { min?: unknown; max?: unknown }>)
    .map(([grade, band]) => {
      if (typeof band?.min !== "number" || typeof band?.max !== "number") {
        throw new Error(`[rubric] grade_mapping.${grade} must have numeric min/max`);
      }
      return { grade, min: band.min, max: band.max };
    })
    .sort((a, b) => b.min - a.min);

  return {
    dimensions,
    primary,
    sentinel: sentinels[0]!,
    observ: observs[0]!,
    primaryWeightSum,
    rawScoreMax,
    gradeBands,
    gradeFor: (finalScore: number) => {
      for (const band of gradeBands) {
        if (finalScore >= band.min) return band.grade;
      }
      return gradeBands[gradeBands.length - 1]!.grade;
    },
  };
}

let cached: Rubric | null = null;

export function loadRubric(): Rubric {
  if (cached) return cached;
  cached = parseRubric(readFileSync(projectPath("benchmark", "scoring_rubric.yaml"), "utf8"));
  return cached;
}
