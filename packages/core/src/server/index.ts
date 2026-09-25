/**
 * The server shell (#6): `createServer(definition)` plus the two transports.
 *
 * An agency package builds a `ServerDefinition` (definition.ts, the seam),
 * hands it to `createServer`, and runs the result over stdio (`runStdio`) or
 * stateless Streamable HTTP (`createHttpHandler`). The wrapping and error
 * helpers are exported because the contract harness (#7) asserts against them.
 */
export {
  createServer,
  type CreateServerOptions,
  FAMILY_TOOL_ANNOTATIONS,
} from "./create-server.js";
export * from "./definition.js";
export { type ToolErrorContext, type ToolErrorResult, toToolError } from "./errors.js";
export { createHttpHandler, type HttpHandlerOptions, type NodeHttpHandler } from "./http.js";
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
