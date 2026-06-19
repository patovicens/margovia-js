import Anthropic from "@anthropic-ai/sdk";

type MargoviaModule = typeof import("@margovia/sdk");
type MargoviaClient = InstanceType<MargoviaModule["Margovia"]>;
type MargoviaRunClient = Awaited<ReturnType<MargoviaClient["startRun"]>>;
type AnthropicParams = Anthropic.Messages.MessageCreateParamsNonStreaming;
type AnthropicResponse = Anthropic.Messages.Message;

type CustomerPlan = {
  name: string;
  monthlyUsd: number;
};

type TrackAiRunOptions = {
  name: string;
  userId?: string | number | null;
  customerId?: string | number | null;
  customerName?: string | null;
  customerPlan?: CustomerPlan;
  outcome?: string;
  properties?: Record<string, unknown>;
};

const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<MargoviaModule>;

let margoviaPromise: Promise<MargoviaClient> | null = null;

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 4,
});

async function getMargovia(): Promise<MargoviaClient> {
  if (!margoviaPromise) {
    margoviaPromise = importEsm("@margovia/sdk").then(({ Margovia }) =>
      new Margovia({
        apiKey: process.env.MARGOVIA_API_KEY,
        baseUrl: process.env.MARGOVIA_BASE_URL,
      })
    );
  }

  return margoviaPromise;
}

function idString(value: string | number | null | undefined): string | undefined {
  return value == null ? undefined : String(value);
}

function warnTrackingFailure(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[margovia] ${action} failed: ${message}`);
}

export async function createTrackedAnthropicMessage(options: TrackAiRunOptions, params: AnthropicParams): Promise<AnthropicResponse> {
  if (!process.env.MARGOVIA_API_KEY) {
    return anthropic.messages.create(params);
  }

  const margovia = await getMargovia();
  let run: MargoviaRunClient;

  try {
    run = await margovia.startRun({
      name: options.name,
      userId: idString(options.userId),
      customerId: idString(options.customerId ?? options.userId),
      customerName: options.customerName ?? undefined,
      customerPlan: options.customerPlan,
      properties: options.properties,
    });
  } catch (error) {
    warnTrackingFailure("startRun", error);
    return anthropic.messages.create(params);
  }

  const started = Date.now();

  try {
    const response = await anthropic.messages.create(params);

    try {
      await run.trackCost({
        provider: "anthropic",
        model: response.model ?? params.model,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        latencyMs: Date.now() - started,
        status: "success",
      });
      await run.complete({ outcome: options.outcome });
    } catch (error) {
      warnTrackingFailure("recordCost", error);
    }

    return response;
  } catch (error) {
    try {
      await run.fail({
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (trackingError) {
      warnTrackingFailure("failRun", trackingError);
    }

    throw error;
  }
}

