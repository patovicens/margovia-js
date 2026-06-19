import { AsyncLocalStorage } from "node:async_hooks";

type Metadata = Record<string, unknown>;

type CustomerPlanInput =
  | string
  | {
      name: string;
      monthlyUsd: number;
    };

type StartRunInput = {
  name: string;
  userId?: string;
  customerId?: string;
  customerName?: string;
  customerPlan?: CustomerPlanInput;
  properties?: Metadata;
  budgetUsd?: number;
  startedAt?: string;
};

type CompleteRunInput = {
  outcome?: string;
  metadata?: Metadata;
  completedAt?: string;
};

type FailRunInput = {
  error?: string;
  metadata?: Metadata;
  completedAt?: string;
};

type TrackCostInput = {
  runId: string;
  provider: string;
  label?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheCreationInputTokens5m?: number;
  cacheCreationInputTokens1h?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: string;
  metadata?: Metadata;
  createdAt?: string;
};

type TrackOutcomeInput = {
  runId: string;
  outcome: string;
  valueUsd?: number;
  metadata?: Metadata;
  createdAt?: string;
};

type MargoviaOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  debug?: boolean;
};

type RunContext = {
  runId: string;
  label?: string;
};

type TrackOptions<T> = StartRunInput & {
  outcome?: string;
  fn: () => Promise<T> | T;
};

type AutoRunInput = StartRunInput & {
  outcome?: string;
};

type WrapOptions<TRequest> = {
  autoTrack?: boolean;
  defaultName?: string;
  getRunInput?: (request: TRequest, args: unknown[]) => AutoRunInput | undefined;
  defaultRun?: (context: { request: TRequest; args: unknown[] }) => AutoRunInput | undefined;
};

type OpenAIClientLike = {
  chat?: {
    completions?: {
      create?: (...args: unknown[]) => Promise<OpenAIResponseLike>;
    };
  };
};

type OpenAIResponseLike = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
};

type AnthropicClientLike = {
  messages?: {
    create?: (...args: unknown[]) => Promise<AnthropicResponseLike>;
  };
};

type AnthropicResponseLike = {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
};

function resolveRunInput<TRequest extends { model?: string; metadata?: Record<string, unknown> }>(
  options: WrapOptions<TRequest>,
  request: TRequest | undefined,
  args: unknown[],
  fallbackName: string,
  fallbackOutcome: string
): AutoRunInput | undefined {
  if (request) {
    const configured = options.getRunInput?.(request, args) ?? options.defaultRun?.({ request, args });
    if (configured) {
      return configured;
    }
  }

  if (!options.autoTrack) {
    return undefined;
  }

  const metadata = request?.metadata;
  const name = metadataString(metadata, "margoviaName") ?? options.defaultName ?? fallbackName;
  return {
    name,
    userId: metadataString(metadata, "userId") ?? metadataString(metadata, "user_id"),
    customerId: metadataString(metadata, "customerId"),
    customerName: metadataString(metadata, "customerName"),
    customerPlan: metadataCustomerPlan(metadata),
    properties: {
      model: request?.model
    },
    outcome: metadataString(metadata, "margoviaOutcome") ?? fallbackOutcome
  };
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  return undefined;
}

function metadataCustomerPlan(metadata: Record<string, unknown> | undefined): CustomerPlanInput | undefined {
  const value = metadata?.customerPlan;

  if (typeof value === "object" && value !== null) {
    const plan = value as Record<string, unknown>;
    const name = typeof plan.name === "string" && plan.name.trim() ? plan.name : undefined;
    const monthlyUsd = typeof plan.monthlyUsd === "number" && Number.isFinite(plan.monthlyUsd) && plan.monthlyUsd >= 0 ? plan.monthlyUsd : undefined;
    if (name && monthlyUsd != null) {
      return { name, monthlyUsd };
    }
  }

  const name = metadataString(metadata, "customerPlan");
  if (!name) {
    return undefined;
  }

  const monthlyUsd = metadataNumber(metadata, "customerPlanMonthlyUsd") ?? metadataNumber(metadata, "customerPlanMonthlyRevenueUsd") ?? metadataNumber(metadata, "planMonthlyUsd");
  return monthlyUsd == null ? name : { name, monthlyUsd };
}

export class Margovia {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly debug: boolean;
  private readonly runContext = new AsyncLocalStorage<RunContext>();

