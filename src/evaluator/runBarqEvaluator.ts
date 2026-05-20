import fs from "node:fs";
import YAML from "yaml";
import { loadModelConfig, isMockMode } from "../config/loadConfig.js";
import { callOpenAICompatible } from "../providers/openAICompatible.js";
import { ApiMetrics, BarqModelOutput, Manifest, ScoreResult, TaskMatrix } from "../types.js";
import { ensureDir, projectPath, readText, readYaml, writeJson } from "../utils/fs.js";
import { stageBanner, progressLine, skipLine, failLine, summaryTable } from "../utils/logger.js";
import { validateBarqScore } from "./validateBarqScore.js";
import { loadRubric, type Rubric } from "../config/loadRubric.js";

const DEFAULT_BATCH_ID = "batch_20260509";
const MAX_SCORE_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryScoreError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Missing API key env")) {
    return false;
  }

  if (message.includes("Provider")) {
    const statusMatch = message.match(/returned\s+(\d{3})/);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    if (status === 429) return true;
    if (status !== null && status >= 500) return true;
    if (status !== null && status >= 400) return false;
  }

  return (
    message.includes("empty completion") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("Unexpected end of JSON input") ||
    message.includes("Invalid") ||
    message.includes("JSON")
  );
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  return JSON.parse(candidate.trim());
}

interface ScoreMeta {
  task_id: string;
  sample_id: string;
  query_id: string;
  model: string;
  context_level: string;
  context_format: string;
  run_id: string;
  scored_by: string;
}

export function assembleScoreResult(
  output: BarqModelOutput,
  meta: ScoreMeta,
  metrics: ApiMetrics,
): ScoreResult {
  const rubric = loadRubric();
  const dimension_scores: ScoreResult["dimension_scores"] = {};
  let finalScore = 0;

  for (const dimension of rubric.dimensions) {
    const dimOutput = output.dimension_scores[dimension.name]!;
    const weightedScore = Number(((dimOutput.raw_score / rubric.rawScoreMax) * dimension.weight).toFixed(4));
    dimension_scores[dimension.name] = {
      raw_score: dimOutput.raw_score,
      weighted_score: weightedScore,
      reason: dimOutput.reason,
      improvement_suggestion: dimOutput.improvement_suggestion,
    };
    if (dimension.role === "primary") {
      finalScore += weightedScore;
    }
  }

  finalScore = Number(finalScore.toFixed(2));
  return {
    ...meta,
    final_score: finalScore,
    grade: rubric.gradeFor(finalScore),
    dimension_scores,
    overall_comment: output.overall_comment,
    metrics,
  };
}

export function renderRubricForPrompt(rubric: Rubric): string {
  const lines = [
    `评分细则：对下列每个维度给出 0 到 ${rubric.rawScoreMax} 的整数原始分 (raw_score)。` +
      `仅评这些维度，不计算加权分、总分或等级。`,
  ];
  for (const dimension of rubric.dimensions) {
    lines.push("", `## ${dimension.name}`, dimension.description, "评分锚点：");
    for (let score = rubric.rawScoreMax; score >= 0; score -= 1) {
      lines.push(`  ${score}: ${dimension.scale[score]}`);
    }
  }
  return lines.join("\n");
}

export function patchOutputSchema(schemaYamlText: string, rawScoreMax: number): string {
  const schema = YAML.parse(schemaYamlText) as {
    $defs?: { dimension_score?: { properties?: { raw_score?: { maximum?: number } } } };
  };
  const rawScore = schema?.$defs?.dimension_score?.properties?.raw_score;
  if (!rawScore) {
    throw new Error("[output-schema] $defs.dimension_score.properties.raw_score not found");
  }
  rawScore.maximum = rawScoreMax;
  return YAML.stringify(schema);
}

function mockScore(task: TaskMatrix["tasks"][number], scoredBy: string): ScoreResult {
  const rubric = loadRubric();
  const modelOutput: BarqModelOutput = {
    dimension_scores: Object.fromEntries(
      rubric.dimensions.map((dimension) => [
        dimension.name,
        {
          raw_score: Math.round(rubric.rawScoreMax * 0.8),
          reason: `Mock score by ${scoredBy}: ${dimension.name}.`,
          improvement_suggestion: "Set ARD_EVAL_MOCK=0 to run real scoring.",
        },
      ]),
    ),
    overall_comment: `Mock cross-score by ${scoredBy}. Replace ARD_EVAL_MOCK=0 to call the configured scoring model.`,
  };
  return assembleScoreResult(
    modelOutput,
    {
      task_id: task.task_id,
      sample_id: task.sample_id,
      query_id: task.query_id,
      model: task.model,
      context_level: task.context_level,
      context_format: task.context_format,
      run_id: task.run_id,
      scored_by: scoredBy,
    },
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_ms: 0, ttft_ms: 0 },
  );
}

function scorePath(batchId: string, taskId: string, scoredBy: string): string {
  return projectPath("batches", batchId, "evaluation_results", "run_level", `${taskId}__scored_by_${scoredBy}.score.json`);
}

