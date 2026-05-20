import fs from "node:fs";
import { loadModelConfig, isMockMode } from "../config/loadConfig.js";
import { callOpenAICompatible } from "../providers/openAICompatible.js";
import { ApiMetrics, TaskMatrix } from "../types.js";
import { ensureDir, projectPath, readJson, readText, readYaml, writeJson, writeText } from "../utils/fs.js";
import { stageBanner, progressLine, skipLine, failLine, summaryTable } from "../utils/logger.js";

const DEFAULT_BATCH_ID = "batch_20260509";

interface Payload {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

function mockReport(taskId: string): string {
  return [
    `# 商业分析报告`,
    ``,
    `## 核心结论`,
    `本报告基于给定上下文生成，用于验证 ARD_Eval pipeline。任务 ID：${taskId}。`,
    ``,
    `## 公司基本面`,
    `贵州茅台以高端白酒生产和销售为核心业务，主要产品包括茅台酒及系列酒。`,
    ``,
    `## 商业启示`,
    `在真实运行中，本段将由目标模型根据 base 或 augmented context 生成。`,
  ].join("\n");
}

export async function runGeneration(batchId = DEFAULT_BATCH_ID): Promise<number> {
  const matrix = await readYaml<TaskMatrix>(projectPath("batches", batchId, "task_matrix.yaml"));
  const modelConfig = await loadModelConfig();
  const models = [...new Set(matrix.tasks.map((t) => t.model))];
  const groups = new Map<string, typeof matrix.tasks>();
  for (const task of matrix.tasks) {
    const list = groups.get(task.model) ?? [];
    list.push(task);
    groups.set(task.model, list);
  }

  stageBanner("GENERATE", `${matrix.tasks.length} tasks, ${models.length} models (${models.join(", ")})`);

  let done = 0;
  let skipped = 0;
  let failed = 0;
  const total = matrix.tasks.length;
  const startTime = Date.now();

  const stats = new Map<string, { model: string; done: number; failed: number; skipped: number; totalLatencyMs: number; totalTokens: number }>();
  for (const m of models) {
    stats.set(m, { model: m, done: 0, failed: 0, skipped: 0, totalLatencyMs: 0, totalTokens: 0 });
  }

  async function runGroup(tasks: typeof matrix.tasks): Promise<void> {
    for (const task of tasks) {
      const reportPath = projectPath(task.output_dir, "report.md");
      const detail = `${task.query_id}/${task.context_level}_${task.context_format}/${task.run_id}`;

      if (fs.existsSync(reportPath)) {
        skipped += 1;
        done += 1;
        const s = stats.get(task.model)!;
        s.done += 1;
        s.skipped += 1;
        skipLine({ stage: "generate", done, total, model: task.model, detail });
        continue;
      }

      try {
        const payload = await readJson<Payload>(projectPath(task.payload_path));
        const provider = modelConfig.providers[task.model];
        if (!provider) {
          throw new Error(`Unknown provider: ${task.model}`);
        }

        let report: string;
        let metrics: ApiMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_ms: 0, ttft_ms: 0 };
        if (isMockMode()) {
          report = mockReport(task.task_id);
        } else {
          const result = await callOpenAICompatible({
            providerName: task.model,
            provider,
            model: provider.models.generation,
            messages: payload.messages,
          });
          report = result.content;
          metrics = result.metrics;
        }

        const outputDir = projectPath(task.output_dir);
        await ensureDir(outputDir);
        await writeText(projectPath(task.output_dir, "report.md"), report);
        await writeJson(projectPath(task.output_dir, "report.json"), {
          task_id: task.task_id,
          report,
        });
        await writeJson(projectPath(task.output_dir, "generation_trace.json"), {
          task_id: task.task_id,
          provider: task.model,
          model: provider.models.generation,
          mock: isMockMode(),
          context_path: task.context_path,
          prompt_template_path: task.prompt_template_path,
          system_prompt_path: "prompts/generation/system_prompt.md",
          metrics,
        });

        await readText(projectPath(task.output_dir, "report.md"));
        done += 1;
        const s = stats.get(task.model)!;
        s.done += 1;
        s.totalLatencyMs += metrics.latency_ms;
        s.totalTokens += metrics.total_tokens;
        progressLine({ stage: "generate", done, total, model: task.model, detail, latencyMs: metrics.latency_ms, ttftMs: metrics.ttft_ms, tokens: metrics.total_tokens, startTime });
      } catch (err) {
        failed += 1;
        done += 1;
        const s = stats.get(task.model)!;
        s.done += 1;
        s.failed += 1;
        failLine({ stage: "generate", done, total, model: task.model, taskId: task.task_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all([...groups.values()].map(runGroup));

  summaryTable("Generate Summary", stats);
  return total - failed;
}
