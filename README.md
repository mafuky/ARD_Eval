# ARD_Eval

`ARD_Eval` 是一个 TypeScript 评测项目，用来比较不同上下文数据形态对商业分析报告生成质量的影响。

当前版本的核心目标：

```text
同一组商业分析问题
+ 不同模型
+ 不同数据版本
+ BARQ 评级器
-> 生成报告质量横向比较
```

## 当前实验设计

当前样本是：

```text
enterprise_maotai_001
```

当前问题集文件：

[samples/enterprise_maotai_001/queries/query_set.yaml](samples/enterprise_maotai_001/queries/query_set.yaml)

问题集包含 8 个问题，分为三类：

```text
3 个 positive：增长亮点、经营优势、渠道机会
3 个 negative：利润压力、结构风险、现金流质量审慎分析
2 个 balanced：综合平衡分析、决策支持判断
```

当前比较 4 种上下文数据条件：

```text
base + json        = Non-ARD JSON
base + toon        = Non-ARD TOON
augmented + json   = ARD JSON
augmented + toon   = ARD TOON
```

当前比较 4 个模型供应商：

```text
openai
gemini
qwen
deepseek
```

当前每个条件重复 3 次：

```text
run_01
run_02
run_03
```

所以当前完整任务规模为：

```text
8 个问题 × 4 个模型 × 4 种上下文条件 × 3 次运行 = 384 篇报告
```

## 生成提示词

生成阶段严格使用用户提供的两段式提示词：

```text
prompts/generation/system_prompt.md
prompts/generation/user_prompt.md
```

`user_prompt.md` 只有两个变量：

```text
{{query}}
{{evidences}}
```

变量来源：

```text
{{query}}     = query_set.yaml 中的单条问题
{{evidences}} = 当前任务对应的上下文文件内容
```

生成阶段会使用上下文数据。评分阶段不会直接使用上下文数据。

## BARQ 评级器

当前基准测试是：

```text
BARQ_v1 = Business Analysis Report Quality Benchmark
```

BARQ 的评分输入只有：

```text
user_query
generated_report
scoring_rubric
scoring_output_schema
```

BARQ 评分阶段不使用：

```text
原始上下文数据
外部搜索
论断抽取
证据匹配
黄金证据
参考答案
```

BARQ 评分维度：

```text
task_alignment
analytical_depth
business_insight
decision_usefulness
structure_and_communication
risk_and_boundary_awareness
```

每篇报告会得到：

```text
final_score
grade
dimension_scores
overall_comment
```

每个维度会得到：

```text
raw_score
weighted_score
reason
improvement_suggestion
```

核心文件：

```text
benchmark/benchmark_definition.yaml
benchmark/scoring_rubric.yaml
benchmark/scoring_output_schema.yaml
prompts/evaluation/scoring_prompt.md
src/evaluator/
```

## 目录说明

```text
config/      全局配置：模型、生成参数、基准测试信息、评分规则
samples/     样本数据、ARD / Non-ARD 上下文、问题集
prompts/     生成提示词和 BARQ 评分提示词
benchmark/   BARQ 基准测试、评分细则、输出结构
batches/     每次运行产生的任务矩阵、报告、评分和汇总结果
src/         TypeScript 流水线代码
```

详细说明：

- [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)
- [docs/CONFIG_GUIDE.md](docs/CONFIG_GUIDE.md)
- [docs/FLOW_MERMAID.md](docs/FLOW_MERMAID.md)

## 快速开始

安装依赖：

```bash
npm install
```

准备环境变量：

```bash
cp .env.example .env
```

如果只是验证流程，不调用真实模型，使用模拟模式：

```text
ARD_EVAL_MOCK=1
```

运行完整流水线：

```bash
npm run pipeline
```

当前模拟流程会生成并评估 384 个任务。

## 常用命令

```bash
npm run matrix      # 根据 manifest 和 query_set 生成 task_matrix.yaml
npm run payloads    # 为每个 task 生成模型输入 payload
npm run generate    # 生成商业分析报告
npm run evaluate    # 使用 BARQ 评级器评级
npm run score       # evaluate 的别名
npm run aggregate   # 汇总评分结果
npm run pipeline    # 依次执行 matrix -> payloads -> generate -> evaluate -> aggregate
```

当前脚本会先执行 TypeScript build，再运行 `dist/cli.js`，避免 `tsx` 在部分环境中的临时 pipe 权限问题。

## 输出结果

单篇报告输出：

```text
batches/batch_20260509/generation_outputs/
```

单篇 BARQ 评分：

```text
batches/batch_20260509/evaluation_results/run_level/
```

汇总结果：

```text
batches/batch_20260509/evaluation_results/aggregated/
```

当前会生成：

```text
all_scores.csv
query_ranking.csv
polarity_ranking.csv
condition_ranking.csv
model_ranking.csv
context_level_ranking.csv
context_format_ranking.csv
dimension_ranking.csv
model_condition_ranking.csv
summary.md
```

这些表分别回答：

```text
all_scores.csv              所有单次报告评分明细
query_ranking.csv           哪些问题整体得分更高
polarity_ranking.csv        正面 / 反面 / 综合问题哪类表现更好
condition_ranking.csv       base_json / base_toon / augmented_json / augmented_toon 哪个更好
model_ranking.csv           哪个模型整体最好
context_level_ranking.csv   ARD 是否整体优于 Non-ARD
context_format_ranking.csv  TOON 是否整体优于 JSON
dimension_ranking.csv       BARQ 六个维度的平均表现
model_condition_ranking.csv 模型 × 数据条件的交叉排名
summary.md                  本批实验摘要
```

## 真实运行

真实运行需要在 `.env` 中配置 API Key，并关闭模拟模式：

```text
OPENAI_API_KEY=
GEMINI_API_KEY=
DASHSCOPE_API_KEY=
DEEPSEEK_API_KEY=
ARD_EVAL_MOCK=0
```

如果只想先测某一个模型，可以在：

```text
batches/batch_20260509/manifest.yaml
```

里临时减少 `factors.model`。

如果想降低成本，可以在：

```text
config/generation_config.yaml
```

或 batch manifest 中把 run 减少到：

```text
run_01
```

## 当前状态

当前项目已经完成：

```text
四份数据接入
8 条正反综合问题集
生成提示词接入
BARQ 基准测试接入
评分输出结构接入
BARQ 评级器模块
模拟流程 384 任务跑通
```

真实实验结论需要在配置 API Key 后运行真实模型生成和真实 BARQ 评级。
