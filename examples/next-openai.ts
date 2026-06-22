import OpenAI from "openai";
import { Margovia } from "@margovia/sdk";

const margovia = new Margovia({ apiKey: process.env.MARGOVIA_API_KEY });
const openai = margovia.openai(new OpenAI());

const plans = {
  free: { name: "free", monthlyUsd: 0 },
  starter: { name: "starter", monthlyUsd: 29 },
  pro: { name: "pro", monthlyUsd: 99 },
} as const;

export async function POST(request: Request) {
  const body = await request.json();
  const workspace = await loadWorkspace(body.workspaceId);
  const customerPlan = plans[workspace.plan];

  const response = await openai.chat.completions.create({
    name: "support_reply",
    customerId: `workspace_${workspace.id}`,
    customerName: workspace.name,
    customerPlan,
    outcome: "reply_generated",
    request: {
      model: "gpt-5-mini",
      messages: buildSupportMessages(body.ticket),
    },
  });

  return Response.json(response);
}

type Workspace = {
  id: string;
  name: string;
  plan: keyof typeof plans;
};

async function loadWorkspace(workspaceId: string): Promise<Workspace> {
  return { id: workspaceId, name: "Northstar Agency", plan: "pro" };
}

function buildSupportMessages(ticket: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    { role: "system", content: "Write concise customer support replies." },
    { role: "user", content: ticket },
  ];
}
