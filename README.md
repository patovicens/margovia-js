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

## OpenAI wrapper

```ts
import OpenAI from "openai";
import { Margovia } from "@margovia/sdk";

const margovia = new Margovia({ apiKey: process.env.MARGOVIA_API_KEY });
const openai = margovia.wrapOpenAI(new OpenAI(), { autoTrack: true });

const workspace = await db.workspace.findById(req.user.workspaceId);
const customerPlan = plans[workspace.plan];

await openai.chat.completions.create({
  model: "gpt-5-mini",
  messages: buildSupportMessages(ticket),
  metadata: {
    margoviaName: "support_reply",
    margoviaOutcome: "reply_generated",
    customerId: `workspace_${workspace.id}`,
    customerName: workspace.name,
    customerPlan: customerPlan.name,
    customerPlanMonthlyUsd: String(customerPlan.monthlyUsd),
  },
});
```

Use stable, namespaced customer IDs such as `workspace_123`, `org_abc`, or `stripe_cus_123`. Margovia stores the ID exactly as sent so it can join back to your app, billing system, logs, or warehouse.

## Anthropic wrapper

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Margovia } from "@margovia/sdk";

const margovia = new Margovia({ apiKey: process.env.MARGOVIA_API_KEY });
const anthropic = margovia.wrapAnthropic(new Anthropic(), { autoTrack: true });

const workspace = await db.workspace.findById(req.user.workspaceId);
const customerPlan = plans[workspace.plan];

await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 800,
  messages: buildContractSummaryMessages(contract),
  metadata: {
    margoviaName: "summarize_contract",
    margoviaOutcome: "summary_created",
    customerId: `workspace_${workspace.id}`,
    customerName: workspace.name,
    customerPlan: customerPlan.name,
    customerPlanMonthlyUsd: String(customerPlan.monthlyUsd),
  },
});
```

## Manual runs

Use manual runs for custom providers, tools, or workflows where you want explicit control.

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
