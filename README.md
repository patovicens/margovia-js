# Margovia JavaScript SDK

Track AI cost, customer attribution, and outcome economics from Node/JavaScript apps.

## Install

```bash
pnpm add @margovia/sdk
```

```bash
npm install @margovia/sdk
```

## Environment

```env
MARGOVIA_API_KEY=mg_live_xxx
```

The SDK sends events to Margovia's hosted API by default. Set `MARGOVIA_BASE_URL` only for self-hosted or local API testing.

## Why open source?

Margovia is a commercial product for AI gross margin reporting, budgets, customer profitability, and plan margin analysis.

This SDK is open source because instrumentation should be inspectable, portable, and easy to remove or replace. The SDK captures usage and attribution events; Margovia's hosted product turns those events into reporting and operational controls.

## Where to use it

Use the SDK in server-side code that already calls OpenAI, Anthropic, or another model provider. Do not expose `MARGOVIA_API_KEY` in browser code.

Works with Node/JS backends such as Express, Fastify, Hono, Next.js route handlers/server actions, Remix actions, workers, and background jobs.

## Plan pricing

Define your customer plan catalog once in your app, then attach the current account or workspace plan when making a model call.

```ts
const plans = {
  free: { name: "free", monthlyUsd: 0 },
  starter: { name: "starter", monthlyUsd: 29 },
  pro: { name: "pro", monthlyUsd: 99 },
  enterprise: { name: "enterprise", monthlyUsd: 499 },
} as const;
```

Margovia calculates AI cost from provider usage and model pricing. Your app supplies customer identity and what that customer pays you.

## Customer attribution

Send the stable customer/account key from your app. Margovia preserves this value exactly and uses it for grouping, joins, aliases, and margin reporting.

Recommended IDs:

```ts
customerId: `workspace_${workspace.id}`
customerId: `org_${organization.id}`
customerId: `stripe_${stripeCustomer.id}`
customerId: `tenant_${tenant.id}`
```

Avoid raw values like `"1"` or `"42"` when possible. If your internal ID is numeric, prefix it before sending, such as `workspace_42`. Use `customerName` for display and aliases; do not change `customerId` just to make the dashboard prettier.

## Recommended paths

Use the SDK based on what you are tracking:

| Situation | Use |
| --- | --- |
| One OpenAI or Anthropic call should become one tracked run | `margovia.openai(client)` or `margovia.anthropic(client)` |
| You want to patch an existing provider client | `wrapOpenAI(..., { autoTrack: true })` or `wrapAnthropic(..., { autoTrack: true })` |
| You already have your own provider helper function | `trackOpenAI(...)` or `trackAnthropic(...)` |
| One product workflow has several provider/tool calls | `margovia.track(...)` around wrapped clients or manual cost calls |
| You use another paid API or custom provider | `startRun(...)`, `run.trackCost(...)`, `run.complete(...)` |

`margovia.track(...)` is a workflow wrapper. It does not read provider token usage by itself. For AI cost tracking, use provider wrappers/helpers or manually report cost.

## Easiest: tracked provider adapter

Create a tracked provider adapter once, then call it with Margovia run fields and the real provider request.

```ts
import OpenAI from "openai";
import { Margovia } from "@margovia/sdk";

const margovia = new Margovia({ apiKey: process.env.MARGOVIA_API_KEY });
const openai = margovia.openai(new OpenAI());

await openai.chat.completions.create({
  name: "support_reply",
  customerId: `workspace_${workspace.id}`,
  customerName: workspace.name,
  customerPlan: "pro",
  outcome: "reply_generated",
  request: {
    model: "gpt-5-mini",
    messages: buildSupportMessages(ticket)
  }
});
```

The adapter starts the run, calls OpenAI, reads `response.usage`, records cost, and completes or fails the run.

## Explicit: provider helper

```ts
const response = await margovia.trackAnthropic({
  name: "score_tweet",
  customerId: `workspace_${workspace.id}`,
  customerName: workspace.name,
  outcome: "tweet_scored",
  request: params,
  fn: () => anthropic.messages.create(params)
});
```

This is the best replacement for custom helper code that manually calls `startRun`, `run.trackCost`, and `run.complete`.

Use a raw provider client inside `trackOpenAI(...)` or `trackAnthropic(...)`. Do not pass an already-wrapped client into these helpers or you may double-report the same call.

## Workflow grouping: `.track(...)`

Use `.track(...)` when one business workflow contains multiple tracked calls.

```ts
import OpenAI from "openai";
import { Margovia, customer, user } from "@margovia/sdk";

const workspace = await db.workspace.findById(req.user.workspaceId);
const customerPlan = plans[workspace.plan];
const openai = margovia.wrapOpenAI(new OpenAI());

await margovia.track({
  name: "weekly_report",
  outcome: "report_generated",
  ...customer({
    id: workspace.id,
    prefix: "workspace",
    name: workspace.name,
    plan: customerPlan
  }),
  ...user({ id: req.user.id }),
  fn: async () => {
    await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: buildSummaryMessages()
    });

    await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: buildRecommendationMessages()
    });
  }
});
```

Bad `.track(...)` use:

```ts
await margovia.track({
  name: "score_tweet",
  fn: () => anthropic.messages.create(params)
});
```

If `anthropic` is raw and not wrapped, Margovia sees a run but no token usage or cost.

Use stable, namespaced customer IDs such as `workspace_123`, `org_abc`, or `stripe_cus_123`. Margovia stores the ID exactly as sent so it can join back to your app, billing system, logs, or warehouse.

## Guardrail preflight

Use `canRun(...)` before expensive work when you want to check active budgets. For now this is advisory: hard and soft stops are reported, not enforced by the SDK.

```ts
const guardrail = await margovia.canRun({
  name: "support_reply",
  customerId: `workspace_${workspace.id}`,
  estimatedCostUsd: 0.05
});

if (!guardrail.allowed) {
  throw new Error("Margovia hard-stop budget would block this workflow");
}
```

## Manual runs

Use manual runs only when you need explicit lifecycle control. For normal OpenAI or Anthropic calls, prefer wrappers or provider helpers. For multi-step workflows, prefer `margovia.track(...)` around wrapped clients or manual cost calls.

```ts
const run = await margovia.startRun({
  name: "generate_report",
  customerId: "workspace_123",
  customerName: "Acme Inc.",
  customerPlan: { name: "enterprise", monthlyUsd: 499 },
});

await run.trackCost({
  provider: "serpapi",
  label: "search_tool",
  costUsd: 0.01,
});

await run.complete({ outcome: "report_generated" });
```

Manual runs remain `running` until you call `run.complete(...)` or `run.fail(...)`. Use `margovia.track(...)` if you want the SDK to handle completion and failure around a function.

When you want wrapped provider calls inside a manual run, execute them inside `run.step(...)` so the SDK can attach the cost event to the correct run:

```ts
const run = await margovia.startRun({
  name: "support_reply",
  customerId: "workspace_123",
  customerPlan: { name: "pro", monthlyUsd: 99 },
});

const response = await run.step("openai_reply", () =>
  openai.chat.completions.create({
    model: "gpt-5-mini",
    messages,
  })
);

await run.complete({ outcome: "reply_generated" });
```

## Advanced examples

See `examples/` for:

- Express + Anthropic
- Next.js route handler + OpenAI
- Custom helper wrapper with lazy ESM import
