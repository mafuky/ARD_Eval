import chalk from "chalk";
import Table from "cli-table3";

const MODEL_COLORS: Record<string, (s: string) => string> = {
  openai: chalk.green,
  gemini: chalk.blue,
  qwen: chalk.yellow,
  deepseek: chalk.cyan,
};

function colorModel(name: string): string {
  return (MODEL_COLORS[name] ?? chalk.white)(name);
}

export function stageBanner(stage: string, detail: string): void {
  const stageColors: Record<string, (s: string) => string> = {
    MATRIX: chalk.gray,
    PAYLOADS: chalk.gray,
    GENERATE: chalk.cyanBright,
    SCORE: chalk.magentaBright,
    AGGREGATE: chalk.yellowBright,
    PIPELINE: chalk.bold.white,
  };
  const color = stageColors[stage] ?? chalk.white;
  console.log("");
  console.log(color(`━━━ ${stage} ━━━  ${detail}  ━━━`));
  console.log("");
}

export function progressLine(opts: {
  stage: string;
  done: number;
  total: number;
  model: string;
  detail: string;
  latencyMs: number;
  ttftMs: number;
  tokens: number;
  startTime: number;
  scorer?: string;
}): void {
  const pct = Math.round((opts.done / opts.total) * 100);
  const filled = Math.round(pct / 5);
  const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(20 - filled));
  const pctStr = chalk.bold(`${pct}%`.padStart(4));
  const count = chalk.gray(`(${opts.done}/${opts.total})`);
  const latency = chalk.white(`${(opts.latencyMs / 1000).toFixed(1)}s`);
  const ttft = chalk.gray(`ttft:${(opts.ttftMs / 1000).toFixed(1)}s`);
  const tok = chalk.gray(`${opts.tokens}tok`);

  const elapsed = Date.now() - opts.startTime;
  const avgPerTask = elapsed / opts.done;
  const remaining = Math.round((avgPerTask * (opts.total - opts.done)) / 1000);
  const eta = remaining > 60 ? `${Math.floor(remaining / 60)}m${remaining % 60}s` : `${remaining}s`;
  const etaStr = chalk.gray(`ETA:${eta}`);

  const stageTag = opts.stage === "generate"
    ? chalk.cyanBright(`[generate]`)
    : chalk.magentaBright(`[score]   `);

  const modelStr = opts.scorer
    ? `${colorModel(opts.scorer)} ${chalk.gray("→")} ${colorModel(opts.model)}`
    : colorModel(opts.model);

  console.log(`${stageTag} ${bar} ${pctStr} ${count} ${modelStr} ${chalk.gray("←")} ${chalk.gray(opts.detail)}  ${latency} ${ttft} ${tok}  ${etaStr}`);
}

export function skipLine(opts: {
  stage: string;
  done: number;
  total: number;
  model: string;
  detail: string;
  scorer?: string;
}): void {
  const stageTag = opts.stage === "generate"
    ? chalk.cyanBright(`[generate]`)
    : chalk.magentaBright(`[score]   `);
  const modelStr = opts.scorer
    ? `${colorModel(opts.scorer)} ${chalk.gray("→")} ${colorModel(opts.model)}`
    : colorModel(opts.model);
  console.log(`${stageTag} ${chalk.gray("skip")} ${chalk.gray(`(${opts.done}/${opts.total})`)} ${modelStr} ${chalk.gray("←")} ${chalk.gray(opts.detail)}`);
}

export function failLine(opts: {
  stage: string;
  done: number;
  total: number;
  model: string;
  taskId: string;
  error: string;
  scorer?: string;
}): void {
  const stageTag = opts.stage === "generate"
    ? chalk.cyanBright(`[generate]`)
    : chalk.magentaBright(`[score]   `);
  const modelStr = opts.scorer
    ? `${colorModel(opts.scorer)} ${chalk.gray("→")} ${colorModel(opts.model)}`
    : colorModel(opts.model);
  console.log(`${stageTag} ${chalk.red.bold("FAIL")} ${chalk.gray(`(${opts.done}/${opts.total})`)} ${modelStr} ${chalk.gray("←")} ${chalk.red(opts.error)}`);
}

interface StageStats {
  model: string;
  done: number;
  failed: number;
  skipped: number;
  totalLatencyMs: number;
  totalTokens: number;
}

export function summaryTable(title: string, stats: Map<string, StageStats>): void {
  const table = new Table({
    head: [chalk.bold("Model"), chalk.bold("Done"), chalk.bold("Skip"), chalk.bold("Fail"), chalk.bold("Avg Time"), chalk.bold("Avg Tok")],
    style: { head: [], border: [] },
  });

  let totalDone = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const [, s] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const completed = s.done - s.skipped - s.failed;
    const avgTime = completed > 0 ? `${(s.totalLatencyMs / completed / 1000).toFixed(1)}s` : "-";
    const avgTok = completed > 0 ? Math.round(s.totalTokens / completed).toString() : "-";
    table.push([
      colorModel(s.model),
      chalk.green(String(s.done)),
      chalk.gray(String(s.skipped)),
      s.failed > 0 ? chalk.red(String(s.failed)) : chalk.gray("0"),
      avgTime,
      avgTok,
    ]);
    totalDone += s.done;
    totalFailed += s.failed;
    totalSkipped += s.skipped;
  }

  table.push([
    chalk.bold("Total"),
    chalk.bold.green(String(totalDone)),
    chalk.bold.gray(String(totalSkipped)),
    totalFailed > 0 ? chalk.bold.red(String(totalFailed)) : chalk.bold.gray("0"),
    "",
    "",
  ]);

  console.log("");
  console.log(chalk.bold(title));
  console.log(table.toString());
  console.log("");
}
