import chalk from "chalk";
import { aggregateScores } from "./aggregation/aggregateScores.js";
import { buildTaskMatrix } from "./matrix/buildTaskMatrix.js";
import { buildPayloads } from "./payload/buildPayloads.js";
import { runGeneration } from "./generation/runGeneration.js";
import { runBarqEvaluator } from "./evaluator/runBarqEvaluator.js";

const command = process.argv[2];
const batchId = process.argv[3] ?? "batch_20260509";

async function main(): Promise<void> {
  switch (command) {
    case "matrix": {
      const matrix = await buildTaskMatrix(batchId);
      console.log(`Built ${matrix.tasks.length} tasks for ${batchId}`);
      break;
    }
    case "payloads": {
      const count = await buildPayloads(batchId);
      console.log(`Built ${count} payloads for ${batchId}`);
      break;
    }
    case "generate": {
      const count = await runGeneration(batchId);
      console.log(`Generated ${count} reports for ${batchId}`);
      break;
    }
    case "score": {
      const count = await runBarqEvaluator(batchId);
      console.log(`Scored ${count} reports for ${batchId}`);
      break;
    }
    case "evaluate": {
      const count = await runBarqEvaluator(batchId);
      console.log(`Evaluated ${count} reports with BARQ for ${batchId}`);
      break;
    }
    case "aggregate": {
      const count = await aggregateScores(batchId);
      console.log(`Aggregated ${count} scores for ${batchId}`);
      break;
    }
    case "pipeline": {
      const pipelineStart = Date.now();
      console.log(chalk.bold.white("\n╔══════════════════════════════════════╗"));
      console.log(chalk.bold.white(`║  ARD_Eval Pipeline — ${batchId}  ║`));
      console.log(chalk.bold.white("╚══════════════════════════════════════╝"));
      const matrix = await buildTaskMatrix(batchId);
      console.log(chalk.gray(`Built ${matrix.tasks.length} tasks`));
      console.log(chalk.gray(`Built ${await buildPayloads(batchId)} payloads`));
      console.log(`Generated ${await runGeneration(batchId)} reports`);
      console.log(`Evaluated ${await runBarqEvaluator(batchId)} reports with BARQ`);
      console.log(`Aggregated ${await aggregateScores(batchId)} scores`);
      const elapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
      console.log(chalk.bold.green(`\n✓ Pipeline complete in ${elapsed}s`));
      break;
    }
    default:
      console.log("Usage: npm run <matrix|payloads|generate|score|evaluate|aggregate|pipeline> [batch_id]");
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
