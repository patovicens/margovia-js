import Anthropic from "@anthropic-ai/sdk";

type MargoviaModule = typeof import("@margovia/sdk");
type MargoviaClient = InstanceType<MargoviaModule["Margovia"]>;
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

function customerIdString(value: string | number | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }

  const id = String(value);
  return id.includes("_") ? id : `customer_${id}`;
}

export async function createTrackedAnthropicMessage(options: TrackAiRunOptions, params: AnthropicParams): Promise<AnthropicResponse> {
  if (!process.env.MARGOVIA_API_KEY) {
    return anthropic.messages.create(params);
  }

  const margovia = await getMargovia();
  const trackedAnthropic = margovia.anthropic(anthropic);
  return trackedAnthropic.messages.create({
    name: options.name,
    userId: idString(options.userId),
    customerId: customerIdString(options.customerId),
    customerName: options.customerName ?? undefined,
    customerPlan: options.customerPlan,
    outcome: options.outcome,
    properties: options.properties,
    request: params,
  });
}
