import path from "node:path";
import fs from "node:fs";
import { Manifest, QuerySet, Task, TaskMatrix } from "../types.js";
import { projectPath, readYaml, toPosix, writeYaml } from "../utils/fs.js";

const DEFAULT_BATCH_ID = "batch_20260509";

function resolveQuerySetPath(manifest: Manifest, sampleId: string): string {
  const sampleSpecificPath = manifest.query_set_paths?.[sampleId];
  if (sampleSpecificPath) {
    return sampleSpecificPath;
  }

  if (manifest.query_set_path) {
    return manifest.query_set_path;
  }

  throw new Error(
    `Missing query set for sample ${sampleId}. Set manifest.query_set_path or manifest.query_set_paths.${sampleId}.`,
  );
}

function resolveContextPath(sampleId: string, contextLevel: string, contextFormat: string): string {
  const armNamedPath = path.join(
    "samples",
    sampleId,
    "contexts",
    contextLevel,
    `${contextLevel}.${contextFormat}`,
  );
  if (fs.existsSync(projectPath(armNamedPath))) {
    return armNamedPath;
  }

  return path.join("samples", sampleId, "contexts", contextLevel, contextFormat, `context.${contextFormat}`);
}

export async function buildTaskMatrix(batchId = DEFAULT_BATCH_ID): Promise<TaskMatrix> {
  const manifestPath = projectPath("batches", batchId, "manifest.yaml");
  const manifest = await readYaml<Manifest>(manifestPath);
  const tasks: Task[] = [];

  for (const sampleId of manifest.sample_scope) {
    const querySetPath = resolveQuerySetPath(manifest, sampleId);
    const querySet = await readYaml<QuerySet>(projectPath(querySetPath));
    if (querySet.sample_id && querySet.sample_id !== sampleId) {
      throw new Error(
        `Query set sample_id mismatch for ${sampleId}: ${querySetPath} declares ${querySet.sample_id}.`,
      );
    }

    for (const query of querySet.queries) {
      for (const model of manifest.factors.model) {
        for (const contextLevel of manifest.factors.context_level) {
          for (const contextFormat of manifest.factors.context_format) {
            for (const runId of manifest.factors.run) {
              const condition = `${contextLevel}_${contextFormat}`;
              const taskId = `${sampleId}__${query.query_id}__${model}__${contextLevel}__${contextFormat}__${runId}`;
              const outputDir = path.join(
                "batches",
                batchId,
                "generation_outputs",
                sampleId,
                query.query_id,
                model,
                condition,
                runId,
              );
              const scorePath = path.join(
                "batches",
                batchId,
                "evaluation_results",
                "run_level",
                `${taskId}.score.json`,
              );

              tasks.push({
                task_id: taskId,
                batch_id: batchId,
                sample_id: sampleId,
                query_id: query.query_id,
                user_query: query.query,
                model,
                context_level: contextLevel,
                context_format: contextFormat,
                run_id: runId,
                context_path: toPosix(resolveContextPath(sampleId, contextLevel, contextFormat)),
                prompt_template_path: "prompts/generation/user_prompt.md",
                payload_path: toPosix(
                  path.join("batches", batchId, "generation_tasks", "payloads", `${taskId}.input.json`),
                ),
                output_dir: toPosix(outputDir),
                score_path: toPosix(scorePath),
              });
            }
          }
        }
      }
    }
  }

  const matrix: TaskMatrix = {
    batch_id: batchId,
    tasks,
  };

  await writeYaml(projectPath("batches", batchId, "task_matrix.yaml"), matrix);
  return matrix;
}
