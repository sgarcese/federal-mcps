import type { HttpClient, HttpResult } from "@federal-mcps/core";

/**
 * An HttpClient whose postJson returns a canned BLS-shaped success response for any series
 * in the request body — enough for the contract's example run and the tool's unit tests,
 * without a fixture or the network.
 */
export function scriptedBlsClient(
  value = "3.9",
  footnotes: { code: string; text: string }[] = [{ code: "P", text: "preliminary" }],
): HttpClient {
  const notUsed = () => {
    throw new Error("scriptedBlsClient: only postJson is supported");
  };
  return {
    getJson: notUsed,
    getText: notUsed,
    async postJson<T>(_url: string, body: unknown): Promise<HttpResult<T>> {
      const ids = ((body as { seriesid?: string[] }).seriesid ?? []) as string[];
      const series = ids.map((seriesID) => ({
        seriesID,
        data: [{ year: "2024", period: "M12", periodName: "December", value, footnotes }],
      }));
      return {
        value: { status: "REQUEST_SUCCEEDED", Results: { series } } as T,
        status: 200,
        cache: { hit: false },
      };
    },
  };
}
