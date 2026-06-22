# Changelog

## 0.1.2

- Add explicit `trackOpenAI(...)` and `trackAnthropic(...)` provider helpers.
- Add advisory `canRun(...)` guardrail preflight checks.
- Add `flush()`, `customer(...)`, and `user(...)` helpers.
- Expand docs with integration patterns, recommended paths, good and bad examples, and clearer `.track(...)` guidance.

## 0.1.1

- Complete standalone wrapped OpenAI and Anthropic runs through the cost-event request.
- Add `completeRun` and `outcome` fields to cost tracking inputs for terminal cost events.
- Default hosted API URL to `https://api.margovia.com`.
- Improve docs for customer attribution, run lifecycle, troubleshooting, and environment variables.

## 0.1.0

- Initial JavaScript SDK.
- OpenAI and Anthropic wrappers.
- Manual run, cost, outcome, and step tracking.
- Customer plan pricing metadata.
