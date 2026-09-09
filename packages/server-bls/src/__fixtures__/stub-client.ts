import type { HttpClient } from "@federal-mcps/core";

/** An HttpClient for tests that build the server but never call a data tool; throws if used. */
export function stubHttpClient(): HttpClient {
  const fail = () => {
    throw new Error("stubHttpClient: no HTTP request expected in this test");
  };
  return { getJson: fail, getText: fail, postJson: fail };
}