  constructor(options: MargoviaOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.MARGOVIA_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.MARGOVIA_BASE_URL ?? "https://api.margovia.dev").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.debug = options.debug ?? process.env.MARGOVIA_DEBUG === "1";
  }

  async startRun(input: StartRunInput) {
    if (!this.apiKey) {
      this.log("No MARGOVIA_API_KEY configured; using no-op run.");
      return new MargoviaRun(this, "noop", true);
    }

    const response = await this.request<{ id: string }>("/v1/runs/start", {
      method: "POST",
      body: input
    });

    return new MargoviaRun(this, response.id, false);
  }

  async track<T>(input: TrackOptions<T>) {
    const { fn, outcome, ...runInput } = input;
    const run = await this.startRun(runInput);

    try {
      const result = await this.runContext.run({ runId: run.id }, () => Promise.resolve(fn()));
      await run.complete({ outcome });
      return result;
    } catch (error) {
      await run.fail({
        error: error instanceof Error ? error.message : "Unknown error"
      });
      throw error;
    }
  }

  async trackOutcome(input: TrackOutcomeInput) {
    if (!this.apiKey || input.runId === "noop") {
      return;
    }

    await this.request("/v1/outcomes", {
      method: "POST",
      body: input
    });
  }

  async trackCost(input: TrackCostInput) {
    if (!this.apiKey || input.runId === "noop") {
      return;
    }

    const { runId, ...body } = input;
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/cost-events`, {
      method: "POST",
      body
    });
  }

  wrapOpenAI<TClient extends OpenAIClientLike>(client: TClient, options: WrapOptions<{ model?: string; metadata?: Record<string, unknown> }> = {}): TClient {
    const create = client.chat?.completions?.create;
    if (!create || typeof create !== "function") {
      this.log("OpenAI client does not expose chat.completions.create; returning original client.");
      return client;
    }

    const agentCost = this;
    client.chat!.completions!.create = async function wrappedCreate(...args: unknown[]) {
      const context = agentCost.runContext.getStore();
      const runId = context?.runId;
      const request = args[0] as { model?: string; metadata?: Record<string, unknown> } | undefined;

      if (runId) {
        const started = Date.now();
        const response = await create.apply(this, args);
        const latencyMs = Date.now() - started;
        await agentCost.trackOpenAICost(runId, response, request, latencyMs, context?.label);
        return response;
      }

      const runInput = resolveRunInput(options, request, args, "openai.chat.completions.create", "message_created");
      if (!runInput) {
        agentCost.log("OpenAI call completed without an active Margovia run; skipping cost event.");
        return create.apply(this, args);
      }

      let run: MargoviaRun | undefined;
      try {
        run = await agentCost.startRun(runInput);
      } catch (error) {
        agentCost.log(`Failed to auto-start OpenAI run: ${error instanceof Error ? error.message : String(error)}`);
      }

      const started = Date.now();
      try {
        const response = await create.apply(this, args);
        const latencyMs = Date.now() - started;

        if (run) {
          await agentCost.trackOpenAICost(run.id, response, request, latencyMs);
          await agentCost.safeCompleteRun(run.id, { outcome: runInput.outcome });
        }

        return response;
      } catch (error) {
        if (run) {
          await agentCost.safeFailRun(run.id, {
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
        throw error;
      }
    };

    return client;
  }

  wrapAnthropic<TClient extends AnthropicClientLike>(client: TClient, options: WrapOptions<{ model?: string; metadata?: Record<string, unknown> }> = {}): TClient {
    const create = client.messages?.create;
    if (!create || typeof create !== "function") {
      this.log("Anthropic client does not expose messages.create; returning original client.");
      return client;
    }

    const margovia = this;
    client.messages!.create = async function wrappedCreate(...args: unknown[]) {
      const context = margovia.runContext.getStore();
      const runId = context?.runId;
      const request = args[0] as { model?: string; metadata?: Record<string, unknown> } | undefined;

      if (runId) {
        const started = Date.now();
        const response = await create.apply(this, args);
        const latencyMs = Date.now() - started;
        await margovia.trackAnthropicCost(runId, response, request, latencyMs, context?.label);
        return response;
      }

      const runInput = resolveRunInput(options, request, args, "anthropic.messages.create", "message_created");
      if (!runInput) {
        margovia.log("Anthropic call completed without an active Margovia run; skipping cost event.");
        return create.apply(this, args);
      }

      let run: MargoviaRun | undefined;
      try {
        run = await margovia.startRun(runInput);
      } catch (error) {
        margovia.log(`Failed to auto-start Anthropic run: ${error instanceof Error ? error.message : String(error)}`);
      }

      const started = Date.now();
      try {
        const response = await create.apply(this, args);
        const latencyMs = Date.now() - started;

        if (run) {
          await margovia.trackAnthropicCost(run.id, response, request, latencyMs);
          await margovia.safeCompleteRun(run.id, { outcome: runInput.outcome });
        }

        return response;
      } catch (error) {
        if (run) {
          await margovia.safeFailRun(run.id, {
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
        throw error;
      }
    };

    return client;
  }

  private async trackOpenAICost(runId: string, response: OpenAIResponseLike, request: { model?: string } | undefined, latencyMs: number, label?: string) {
    const usage = response.usage;
    await this.safeTrackCost({
      runId,
      provider: "openai",
      label,
      model: response.model ?? request?.model,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
      latencyMs,
      status: "success"
    });
  }

  async completeRun(runId: string, input: CompleteRunInput = {}) {
    if (!this.apiKey || runId === "noop") {
      return;
    }

    await this.request(`/v1/runs/${encodeURIComponent(runId)}/complete`, {
      method: "POST",
      body: input
    });

  }

  async failRun(runId: string, input: FailRunInput = {}) {
    if (!this.apiKey || runId === "noop") {
      return;
    }

    await this.request(`/v1/runs/${encodeURIComponent(runId)}/fail`, {
      method: "POST",
      body: input
    });

  }

  async runStep<T>(runId: string, label: string, fn: () => Promise<T> | T) {
    return this.runContext.run({ runId, label }, () => Promise.resolve(fn()));
  }

  private async safeTrackCost(input: TrackCostInput) {
    try {
      await this.trackCost(input);
    } catch (error) {
      this.log(`Failed to send cost event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async trackAnthropicCost(runId: string, response: AnthropicResponseLike, request: { model?: string } | undefined, latencyMs: number, label?: string) {
    const usage = response.usage;
    await this.safeTrackCost({
      runId,
      provider: "anthropic",
      label,
      model: response.model ?? request?.model,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      cacheCreationInputTokens: usage?.cache_creation_input_tokens,
      cacheCreationInputTokens5m: usage?.cache_creation?.ephemeral_5m_input_tokens,
      cacheCreationInputTokens1h: usage?.cache_creation?.ephemeral_1h_input_tokens,
      cachedInputTokens: usage?.cache_read_input_tokens,
      latencyMs,
      status: "success"
    });
  }

  private async safeCompleteRun(runId: string, input: CompleteRunInput = {}) {
    try {
      await this.completeRun(runId, input);
    } catch (error) {
      this.log(`Failed to complete run: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async safeFailRun(runId: string, input: FailRunInput = {}) {
    try {
      await this.failRun(runId, input);
    } catch (error) {
      this.log(`Failed to fail run: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async request<T = unknown>(path: string, options: { method: string; body?: unknown }): Promise<T> {
    if (!this.apiKey) {
      throw new Error("Margovia API key is required");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Margovia API ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private log(message: string) {
    if (this.debug) {
      console.warn(`[margovia] ${message}`);
    }
  }
}

export class MargoviaRun {
  constructor(
    private readonly agentCost: Margovia,
    public readonly id: string,
    private readonly noop: boolean
  ) {}

  async complete(input: CompleteRunInput = {}) {
    if (this.noop) {
      return;
    }

    await this.agentCost.completeRun(this.id, input);
  }

  async fail(input: FailRunInput = {}) {
    if (this.noop) {
      return;
    }

    await this.agentCost.failRun(this.id, input);
  }

  async trackCost(input: Omit<TrackCostInput, "runId">) {
    if (this.noop) {
      return;
    }

    await this.agentCost.trackCost({ ...input, runId: this.id });
  }

  async step<T>(label: string, fn: () => Promise<T> | T) {
    return this.agentCost.runStep(this.id, label, fn);
  }
}

export type { CompleteRunInput, CustomerPlanInput, FailRunInput, MargoviaOptions, StartRunInput, TrackCostInput, TrackOptions, TrackOutcomeInput };
