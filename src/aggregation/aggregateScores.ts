import fs from "node:fs";
import path from "node:path";
import { ScoreResult } from "../types.js";
import { ensureDir, projectPath, readJson, writeText } from "../utils/fs.js";
import { stageBanner } from "../utils/logger.js";

const DEFAULT_BATCH_ID = "batch_20260509";
const DIMENSIONS = [
  "task_alignment",
  "analytical_depth",
  "business_insight",
  "decision_usefulness",
  "structure_and_communication",
  "risk_and_boundary_awareness",
] as const;

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rankBy(scores: ScoreResult[], key: (score: ScoreResult) => string): Array<Record<string, unknown>> {
  const groups = new Map<string, number[]>();
  for (const score of scores) {
    const groupKey = key(score);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), score.final_score]);
  }
  return [...groups.entries()]
    .map(([name, values]) => ({
      name,
      avg_final_score: Number(average(values).toFixed(2)),
      runs: values.length,
    }))
    .sort((a, b) => Number(b.avg_final_score) - Number(a.avg_final_score));
}

function dimensionSummary(scores: ScoreResult[]): Array<Record<string, unknown>> {
  return DIMENSIONS.map((dimension) => {
    const rawScores = scores.map((score) => score.dimension_scores[dimension]?.raw_score ?? 0);
    const weightedScores = scores.map((score) => score.dimension_scores[dimension]?.weighted_score ?? 0);
    return {
      dimension,
      avg_raw_score: Number(average(rawScores).toFixed(2)),
      avg_weighted_score: Number(average(weightedScores).toFixed(2)),
      runs: scores.length,
    };
  }).sort((a, b) => Number(b.avg_weighted_score) - Number(a.avg_weighted_score));
}

function modelConditionSummary(scores: ScoreResult[]): Array<Record<string, unknown>> {
  const groups = new Map<string, ScoreResult[]>();
  for (const score of scores) {
    const key = `${score.model}__${score.context_level}_${score.context_format}`;
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }

  return [...groups.entries()]
    .map(([key, groupScores]) => {
      const [model, condition] = key.split("__");
      return {
        model,
        condition,
        avg_final_score: Number(average(groupScores.map((score) => score.final_score)).toFixed(2)),
        runs: groupScores.length,
        ...Object.fromEntries(
          DIMENSIONS.map((dimension) => [
            dimension,
            Number(
              average(groupScores.map((score) => score.dimension_scores[dimension]?.weighted_score ?? 0)).toFixed(2),
            ),
          ]),
        ),
      };
    })
    .sort((a, b) => Number(b.avg_final_score) - Number(a.avg_final_score));
}

function tokenAndLatencySummary(scores: ScoreResult[]): Array<Record<string, unknown>> {
  const groups = new Map<string, ScoreResult[]>();
  for (const score of scores) {
    groups.set(score.model, [...(groups.get(score.model) ?? []), score]);
  }

  return [...groups.entries()]
    .map(([model, groupScores]) => {
      const m = groupScores.map((s) => s.metrics);
      return {
        model,
        avg_prompt_tokens: Number(average(m.map((x) => x?.prompt_tokens ?? 0)).toFixed(0)),
        avg_completion_tokens: Number(average(m.map((x) => x?.completion_tokens ?? 0)).toFixed(0)),
        avg_total_tokens: Number(average(m.map((x) => x?.total_tokens ?? 0)).toFixed(0)),
        avg_latency_ms: Number(average(m.map((x) => x?.latency_ms ?? 0)).toFixed(0)),
        avg_ttft_ms: Number(average(m.map((x) => x?.ttft_ms ?? 0)).toFixed(0)),
        runs: groupScores.length,
      };
    })
    .sort((a, b) => Number(a.avg_latency_ms) - Number(b.avg_latency_ms));
}

function scorerAgreement(scores: ScoreResult[]): Array<Record<string, unknown>> {
  const groups = new Map<string, ScoreResult[]>();
  for (const score of scores) {
    const key = `${score.model}__${score.scored_by}`;
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }

  return [...groups.entries()]
    .map(([key, groupScores]) => {
      const [model, scorer] = key.split("__");
      return {
        generation_model: model,
        scored_by: scorer,
        avg_final_score: Number(average(groupScores.map((s) => s.final_score)).toFixed(2)),
        runs: groupScores.length,
      };
    })
    .sort((a, b) => {
      const modelCmp = String(a.generation_model).localeCompare(String(b.generation_model));
      if (modelCmp !== 0) return modelCmp;
      return Number(b.avg_final_score) - Number(a.avg_final_score);
    });
}

