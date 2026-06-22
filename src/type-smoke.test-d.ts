import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Margovia } from "./index.js";

const margovia = new Margovia({ apiKey: "mg_test" });

const rawAnthropic = new Anthropic({ apiKey: "anthropic_test" });
const anthropic = margovia.anthropic(rawAnthropic);
const anthropicParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 100,
  messages: [{ role: "user", content: "Hello" }]
};

const anthropicMessage: Promise<Anthropic.Messages.Message> = anthropic.messages.create({
  name: "type_smoke_anthropic",
  customerId: "workspace_123",
  request: anthropicParams
});

void anthropicMessage;

const rawOpenAI = new OpenAI({ apiKey: "openai_test" });
const openai = margovia.openai(rawOpenAI);
const openaiParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Hello" }]
};

const openaiMessage: Promise<OpenAI.Chat.Completions.ChatCompletion> = openai.chat.completions.create({
  name: "type_smoke_openai",
  customerId: "workspace_123",
  request: openaiParams
});

void openaiMessage;

const trackedOpenAIMessage: Promise<OpenAI.Chat.Completions.ChatCompletion> = margovia.trackOpenAI({
  name: "type_smoke_track_openai",
  customerId: "workspace_123",
  request: openaiParams,
  fn: () => rawOpenAI.chat.completions.create(openaiParams)
});

void trackedOpenAIMessage;

const trackedAnthropicMessage: Promise<Anthropic.Messages.Message> = margovia.trackAnthropic({
  name: "type_smoke_track_anthropic",
  customerId: "workspace_123",
  request: anthropicParams,
  fn: () => rawAnthropic.messages.create(anthropicParams)
});

void trackedAnthropicMessage;
