import { TaskMatrix } from "../types.js";
import { projectPath, readText, readYaml, writeJson } from "../utils/fs.js";

const DEFAULT_BATCH_ID = "batch_20260509";

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export async function buildPayloads(batchId = DEFAULT_BATCH_ID): Promise<number> {
  const matrix = await readYaml<TaskMatrix>(projectPath("batches", batchId, "task_matrix.yaml"));
  const systemPrompt = await readText(projectPath("prompts", "generation", "system_prompt.md"));
  let count = 0;

  for (const task of matrix.tasks) {
    const context = await readText(projectPath(task.context_path));
    const userPromptTemplate = await readText(projectPath(task.prompt_template_path));
    const userPrompt = renderTemplate(userPromptTemplate, {
      query: task.user_query,
      evidences: context,
    });

    await writeJson(projectPath(task.payload_path), {
      task,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });
    count += 1;
  }

  return count;
}
