import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { parseGeocorr, transformGeocorrPlaceCounty } from "../parse/geocorr.js";

/**
 * Regenerates the vendored national place→county crosswalk (#141) from the MCDC Geocorr 2022
 * broker. Network; run deliberately (`npm run geocorr:fetch -w packages/geography-build`), never
 * in tests. Writes `data/geocorr/geocorr2022_place_county_natl.csv.gz` and prints the row count
 * and SHA-256 to record in `data/geocorr/README.md`.
 *
 * Geocorr has no API and no stable download URL (ADR-008 §2). Its form GETs a SAS broker; the
 * job fails with a macro error unless EVERY form field is present (blank text fields included),
 * and "all states" is the multi-select `state` field with all 52 values, not a single code.
 * The broker answers with an HTML page linking the generated CSV under a scratch `/temp/` path.
 */
const BROKER = "https://mcdc.missouri.edu/cgi-bin/broker";
const FORM = "https://mcdc.missouri.edu/applications/geocorr2022.html";
const USER_AGENT = "federal-mcps geography-build (sgarcese@gmail.com)";
const OUT_PATH = join(
  import.meta.dirname,
  "..",
  "data",
  "geocorr",
  "geocorr2022_place_county_natl.csv.gz",
);

/** Every non-state form field, with the values that select place→county / pop20 / CSV. */
const FIELDS: Record<string, string> = {
  _PROGRAM: "apps.geocorr2022.sas",
  _SERVICE: "MCDC_long",
  _debug: "0",
  g1_: "place",
  g2_: "county",
  wtvar: "pop20",
  nozerob: "1",
  fileout: "1",
  filefmt: "csv",
  lstfmt: "html",
  title: "",
  counties: "",
  metros: "",
  places: "",
  oropt: "",
  latitude: "",
  longitude: "",
  distance: "",
  kiloms: "0",
  locname: "",
};

async function main(): Promise<void> {
  const headers = { "user-agent": USER_AGENT };
  // The state codes come from the live form so a new state/territory option is never missed.
  const form = await (await fetch(FORM, { headers })).text();
  const select = form.match(/<select\b[^>]*name="state"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? "";
  const states = [...select.matchAll(/alue="([A-Z][a-z]\d\d)"/g)].flatMap((m) =>
    m[1] ? [m[1]] : [],
  );
  if (states.length < 50)
    throw new Error(`geocorr form: expected 50+ states, found ${states.length}`);

  const params = new URLSearchParams();
  for (const s of states) params.append("state", s);
  for (const [k, v] of Object.entries(FIELDS)) params.append(k, v);
  process.stderr.write(`geocorr: requesting place→county for ${states.length} states…\n`);
  const page = await (await fetch(`${BROKER}?${params}`, { headers })).text();
  if (/ERROR:/.test(page))
    throw new Error(`geocorr broker reported errors:\n${page.slice(0, 2000)}`);
  const link = page.match(/href="(\/temp\/[^" >]+\.csv)/i)?.[1];
  if (!link) throw new Error("geocorr broker page has no .csv link");

  const raw = await (await fetch(new URL(link, BROKER).href, { headers })).text();
  const csv = transformGeocorrPlaceCounty(raw);
  const rows = parseGeocorr(csv, "place_county").length;
  const gz = gzipSync(Buffer.from(csv, "utf-8"), { level: 9 });
  writeFileSync(OUT_PATH, gz);
  const sha = createHash("sha256").update(gz).digest("hex");
  process.stderr.write(
    `wrote ${OUT_PATH}\n  rows ${rows}  gzipped ${gz.length} bytes  sha256 ${sha}\n  retrieved ${new Date().toISOString().slice(0, 10)} from ${BROKER}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`geocorr:fetch failed: ${String(err)}\n`);
  process.exitCode = 1;
});
