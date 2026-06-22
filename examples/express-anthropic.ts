import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { Margovia } from "@margovia/sdk";

const app = express();
app.use(express.json());

const margovia = new Margovia({ apiKey: process.env.MARGOVIA_API_KEY });
const anthropic = margovia.anthropic(new Anthropic());

const plans = {
  free: { name: "free", monthlyUsd: 0 },
  pro: { name: "pro", monthlyUsd: 99 },
  enterprise: { name: "enterprise", monthlyUsd: 499 },
} as const;

app.post("/api/summarize", async (req, res) => {
  const workspace = await loadWorkspace(req.body.workspaceId);
  const customerPlan = plans[workspace.plan];

  const response = await anthropic.messages.create({
    name: "summarize_contract",
    customerId: `workspace_${workspace.id}`,
    customerName: workspace.name,
    customerPlan,
    outcome: "summary_created",
    request: {
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: buildSummaryMessages(req.body.document),
    },
  });

  res.json(response);
});

type Workspace = {
  id: string;
  name: string;
  plan: keyof typeof plans;
};

async function loadWorkspace(workspaceId: string): Promise<Workspace> {
  return { id: workspaceId, name: "Acme Inc.", plan: "pro" };
}

function buildSummaryMessages(document: string): Anthropic.Messages.MessageParam[] {
  return [{ role: "user", content: `Summarize this contract:\n\n${document}` }];
}
