import { BarqModelOutput } from "../types.js";
import { loadRubric } from "../config/loadRubric.js";

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

export function validateBarqScore(value: unknown): asserts value is BarqModelOutput {
  const rubric = loadRubric();
  const dimensions = rubric.dimensions.map((dimension) => dimension.name);

  if (!isObject(value)) {
    throw new Error("BARQ score must be an object");
  }

  assertNoExtraKeys(value, ["dimension_scores", "overall_comment"], "score");
  assertString(value.overall_comment, "score.overall_comment");

  if (!isObject(value.dimension_scores)) {
    throw new Error("score.dimension_scores must be an object");
  }
  assertNoExtraKeys(value.dimension_scores, dimensions, "score.dimension_scores");

  for (const dimension of dimensions) {
    const dimensionScore = value.dimension_scores[dimension];
    if (!isObject(dimensionScore)) {
      throw new Error(`score.dimension_scores.${dimension} must be an object`);
    }
    assertNoExtraKeys(
      dimensionScore,
      ["raw_score", "reason", "improvement_suggestion"],
      `score.dimension_scores.${dimension}`,
    );
    assertInteger(dimensionScore.raw_score, `score.dimension_scores.${dimension}.raw_score`, 0, rubric.rawScoreMax);
    assertString(dimensionScore.reason, `score.dimension_scores.${dimension}.reason`);
    assertString(
      dimensionScore.improvement_suggestion,
      `score.dimension_scores.${dimension}.improvement_suggestion`,
    );
  }
}
