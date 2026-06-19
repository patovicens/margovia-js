import { afterEach, describe, expect, it, vi } from "vitest";
import { Margovia } from "./index.js";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("Margovia.wrapAnthropic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-tracks an Anthropic call when no run context exists", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const stringUrl = String(url);
        requests.push({
          url: stringUrl,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        });

        if (stringUrl.endsWith("/v1/runs/start")) {
          return jsonResponse({ id: "run_auto_123" });
        }

        if (stringUrl.endsWith("/v1/runs/run_auto_123/cost-events")) {
          return jsonResponse({ id: "cost_123", runId: "run_auto_123", costUsd: 0.01, costSource: "estimated" });
        }

        if (stringUrl.endsWith("/v1/runs/run_auto_123/complete")) {
          return jsonResponse({ id: "run_auto_123", status: "completed", totalCostUsd: 0.01 });
        }

        return jsonResponse({});
      })
    );

    const create = vi.fn(async (request: { model: string }) => ({
      model: request.model,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 400,
        cache_creation: {
          ephemeral_5m_input_tokens: 100,
          ephemeral_1h_input_tokens: 200
        }
      }
    }));
    const client = {
      messages: {
        create: create as (...args: unknown[]) => Promise<{ model: string; usage: Record<string, unknown> }>
      }
    };

    const margovia = new Margovia({ apiKey: "mg_test", baseUrl: "https://api.test" });
    const anthropic = margovia.wrapAnthropic(client, {
      autoTrack: true,
      defaultName: "anthropic.messages.create"
    });

    await anthropic.messages!.create!({
      model: "claude-sonnet-4-6",
      metadata: {
        margoviaName: "suggestions_generate",
        userId: "user_123",
        customerId: "workspace_456",
        customerName: "Northstar Agency"
      }
    });

    expect(create).toHaveBeenCalledOnce();
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.test/v1/runs/start",
      "https://api.test/v1/runs/run_auto_123/cost-events",
      "https://api.test/v1/runs/run_auto_123/complete"
    ]);
    expect(requests[0]!.body).toMatchObject({
      name: "suggestions_generate",
      userId: "user_123",
      customerId: "workspace_456",
      customerName: "Northstar Agency"
    });
    expect(requests[1]!.body).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationInputTokens: 300,
      cacheCreationInputTokens5m: 100,
      cacheCreationInputTokens1h: 200,
      cachedInputTokens: 400
    });
    expect(requests[2]!.body).toEqual({ outcome: "message_created" });
  });
});

describe("Margovia.wrapOpenAI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-tracks an OpenAI call when no run context exists", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const stringUrl = String(url);
        requests.push({
          url: stringUrl,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        });

        if (stringUrl.endsWith("/v1/runs/start")) {
          return jsonResponse({ id: "run_openai_123" });
        }

        if (stringUrl.endsWith("/v1/runs/run_openai_123/cost-events")) {
          return jsonResponse({ id: "cost_123", runId: "run_openai_123", costUsd: 0.01, costSource: "estimated" });
        }

        if (stringUrl.endsWith("/v1/runs/run_openai_123/complete")) {
          return jsonResponse({ id: "run_openai_123", status: "completed", totalCostUsd: 0.01 });
        }

        return jsonResponse({});
      })
    );

    const create = vi.fn(async (request: { model: string }) => ({
      model: request.model,
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 240,
        prompt_tokens_details: {
          cached_tokens: 300
        },
        completion_tokens_details: {
          reasoning_tokens: 40
        }
      }
    }));
    const client = {
      chat: {
        completions: {
          create: create as (...args: unknown[]) => Promise<{ model: string; usage: Record<string, unknown> }>
        }
      }
    };

    const margovia = new Margovia({ apiKey: "mg_test", baseUrl: "https://api.test" });
    const openai = margovia.wrapOpenAI(client, {
      autoTrack: true,
      defaultName: "openai.chat.completions.create"
    });

    await openai.chat!.completions!.create!({
      model: "gpt-5-mini",
      metadata: {
        margoviaName: "draft_support_reply",
        userId: "user_123",
        customerId: "workspace_456",
        customerName: "Northstar Agency"
      }
    });

    expect(create).toHaveBeenCalledOnce();
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.test/v1/runs/start",
      "https://api.test/v1/runs/run_openai_123/cost-events",
      "https://api.test/v1/runs/run_openai_123/complete"
    ]);
    expect(requests[0]!.body).toMatchObject({
      name: "draft_support_reply",
      userId: "user_123",
      customerId: "workspace_456",
      customerName: "Northstar Agency"
    });
    expect(requests[1]!.body).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: 1200,
      outputTokens: 240,
      cachedInputTokens: 300,
      reasoningTokens: 40
    });
    expect(requests[2]!.body).toEqual({ outcome: "message_created" });
  });

  it("does not attach wrapped calls to a previous manual run unless a run context is active", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const stringUrl = String(url);
        requests.push({
          url: stringUrl,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        });

        if (stringUrl.endsWith("/v1/runs/start")) {
          return jsonResponse({ id: "run_manual_123" });
        }

        return jsonResponse({});
      })
    );

    const create = vi.fn(async (request: { model: string }) => ({
      model: request.model,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 25
      }
    }));
    const client = {
      chat: {
        completions: {
          create: create as (...args: unknown[]) => Promise<{ model: string; usage: Record<string, unknown> }>
        }
      }
    };

    const margovia = new Margovia({ apiKey: "mg_test", baseUrl: "https://api.test" });
    const openai = margovia.wrapOpenAI(client);

    await margovia.startRun({ name: "manual_workflow", customerId: "workspace_456" });
    await openai.chat!.completions!.create!({ model: "gpt-5-mini" });

    expect(create).toHaveBeenCalledOnce();
    expect(requests.map((request) => request.url)).toEqual(["https://api.test/v1/runs/start"]);
  });
});
