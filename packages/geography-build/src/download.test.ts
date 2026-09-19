import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchCached,
  fetchCachedWithCensusKey,
  requireCensusApiKey,
  SOURCE_URLS,
} from "./download.js";

let tmp: string | undefined;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe("SOURCE_URLS.acsPopulation", () => {
  it("builds one Census Data API 5-year URL per summary level, defaulting to vintage 2024", () => {
    const urls = SOURCE_URLS.acsPopulation();
    expect(urls["040"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=state:*",
    );
    expect(urls["050"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=county:*",
    );
    expect(urls["160"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=place:*",
    );
    expect(urls["310"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=" +
        encodeURIComponent("metropolitan statistical area/micropolitan statistical area") +
        ":*",
    );
    expect(urls["860"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=" +
        encodeURIComponent("zip code tabulation area") +
        ":*",
    );
    expect(urls["020"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=region:*",
    );
    expect(urls["030"]).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=division:*",
    );
  });

  it("accepts a different vintage", () => {
    const urls = SOURCE_URLS.acsPopulation("2023");
    expect(urls["040"]).toContain("/data/2023/acs/acs5?");
  });

  it("never bakes an API key into the URL", () => {
    const urls = SOURCE_URLS.acsPopulation();
    for (const url of Object.values(urls)) expect(url).not.toContain("key=");
  });
});

describe("requireCensusApiKey", () => {
  it("returns the key when CENSUS_API_KEY is set", () => {
    expect(requireCensusApiKey({ CENSUS_API_KEY: "abc123" })).toBe("abc123");
  });

  it("throws loudly, naming the variable and the sign-up URL, when unset", () => {
    expect(() => requireCensusApiKey({})).toThrow(/CENSUS_API_KEY/);
    expect(() => requireCensusApiKey({})).toThrow(/key_signup\.html/);
  });
});

describe("fetchCachedWithCensusKey", () => {
  it("fetches the key-appended URL but caches under the key-less URL's hash", async () => {
    tmp = mkdtempSync(join(tmpdir(), "geo-dl-"));
    const url = "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=state:*";
    let requestedUrl = "";
    const fetchImpl = (async (input: string | URL) => {
      requestedUrl = String(input);
      return new Response('[["NAME","B01003_001E","state"]]', { status: 200 });
    }) as typeof fetch;

    const buf = await fetchCachedWithCensusKey(url, "SECRETKEY", { cacheDir: tmp, fetchImpl });
    expect(buf.toString("utf-8")).toContain("B01003_001E");
    expect(requestedUrl).toBe(`${url}&key=SECRETKEY`);

    // Cache path is derived from the key-less URL, exactly as fetchCached does normally.
    const keyless = await fetchCached(url, {
      cacheDir: tmp,
      fetchImpl: () => {
        throw new Error("should not refetch — cache hit expected");
      },
    });
    expect(keyless.toString("utf-8")).toContain("B01003_001E");

    // The key never appears in a cached file's name.
    const files = readdirSync(tmp);
    for (const f of files) expect(f).not.toContain("SECRETKEY");
  });

  it("never puts the key in a thrown error message", async () => {
    tmp = mkdtempSync(join(tmpdir(), "geo-dl-"));
    const url = "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=state:*";
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await expect(
      fetchCachedWithCensusKey(url, "SECRETKEY", { cacheDir: tmp, fetchImpl }),
    ).rejects.toThrow(/^(?!.*SECRETKEY).*$/s);
  });
});
