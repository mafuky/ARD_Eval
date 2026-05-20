import fs from "node:fs";
import YAML from "yaml";
import { loadModelConfig, isMockMode } from "../config/loadConfig.js";
import { callOpenAICompatible } from "../providers/openAICompatible.js";
import { ApiMetrics, ScoreResult, TaskMatrix } from "../types.js";
import { ensureDir, projectPath, readText, readYaml, writeJson } from "../utils/fs.js";
import { stageBanner, progressLine, skipLine, failLine, summaryTable } from "../utils/logger.js";
import { validateBarqScore } from "./validateBarqScore.js";

const DEFAULT_BATCH_ID = "batch_20260509";

function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  return JSON.parse(candidate.trim());
}

function mockScore(task: TaskMatrix["tasks"][number], scoredBy: string): ScoreResult {
  const contextBonus = task.context_level === "augmented" ? 4 : 0;
  const formatBonus = task.context_format === "toon" ? 2 : 0;
  const modelBonus = { openai: 3, gemini: 2, qwen: 1, deepseek: 1 }[task.model] ?? 0;
  const scorerBonus = { openai: 1, gemini: 0, qwen: -1, deepseek: 0 }[scoredBy] ?? 0;
  const finalScore = 78 + contextBonus + formatBonus + modelBonus + scorerBonus;
  const grade = finalScore >= 90 ? "S" : finalScore >= 80 ? "A" : finalScore >= 70 ? "B" : finalScore >= 60 ? "C" : "D";

  return {
    task_id: task.task_id,
    sample_id: task.sample_id,
    query_id: task.query_id,
    model: task.model,
    context_level: task.context_level,
    context_format: task.context_format,
    run_id: task.run_id,
    scored_by: scoredBy,
    final_score: finalScore,
    grade,
    dimension_scores: {
      task_alignment: {
        raw_score: 4,
        weighted_score: 16,
        reason: `Mock score by ${scoredBy}: report responds to the configured user query.`,
        improvement_suggestion: "In real scoring, make the conclusion more explicitly tied to the user query.",
      },
      analytical_depth: {
        raw_score: 4,
        weighted_score: 20,
        reason: `Mock score by ${scoredBy}: analysis has a basic business reasoning chain.`,
        improvement_suggestion: "In real scoring, expand the mechanism between data signals and business implications.",
      },
      business_insight: {
        raw_score: 4,
        weighted_score: 12,
        reason: `Mock score by ${scoredBy}: report provides usable business observations.`,
        improvement_suggestion: "In real scoring, make insights more differentiated and less generic.",
      },
      decision_usefulness: {
        raw_score: 4,
        weighted_score: 20,
        reason: `Mock score by ${scoredBy}: conclusions can support a first-pass decision discussion.`,
        improvement_suggestion: "In real scoring, clarify action priorities and decision conditions.",
      },
      structure_and_communication: {
        raw_score: task.context_format === "toon" ? 5 : 4,
        weighted_score: task.context_format === "toon" ? 10 : 8,
        reason: `Mock score by ${scoredBy}: structure is readable.`,
        improvement_suggestion: "In real scoring, improve section hierarchy and reduce repetition where needed.",
      },
      risk_and_boundary_awareness: {
        raw_score: 3,
        weighted_score: 3,
        reason: `Mock score by ${scoredBy}: risk awareness is present but limited.`,
        improvement_suggestion: "In real scoring, explicitly state assumptions, risks, and analytical boundaries.",
      },
    },
    overall_comment: `Mock cross-score by ${scoredBy}. Replace ARD_EVAL_MOCK=0 to call the configured scoring model.`,
  };
}

function scorePath(batchId: string, taskId: string, scoredBy: string): string {
  return projectPath("batches", batchId, "evaluation_results", "run_level", `${taskId}__scored_by_${scoredBy}.score.json`);
}

export async function runBarqEvaluator(batchId = DEFAULT_BATCH_ID): Promise<number> {
  const matrix = await readYaml<TaskMatrix>(projectPath("batches", batchId, "task_matrix.yaml"));
  const modelConfig = await loadModelConfig();
  const scoringPromptTemplate = await readText(projectPath("prompts", "evaluation", "scoring_prompt.md"));
  const rubric = await readText(projectPath("benchmark", "scoring_rubric.yaml"));
  const outputSchema = await readText(projectPath("benchmark", "scoring_output_schema.yaml"));
  const scorerNames = Object.keys(modelConfig.providers);

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
        let score: ScoreResult;
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
          const result = await callOpenAICompatible({
            providerName: scorerName,
            provider,
            model: provider.models.scoring,
            messages: [{ role: "user", content: prompt }],
          });
          metrics = result.metrics;
          const parsed = extractJson(result.content);
          validateBarqScore(parsed);
          score = {
            task_id: task.task_id,
            sample_id: task.sample_id,
            query_id: task.query_id,
            model: task.model,
            context_level: task.context_level,
            context_format: task.context_format,
            run_id: task.run_id,
            ...parsed,
            scored_by: scorerName,
            metrics,
          };
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
