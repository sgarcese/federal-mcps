/**
 * The server shell (#6): `createServer(definition)` plus the two transports.
 *
 * An agency package builds a `ServerDefinition` (definition.ts, the seam),
 * hands it to `createServer`, and runs the result over stdio (`runStdio`) or
 * stateless Streamable HTTP (`createHttpHandler`). The wrapping and error
 * helpers are exported because the contract harness (#7) asserts against them.
 */

export { ATTESTATION_HEADER } from "./attestation.js";
export * from "./caller.js";
export {
  type CreateServerOptions,
  createServer,
  FAMILY_TOOL_ANNOTATIONS,
} from "./create-server.js";
export * from "./definition.js";
export { type ToolErrorContext, type ToolErrorResult, toToolError } from "./errors.js";
export { createHttpHandler, type HttpHandlerOptions, type NodeHttpHandler } from "./http.js";
export {
  CALLER_KEY_HEX_LENGTH,
  CALLER_SECRET_ENV,
  CLAUDE_AI_POOL_CIDR,
  CLAUDE_AI_POOL_KEY,
  createIdentify,
  type IdentifyOptions,
  identifyFromEnv,
  isClaudeAiPool,
  LABEL_MAX_LENGTH,
  networkOf,
  OPERATOR_TOKEN_ENV,
} from "./identify.js";
export { type LambdaHeaderEvent, lambdaRequestHeaders } from "./lambda-headers.js";
export {
  buildServiceBudgetMetricLine,
  buildToolCallMetricLine,
  type CallerKind,
  logServiceBudgetMetric,
  logToolCallMetric,
  METRICS_NAMESPACE,
  type ServiceBudgetMetricInput,
  type ToolCallMetricInput,
  type ToolCallOutcome,
} from "./metrics.js";
export { runStdio, type StdioOptions } from "./stdio.js";
export {
  type CompactRendering,
  MAX_RENDERED_DATA_CHARS,
  RAW_TEXT_BUDGET,
  type RenderOptions,
  renderText,
  type WrappedToolResult,
  wrapResult,
} from "./wrap.js";
