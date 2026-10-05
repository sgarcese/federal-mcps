import { OPERATOR_BYPASS_HEADER, SOURCE_IP_HEADER } from "./caller.js";

/**
 * The headers a Lambda adapter replays against its loopback server (#321, ADR-020 §1).
 *
 * Every agency server's adapter turns an API Gateway v2 event into one `http.request` against a
 * loopback server; this builds that request's headers. It is the only place the source address
 * enters the process, so it is where the trust boundary sits:
 *
 * - Any client-sent `SOURCE_IP_HEADER`, under any spelling, is deleted, then the header is set
 *   from `requestContext.http.sourceIp`: the TCP peer API Gateway saw, which a client cannot
 *   forge. `x-forwarded-for` is passed through untouched and never read for identity.
 * - `OPERATOR_BYPASS_HEADER` is client-sent by design; it is not trusted here but kept under its
 *   lower-cased name for `identify()`, which compares it to the token in constant time. When a
 *   request carries it under more than one spelling, it is dropped rather than guessed at.
 *
 * Structurally typed so core needs no `aws-lambda` dependency.
 */
export interface LambdaHeaderEvent {
  readonly headers?: Readonly<Record<string, string | undefined>> | undefined;
  readonly requestContext: { readonly http: { readonly sourceIp: string } };
}

export function lambdaRequestHeaders(event: LambdaHeaderEvent): Record<string, string> {
  const headers: Record<string, string> = {};
  const operatorValues: string[] = [];
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === SOURCE_IP_HEADER) continue;
    if (lower === OPERATOR_BYPASS_HEADER) {
      operatorValues.push(value);
      continue;
    }
    headers[name] = value;
  }
  if (operatorValues.length === 1 && operatorValues[0] !== undefined) {
    headers[OPERATOR_BYPASS_HEADER] = operatorValues[0];
  }
  const sourceIp = event.requestContext.http.sourceIp;
  if (sourceIp) headers[SOURCE_IP_HEADER] = sourceIp;
  return headers;
}
