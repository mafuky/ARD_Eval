import { ApiMetrics, ProviderConfig } from "../types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  providerName: string;
  provider: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResult {
  content: string;
  metrics: ApiMetrics;
}

interface StreamChunkDelta {
  content?: string;
}

interface StreamChunkChoice {
  delta?: StreamChunkDelta;
}

interface StreamChunkUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface StreamChunk {
  choices?: StreamChunkChoice[];
  usage?: StreamChunkUsage;
}

async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  startTime: number,
): Promise<{ content: string; metrics: ApiMetrics }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let ttft = 0;
  let usage: StreamChunkUsage = {};

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        if (ttft === 0) {
          ttft = Date.now() - startTime;
        }
        content += delta;
      }

      if (chunk.usage) {
        usage = chunk.usage;
      }
    }
  }

  const latency = Date.now() - startTime;

  return {
    content,
    metrics: {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      latency_ms: latency,
      ttft_ms: ttft,
    },
  };
}

export async function callOpenAICompatible(options: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env[options.provider.api_key_env];
  if (!apiKey) {
    throw new Error(`Missing API key env ${options.provider.api_key_env} for provider ${options.providerName}`);
  }

  const tokenLimit =
    options.model.startsWith("gpt-5")
      ? { max_completion_tokens: options.maxTokens ?? 6000 }
      : { max_tokens: options.maxTokens ?? 6000 };
  const temperature =
    options.model.startsWith("gpt-5") || options.model.startsWith("kimi-k2")
      ? {}
      : { temperature: options.temperature ?? 0.2 };

  let baseUrl = options.provider.base_url;
  if (process.env[baseUrl]) {
    baseUrl = process.env[baseUrl]!;
  }
  baseUrl = baseUrl.replace(/\/$/, "");
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

  const startTime = Date.now();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      ...temperature,
      ...tokenLimit,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Provider ${options.providerName} returned ${response.status}: ${body}`);
  }

  if (!response.body) {
    throw new Error(`Provider ${options.providerName} returned no stream body`);
  }

  const result = await parseSSEStream(response.body, startTime);

  if (!result.content) {
    throw new Error(`Provider ${options.providerName} returned an empty completion`);
  }

  return result;
}
