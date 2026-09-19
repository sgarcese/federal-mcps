import type { HttpClient, HttpResult } from "@federal-mcps/core";

/**
 * An HttpClient whose `getText` returns a canned Census-Data-API-shaped success response (a
 * header row plus one data row) for any URL — enough for the contract's example run, without a
 * fixture or the network.
 */
export function scriptedCensusClient(): HttpClient {
  const notUsed = () => {
    throw new Error("scriptedCensusClient: only getText is supported");
  };
  return {
    getJson: notUsed,
    postJson: notUsed,
    async getText(url: string): Promise<HttpResult<string>> {
      const get = new URL(url).searchParams.get("get") ?? "NAME";
      const header = [...get.split(","), "ucgid"];
      const row = header.map((name) => (name === "NAME" ? "Example County" : "1"));
      return {
        value: JSON.stringify([header, row]),
        status: 200,
        cache: { hit: false },
      };
    },
  };
}
