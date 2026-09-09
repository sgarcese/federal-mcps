import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * The remote transport (#6): stateless Streamable HTTP, JSON responses, no
 * sessions (ADR-002 §Decision, "Remote Streamable HTTP, stateless
 * JSON-response mode, one AWS Lambda per server").
 *
 * The handler is a bare `(req, res)` function on Node's `http` types and
 * nothing else — no Express, no framework. That is what lets the same function
 * be wrapped by the Lambda adapter in `infra/` and by a plain `node:http`
 * server for local development and for these tests.
 *
 * Why a fresh transport per request: in stateless mode there is no session to
 * attach state to, and the SDK's transport holds per-request response
 * plumbing. Reusing one transport across requests would cross-wire replies.
 * Constructing one is cheap; nothing is fetched or parsed at construction.
 */

export interface HttpHandlerOptions {
  /**
   * Restrict the handler to one path (e.g. "/mcp"); anything else gets 404.
   * Omitted by default because the route is normally chosen by whatever wraps
   * the handler (API Gateway, or the caller's own router).
   */
  readonly path?: string;
}

export type NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Stateless JSON mode.
 *
 * `sessionIdGenerator` is deliberately *absent* rather than set to
 * `undefined`: the SDK reads the property's value, and no generator is what
 * disables session management (its own docs write this as
 * `sessionIdGenerator: undefined`). `exactOptionalPropertyTypes` forbids the
 * explicit `undefined`, so absence carries the meaning.
 *
 * `enableJsonResponse` makes each POST answer with one JSON body instead of an
 * SSE stream — the only shape a Lambda behind an HTTP API can return.
 */
const STATELESS_JSON_OPTIONS: StreamableHTTPServerTransportOptions = {
  enableJsonResponse: true,
};

/** JSON-RPC error codes used for transport-level refusals. */
const JSONRPC_CONNECTION_CLOSED = -32000;

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: JSONRPC_CONNECTION_CLOSED, message },
      id: null,
    }),
  );
}

/**
 * Wraps `server` in a stateless Streamable HTTP request handler.
 *
 * Requests are serialised: one `McpServer` owns a single transport at a time
 * (the SDK's `Protocol.connect` replaces it), so overlapping requests against
 * one server instance would send replies down the wrong socket. Lambda runs
 * one request per instance anyway; a local dev server pays a negligible cost
 * for correctness. A caller that wants real concurrency creates one server per
 * process, not one handler per server.
 */
export function createHttpHandler(
  server: McpServer,
  options?: HttpHandlerOptions,
): NodeHttpHandler {
  const path = options?.path;
  let queue: Promise<void> = Promise.resolve();

  return (req, res) => {
    // `req.url` is a path with an optional query string, never absolute; the
    // dummy base only exists so `URL` will parse it.
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== undefined && pathname !== path) {
      sendJsonRpcError(res, 404, "Not found");
      return Promise.resolve();
    }

    // Stateless mode has no server-initiated stream to open (GET) and no
    // session to terminate (DELETE), so both are refused rather than passed
    // to the transport, which would answer with a less specific error.
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJsonRpcError(res, 405, "Method not allowed: this endpoint accepts POST only");
      return Promise.resolve();
    }

    const handled = queue.then(async () => {
      const transport = new StreamableHTTPServerTransport(STATELESS_JSON_OPTIONS);
      try {
        // The SDK's transport classes type `onclose`/`onerror`/`onmessage` as
        // accessors that accept `undefined`, which `exactOptionalPropertyTypes`
        // will not match against `Transport`'s optional properties. The runtime
        // shape is exactly right; only the optionality annotation differs.
        await server.connect(transport as Transport);
        await transport.handleRequest(req, res);
      } finally {
        // Closing detaches the transport from the server, leaving it ready for
        // the next request; it does not close the server itself.
        await transport.close();
      }
    });

    // Keep the queue alive even if one request fails, and let the caller see
    // the rejection.
    queue = handled.then(
      () => undefined,
      () => undefined,
    );
    return handled;
  };
}
