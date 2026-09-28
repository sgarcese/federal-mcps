/**
 * Records HUD User fixtures THROUGH a deployed HUD server's `hud_get_raw` (#241), for networks HUD
 * User refuses (it answers 403 to some addresses; the deployed Lambda is not refused). `hud_get_raw`
 * returns HUD's JSON unchanged, so the fixture body is HUD's response; the URL is the one the
 * server's own builders produce, so the hash matches what the tests request. No token is needed
 * here — the server holds its own. Run by a person or the orchestrator, never in CI:
 *
 *   npx tsx --conditions development packages/server-hud/scripts/record-hud-fixtures-via-server.mts
 *   HUD_URL=http://localhost:3004/mcp npx tsx ...   # another server
 *
 * Only `fmr`, `il` and `mtspil` calls are listed here (id + optional fiscal year); the direct
 * recorder (`record-hud-fixtures.mts`) remains the path for everything else.
 */
import { fileURLToPath } from "node:url";
import { writeFixture } from "@federal-mcps/core";
import { fmrUrl, ilUrl, mtspUrl } from "../src/hud-api.js";

// biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature.
const SERVER = process.env["HUD_URL"] ?? "https://hud-user.responsive.city/mcp";
const DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

type Endpoint = "fmr" | "il" | "mtspil";
const BUILDERS: Record<Endpoint, (id: string, year?: number) => string> = {
  fmr: fmrUrl,
  il: ilUrl,
  mtspil: mtspUrl,
};

// New England towns (#241): the county-subdivision GEOID is HUD's town id. Connecticut's changed
// with the 2022 planning regions: FMR takes the new id from FY2026, IL and MTSP from FY2025, and
// the 2020 id before that (verified through hud_get_raw, 2026-09-28).
const CALLS: { endpoint: Endpoint; id: string; year?: number }[] = [
  { endpoint: "fmr", id: "2502507000" }, // Boston city (town), MA
  { endpoint: "fmr", id: "5000710675" }, // Burlington city (town), VT
  { endpoint: "fmr", id: "0911037070" }, // Hartford town, CT — latest (FY2027)
  { endpoint: "fmr", id: "0911037070", year: 2026 },
  { endpoint: "fmr", id: "0900337070", year: 2025 }, // the 2020 id, before HUD's switch
  // Outside New England a township answers with its county's area (Butler County, PA).
  { endpoint: "fmr", id: "4201999999" },
  { endpoint: "il", id: "2502507000" },
  { endpoint: "il", id: "0911037070" },
  { endpoint: "il", id: "0900337070", year: 2024 },
];

async function hudGetRaw(endpoint: Endpoint, id: string, year?: number): Promise<unknown> {
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "hud_get_raw",
        arguments: { endpoint, ids: [id], ...(year !== undefined ? { year } : {}) },
      },
    }),
  });
  const text = await res.text();
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^data:\s*/, "").trim())
    .filter(Boolean)
    .at(-1);
  const rpc = JSON.parse(line ?? "{}") as {
    result?: {
      isError?: boolean;
      structuredContent?: { data?: { responses?: { response: unknown }[] } };
    };
  };
  if (rpc.result?.isError) throw new Error(`hud_get_raw ${endpoint} ${id} ${year ?? ""} failed`);
  return rpc.result?.structuredContent?.data?.responses?.[0]?.response ?? null;
}

for (const { endpoint, id, year } of CALLS) {
  const url = BUILDERS[endpoint](id, year);
  const body = await hudGetRaw(endpoint, id, year);
  if (body === null) {
    process.stdout.write(`no data (HUD 400/404), not recorded: ${url}\n`);
    continue;
  }
  await writeFixture(DIR, "hud", url, {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  process.stdout.write(`recorded ${url}\n`);
}