export async function runBarqEvaluator(batchId = DEFAULT_BATCH_ID): Promise<number> {
  const matrix = await readYaml<TaskMatrix>(projectPath("batches", batchId, "task_matrix.yaml"));
  const manifest = await readYaml<Manifest>(projectPath("batches", batchId, "manifest.yaml"));
  const modelConfig = await loadModelConfig();
  const scoringPromptTemplate = await readText(projectPath("prompts", "evaluation", "scoring_prompt.md"));
  const rubricObj = loadRubric();
  const rubric = renderRubricForPrompt(rubricObj);
  const outputSchema = patchOutputSchema(
    await readText(projectPath("benchmark", "scoring_output_schema.yaml")),
    rubricObj.rawScoreMax,
  );
  const scorerNames = manifest.scorers ?? Object.keys(modelConfig.providers);

  await ensureDir(projectPath("batches", batchId, "evaluation_results", "run_level"));

  const reportTasks = matrix.tasks.filter((task) => {
    const reportPath = projectPath(task.output_dir, "report.md");
    return fs.existsSync(reportPath);
  });

  const total = reportTasks.length * scorerNames.length;

  stageBanner("SCORE", `${total} tasks (${reportTasks.length} reports × ${scorerNames.length} scorers: ${scorerNames.join(", ")})`);

  let done = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  const stats = new Map<string, { model: string; done: number; failed: number; skipped: number; totalLatencyMs: number; totalTokens: number }>();
  for (const s of scorerNames) {
    stats.set(s, { model: s, done: 0, failed: 0, skipped: 0, totalLatencyMs: 0, totalTokens: 0 });
  }

  async function scorerGroup(scorerName: string): Promise<void> {
    const provider = modelConfig.providers[scorerName];
    if (!provider) return;

    for (const task of reportTasks) {
      const sp = scorePath(batchId, task.task_id, scorerName);
      const detail = `${task.query_id}/${task.context_level}_${task.context_format}/${task.run_id}`;

      if (fs.existsSync(sp)) {
        skipped += 1;
        done += 1;
        const st = stats.get(scorerName)!;
        st.done += 1;
        st.skipped += 1;
        skipLine({ stage: "score", done, total, model: task.model, detail, scorer: scorerName });
        continue;
      }

      try {
        let score: ScoreResult | undefined;
        let metrics: ApiMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_ms: 0, ttft_ms: 0 };

        if (isMockMode()) {
          score = mockScore(task, scorerName);
        } else {
          const report = await readText(projectPath(task.output_dir, "report.md"));
          const prompt = scoringPromptTemplate
            .replaceAll("{{user_query}}", task.user_query)
            .replaceAll("{{generated_report}}", report)
            .replaceAll("{{scoring_rubric}}", rubric)
            .replaceAll("{{output_schema}}", outputSchema);
          let lastError: unknown;

          for (let attempt = 1; attempt <= MAX_SCORE_ATTEMPTS; attempt += 1) {
            try {
              const result = await callOpenAICompatible({
                providerName: scorerName,
                provider,
                model: provider.models.scoring,
                messages: [{ role: "user", content: prompt }],
              });
              metrics = result.metrics;
              const parsed = extractJson(result.content);
              validateBarqScore(parsed);
              score = assembleScoreResult(
                parsed,
                {
                  task_id: task.task_id,
                  sample_id: task.sample_id,
                  query_id: task.query_id,
                  model: task.model,
                  context_level: task.context_level,
                  context_format: task.context_format,
                  run_id: task.run_id,
                  scored_by: scorerName,
                },
                metrics,
              );
              lastError = undefined;
              break;
            } catch (error) {
              lastError = error;
              if (attempt >= MAX_SCORE_ATTEMPTS || !shouldRetryScoreError(error)) {
                throw error;
              }
              await sleep(1000 * attempt);
            }
          }

          if (lastError) {
            throw lastError;
          }
        }

        if (!score) {
          throw new Error(`Scoring produced no result for ${task.task_id} by ${scorerName}`);
        }

        YAML.stringify(score);
        await writeJson(sp, score);
        done += 1;
        const st = stats.get(scorerName)!;
        st.done += 1;
        st.totalLatencyMs += metrics.latency_ms;
        st.totalTokens += metrics.total_tokens;
        progressLine({ stage: "score", done, total, model: task.model, detail, latencyMs: metrics.latency_ms, ttftMs: metrics.ttft_ms, tokens: metrics.total_tokens, startTime, scorer: scorerName });
      } catch (err) {
        failed += 1;
        done += 1;
        const st = stats.get(scorerName)!;
        st.done += 1;
        st.failed += 1;
        failLine({ stage: "score", done, total, model: task.model, taskId: task.task_id, error: err instanceof Error ? err.message : String(err), scorer: scorerName });
      }
    }
  }

  await Promise.all(scorerNames.map(scorerGroup));

  summaryTable("Score Summary", stats);
  return total - failed;
}
