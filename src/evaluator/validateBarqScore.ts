import { ScoreResult } from "../types.js";

const DIMENSIONS = [
  "task_alignment",
  "analytical_depth",
  "business_insight",
  "decision_usefulness",
  "structure_and_communication",
  "risk_and_boundary_awareness",
] as const;

const GRADES = new Set(["S", "A", "B", "C", "D"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoExtraKeys(value: Record<string, unknown>, allowedKeys: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${path} has unexpected key: ${key}`);
    }
  }
}

function assertNumber(value: unknown, path: string, min: number, max: number): void {
  if (typeof value !== "number" || Number.isNaN(value) || value < min || value > max) {
    throw new Error(`${path} must be a number between ${min} and ${max}`);
  }
}

function assertInteger(value: unknown, path: string, min: number, max: number): void {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}`);
  }
}

function assertString(value: unknown, path: string): void {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

export function validateBarqScore(value: unknown): asserts value is Omit<
  ScoreResult,
  "task_id" | "sample_id" | "query_id" | "model" | "context_level" | "context_format" | "run_id" | "scored_by"
> {
  if (!isObject(value)) {
    throw new Error("BARQ score must be an object");
  }

  assertNoExtraKeys(value, ["dimension_scores", "final_score", "grade", "overall_comment"], "score");
  assertNumber(value.final_score, "score.final_score", 0, 100);
  const grade = value.grade;
  assertString(grade, "score.grade");
  if (!GRADES.has(grade as string)) {
    throw new Error("score.grade must be one of S, A, B, C, D");
  }
  assertString(value.overall_comment, "score.overall_comment");

  if (!isObject(value.dimension_scores)) {
    throw new Error("score.dimension_scores must be an object");
  }
  assertNoExtraKeys(value.dimension_scores, [...DIMENSIONS], "score.dimension_scores");

  for (const dimension of DIMENSIONS) {
    const dimensionScore = value.dimension_scores[dimension];
    if (!isObject(dimensionScore)) {
      throw new Error(`score.dimension_scores.${dimension} must be an object`);
    }
    assertNoExtraKeys(
      dimensionScore,
      ["raw_score", "weighted_score", "reason", "improvement_suggestion"],
      `score.dimension_scores.${dimension}`,
    );
    assertInteger(dimensionScore.raw_score, `score.dimension_scores.${dimension}.raw_score`, 0, 5);
    assertNumber(dimensionScore.weighted_score, `score.dimension_scores.${dimension}.weighted_score`, 0, 25);
    assertString(dimensionScore.reason, `score.dimension_scores.${dimension}.reason`);
    assertString(
      dimensionScore.improvement_suggestion,
      `score.dimension_scores.${dimension}.improvement_suggestion`,
    );
  }
}