export async function aggregateScores(batchId = DEFAULT_BATCH_ID): Promise<number> {
  const runLevelDir = projectPath("batches", batchId, "evaluation_results", "run_level");
  const scores: ScoreResult[] = [];

  if (fs.existsSync(runLevelDir)) {
    const files = fs.readdirSync(runLevelDir).filter((f) => f.endsWith(".score.json"));
    stageBanner("AGGREGATE", `${files.length} score files`);
    for (const file of files) {
      scores.push(await readJson<ScoreResult>(path.join(runLevelDir, file)));
    }
  }

  if (scores.length === 0) {
    console.warn("[aggregate] no score files found");
    return 0;
  }

  const aggregatedDir = projectPath("batches", batchId, "evaluation_results", "aggregated");
  await ensureDir(aggregatedDir);

  const allRows = scores.map((score) => ({
    task_id: score.task_id,
    sample_id: score.sample_id,
    query_id: score.query_id,
    model: score.model,
    scored_by: score.scored_by,
    context_level: score.context_level,
    context_format: score.context_format,
    condition: `${score.context_level}_${score.context_format}`,
    run_id: score.run_id,
    final_score: score.final_score,
    grade: score.grade,
    task_alignment: score.dimension_scores.task_alignment?.weighted_score,
    analytical_depth: score.dimension_scores.analytical_depth?.weighted_score,
    business_insight: score.dimension_scores.business_insight?.weighted_score,
    decision_usefulness: score.dimension_scores.decision_usefulness?.weighted_score,
    structure_and_communication: score.dimension_scores.structure_and_communication?.weighted_score,
    risk_and_boundary_awareness: score.dimension_scores.risk_and_boundary_awareness?.weighted_score,
    overall_comment: score.overall_comment,
  }));

  await writeText(path.join(aggregatedDir, "all_scores.csv"), `${toCsv(allRows)}\n`);
  await writeText(path.join(aggregatedDir, "condition_ranking.csv"), `${toCsv(rankBy(scores, (s) => `${s.context_level}_${s.context_format}`))}\n`);
  await writeText(path.join(aggregatedDir, "query_ranking.csv"), `${toCsv(rankBy(scores, (s) => s.query_id))}\n`);
  await writeText(path.join(aggregatedDir, "model_ranking.csv"), `${toCsv(rankBy(scores, (s) => s.model))}\n`);
  await writeText(path.join(aggregatedDir, "context_level_ranking.csv"), `${toCsv(rankBy(scores, (s) => s.context_level))}\n`);
  await writeText(path.join(aggregatedDir, "context_format_ranking.csv"), `${toCsv(rankBy(scores, (s) => s.context_format))}\n`);
  await writeText(path.join(aggregatedDir, "dimension_ranking.csv"), `${toCsv(dimensionSummary(scores))}\n`);
  await writeText(path.join(aggregatedDir, "model_condition_ranking.csv"), `${toCsv(modelConditionSummary(scores))}\n`);
  await writeText(path.join(aggregatedDir, "token_and_latency.csv"), `${toCsv(tokenAndLatencySummary(scores))}\n`);
  await writeText(path.join(aggregatedDir, "scorer_ranking.csv"), `${toCsv(rankBy(scores, (s) => s.scored_by))}\n`);
  await writeText(path.join(aggregatedDir, "scorer_agreement.csv"), `${toCsv(scorerAgreement(scores))}\n`);

  const overall = Number(average(scores.map((score) => score.final_score)).toFixed(2));
  const topCondition = rankBy(scores, (s) => `${s.context_level}_${s.context_format}`)[0];
  const topModel = rankBy(scores, (s) => s.model)[0];
  const scorers = [...new Set(scores.map((s) => s.scored_by))];
  await writeText(
    path.join(aggregatedDir, "summary.md"),
    [
      `# ${batchId} Summary`,
      ``,
      `- Total scores: ${scores.length}`,
      `- Scorers: ${scorers.join(", ")}`,
      `- Average final score: ${overall}`,
      `- Primary metric: final_score`,
      `- Queries evaluated: ${new Set(scores.map((score) => score.query_id)).size}`,
      `- Top condition: ${topCondition?.name ?? "N/A"} (${topCondition?.avg_final_score ?? "N/A"})`,
      `- Top model: ${topModel?.name ?? "N/A"} (${topModel?.avg_final_score ?? "N/A"})`,
      ``,
      `Generated by ARD_Eval BARQ Evaluator aggregation pipeline (cross-scoring).`,
    ].join("\n"),
  );

  return scores.length;
}
