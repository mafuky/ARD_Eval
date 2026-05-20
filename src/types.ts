export interface ApiMetrics {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  ttft_ms: number;
}

export type ContextLevel = "base" | "augmented" | string;
export type ContextFormat = "json" | "toon" | string;

export interface ProviderConfig {
  label: string;
  base_url: string;
  api_key_env: string;
  models: {
    generation: string;
    scoring: string;
  };
}

export interface ModelConfig {
  providers: Record<string, ProviderConfig>;
}

export interface Manifest {
  batch_id: string;
  experiment_name: string;
  experiment_type: string;
  sample_scope: string[];
  query_set_path?: string;
  query_set_paths?: Record<string, string>;
  scorers?: string[];
  factors: {
    context_level: ContextLevel[];
    context_format: ContextFormat[];
    model: string[];
    run: string[];
  };
}

export interface QueryItem {
  query_id: string;
  query: string;
}

export interface QuerySet {
  query_set_id: string;
  sample_id: string;
  description?: string;
  queries: QueryItem[];
}

export interface Task {
  task_id: string;
  batch_id: string;
  sample_id: string;
  query_id: string;
  user_query: string;
  model: string;
  context_level: ContextLevel;
  context_format: ContextFormat;
  run_id: string;
  context_path: string;
  prompt_template_path: string;
  payload_path: string;
  output_dir: string;
  score_path: string;
}

export interface TaskMatrix {
  batch_id: string;
  tasks: Task[];
}

export interface BarqDimensionOutput {
  raw_score: number;
  reason: string;
  improvement_suggestion: string;
}

export interface BarqModelOutput {
  dimension_scores: Record<string, BarqDimensionOutput>;
  overall_comment: string;
}

export interface ScoreResult {
  task_id: string;
  sample_id: string;
  query_id: string;
  model: string;
  context_level: string;
  context_format: string;
  run_id: string;
  final_score: number;
  grade: string;
  dimension_scores: Record<
    string,
    {
      raw_score: number;
      weighted_score: number;
      reason: string;
      improvement_suggestion: string;
    }
  >;
  overall_comment: string;
  scored_by: string;
  metrics?: ApiMetrics;
}
