/**
 * Who is calling (ADR-020 §1): the seam between the transport and the limiter. The Lambda adapter
 * forwards the API Gateway source address in `SOURCE_IP_HEADER` (stripping any client-sent copy);
 * `identify()` (#321) turns the request headers into a `Caller`; tools and the limiter read it from
 * `ToolContext.caller`. An authentication layer later replaces `identify()` with keys per client.
 */

/** Internal header the adapter sets from `requestContext.http.sourceIp`; never trusted from a client. */
export const SOURCE_IP_HEADER = "x-federal-mcps-source-ip";

/** The operator-bypass header (ADR-020 §9); its expected value is a sensitive deploy variable. */
export const OPERATOR_BYPASS_HEADER = "x-federal-mcps-operator";

export interface Caller {
  /** A daily-rotating HMAC of the source address, or the pool's fixed key; never a raw address. */
  readonly key: string;
  /** One network (an address), or the shared claude.ai pool (`160.79.104.0/21`). */
  readonly kind: "network" | "pool";
  /** Metric labels only, never enforcement keys. */
  readonly labels: { readonly userAgent?: string; readonly client?: string };
  /** True when the request carried a valid operator-bypass header: exempt from shares only. */
  readonly bypass: boolean;
}

/** Request headers, lower-cased names. */
export type RequestHeaders = Readonly<Record<string, string | undefined>>;

/** Builds the caller from a request's headers; undefined when no source address was forwarded. */
export type Identify = (headers: RequestHeaders, now: Date) => Caller | undefined;
