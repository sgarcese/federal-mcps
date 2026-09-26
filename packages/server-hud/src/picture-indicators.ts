import type {
  DimensionDefinition,
  IndicatorDefinition,
  IndicatorFetch,
  SeriesObservation,
  SeriesResult,
} from "@federal-mcps/core";
import { HUD_USER_API_ENDPOINT } from "./describe-source.js";
import {
  hudGetJson,
  pictureCensusFor,
  pictureEntityOf,
  pictureUrl,
  type PictureEntity,
} from "./hud-api.js";

/**
 * Picture of Subsidized Households (#236, ADR-018 §3): five indicators (subsidized_units,
 * subsidized_people, average_household_income, share_below_30_ami, months_waiting) over one
 * fetch capability, keyed by an opaque `<entity>::<program>` series id built from `pictureEntityOf`
 * (hud-api.ts) and the caller's `program` dimension (default "1", Summary of All HUD Programs).
 * `agencyCodeOf` returns undefined for a level Picture does not publish (block, tract-group, …
 * anything `pictureEntityOf` refuses) — the shared tool layer then reports "unavailable" with a
 * note, so this file never needs its own level check.
 */
const PICTURE_PROGRAM = "PICTURE";

/** Data years Picture publishes (verified on the recorded fixtures, docs/spikes/m11-hud-user-server.md). */
const PICTURE_FLOOR_YEAR = 2012;

/** "Latest published" walks back this many years before giving up (mirrors QCEW's lookback). */
const PICTURE_MAX_LOOKBACK = 3;

/** Separates the entity and the chosen program in the opaque series key. */
const KEY_SEP = "::";
/** Separates the entity's own fields inside its half of the key. */
const ENTITY_SEP = "|";

/**
 * The program vocabulary (ADR-018 §3): only codes and labels verified in the recorded fixtures
 * (2024 and 2025 county/city/CBSA responses use these labels). HUD's own documentation lists more
 * program numbers — Mod Rehab, Section 236, Multi-Family Other, LIHTC among them — but the only
 * fixture that carries them (the 2012 county response) attaches those OLD labels to codes 4, 6, 7
 * and 8, which collide with 2024/2025's "202/PRAC" at code 8: HUD renumbered Picture's programs at
 * some point between 2012 and 2024, and without an intervening year's fixture the exact cutover
 * cannot be verified. Selecting an unlisted code is rejected by `resolveDimensions`, never guessed.
 */
const PROGRAM_VOCABULARY = [
  { code: "1", label: "Summary of All HUD Programs" },
  { code: "2", label: "Public Housing" },
  { code: "3", label: "Housing Choice Vouchers" },
  { code: "5", label: "Project Based Section 8" },
  { code: "8", label: "202/PRAC" },
  { code: "9", label: "811/PRAC" },
] as const;

const PROGRAM_DIMENSION: DimensionDefinition = {
  argument: "program",
  description:
    "A HUD program within the Picture of Subsidized Households (default: summary of all programs). " +
    "Older data years may number programs differently than this vocabulary; see the returned notes.",
  vocabulary: PROGRAM_VOCABULARY,
  default: "1",
};

function programLabelOf(program: string): string {
  return PROGRAM_VOCABULARY.find((v) => v.code === program)?.label ?? `program ${program}`;
}

/** Encode/decode the Picture entity into the opaque series key (fixed field order). */
function encodeEntity(e: PictureEntity): string {
  return [e.type, e.statecode ?? "", e.entityid ?? ""].join(ENTITY_SEP);
}

function decodeEntity(code: string): PictureEntity {
  const [typeStr = "", statecode, entityid] = code.split(ENTITY_SEP);
  return {
    type: Number(typeStr) as PictureEntity["type"],
    ...(statecode ? { statecode } : {}),
    ...(entityid ? { entityid } : {}),
  };
}

function parseKey(key: string): { entity: PictureEntity; program: string } | undefined {
  const idx = key.lastIndexOf(KEY_SEP);
  if (idx === -1) return undefined;
  const program = key.slice(idx + KEY_SEP.length);
  if (!program) return undefined;
  return { entity: decodeEntity(key.slice(0, idx)), program };
}

/** One row of a Picture `results` array — only the fields these indicators read. */
interface PictureRow {
  program: number;
  program_label?: string;
  sub_program?: unknown;
  total_units?: unknown;
  people_total?: unknown;
  hh_income?: unknown;
  pct_lt30_median?: unknown;
  months_waiting?: unknown;
}

interface PictureResponse {
  year: number;
  census: number;
  summary_level: number;
  state: string | null;
  results: PictureRow[];
}

type PictureField =
  | "total_units"
  | "people_total"
  | "hh_income"
  | "pct_lt30_median"
  | "months_waiting";

/** sub_program values HUD uses for a program's own total row: "NA" (2024) and "N/A" (2025 on). */
const TOTAL_SUB_PROGRAM = new Set(["na", "n/a"]);

/**
 * The row for a program's total, ignoring the sub-program breakout rows 2025 on adds ("TBV, All",
 * "PBV, non-MTW", …). When there is exactly one row for the program (every year before the 2025
 * breakout, and 2012 — which uses "A" rather than "NA"/"N/A" — but never more than one row), that
 * row is unambiguous regardless of its sub_program label.
 */
function pickTotalRow(rows: readonly PictureRow[]): PictureRow | undefined {
  if (rows.length === 0) return undefined;
  const total = rows.find((r) => TOTAL_SUB_PROGRAM.has(String(r.sub_program).trim().toLowerCase()));
  if (total) return total;
  return rows.length === 1 ? rows[0] : undefined;
}

/** Numbers may arrive as numbers or numeric strings (the 2012 response uses strings); "" / non-numeric → null. */
function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A negative value (e.g. -1, -4, -5) is HUD's sentinel for not-reported/suppressed — never a number. */
function normalizeField(raw: unknown): {
  value: number | null;
  footnotes: { code: string; text: string }[];
} {
  const n = toNumber(raw);
  if (n === null) return { value: null, footnotes: [] };
  if (n < 0) {
    return { value: null, footnotes: [{ code: String(n), text: "not reported by HUD" }] };
  }
  return { value: n, footnotes: [] };
}

function toObservation(row: PictureRow, year: number, field: PictureField): SeriesObservation {
  const { value, footnotes } = normalizeField(row[field]);
  return { year: String(year), period: "A01", periodName: String(year), value, footnotes };
}

/**
 * The years to read: without explicit years, the latest published — try the current year minus
 * one and walk back one year at a time, at most `PICTURE_MAX_LOOKBACK` attempts (the first response
 * with results wins). With explicit years, every year in range, newest first, floored at
 * `PICTURE_FLOOR_YEAR` with a note.
 */
function candidateYears(
  options: { startYear?: number; endYear?: number; explicitYears?: boolean },
  notes: string[],
): number[] {
  const referenceYear = options.endYear ?? new Date().getFullYear();
  if (!options.explicitYears) {
    const start = referenceYear - 1;
    return Array.from({ length: PICTURE_MAX_LOOKBACK }, (_, i) => start - i);
  }
  let startYear = options.startYear ?? options.endYear ?? referenceYear;
  const endYear = Math.min(options.endYear ?? referenceYear, referenceYear);
  if (startYear < PICTURE_FLOOR_YEAR) {
    notes.push(
      `Picture of Subsidized Households publishes from ${PICTURE_FLOOR_YEAR} on; the range was started there instead of ${startYear}.`,
    );
    startYear = PICTURE_FLOOR_YEAR;
  }
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  return years;
}

/** The census-vintage caveat for the years an answer actually drew data from (ADR-018 §4). */
function censusNotesFor(years: readonly number[]): string[] {
  if (years.length === 0) return [];
  const notes: string[] = [];
  if (years.includes(2022)) {
    notes.push(
      "2022 accepts either census vintage for Picture of Subsidized Households; the 2020 vintage was used.",
    );
  }
  const vintages = [...new Set(years.map(pictureCensusFor))].sort();
  notes.push(
    `Uses the ${vintages.join(" and ")} census vintage${vintages.length > 1 ? "s" : ""} (HUD's rule: 2010 through 2021, 2020 from 2022).`,
  );
  return notes;
}

/**
 * A fetch capability for one Picture field (#236): decode the entity and program from the opaque
 * key, read each candidate year's `/picture` response over `hud-api.ts`, and pick the program's
 * total row. An empty/400/404 response, or a response with no row for the requested program,
 * yields no observation for that year plus a note — never a guess.
 */
function pictureFetch(field: PictureField): IndicatorFetch {
  return async (client, keys, options): Promise<SeriesResult[]> =>
    Promise.all(
      keys.map(async (key): Promise<SeriesResult> => {
        const parsed = parseKey(key);
        if (!parsed) return { seriesId: key, observations: [] };
        const { entity, program } = parsed;
        const notes: string[] = [];
        const years = candidateYears(options, notes);
        const observations: SeriesObservation[] = [];
        const observedYears: number[] = [];
        for (const year of years) {
          const url = pictureUrl(entity, year);
          const body = await hudGetJson<PictureResponse>(client, url, () => options.apiKey);
          if (!body || !Array.isArray(body.results) || body.results.length === 0) {
            if (options.explicitYears) {
              notes.push(`No Picture of Subsidized Households data published for ${year}.`);
            }
            continue;
          }
          const rows = body.results.filter((r) => r.program === Number(program));
          const row = pickTotalRow(rows);
          if (!row) {
            notes.push(`${programLabelOf(program)} is not published for this place in ${year}.`);
          } else {
            observations.push(toObservation(row, year, field));
            observedYears.push(year);
          }
          if (!options.explicitYears) break; // stop at the first published response
        }
        if (observations.length === 0 && observedYears.length === 0 && notes.length === 0) {
          notes.push(
            `No Picture of Subsidized Households data published in ${years[years.length - 1]}–${years[0]}.`,
          );
        }
        notes.push(...censusNotesFor(observedYears));
        return { seriesId: key, observations, ...(notes.length > 0 ? { notes } : {}) };
      }),
    );
}

/** Where a Picture answer actually read (#212): the exact `/picture` URL for the year returned. */
function pictureSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parseKey(key);
  if (!parsed) return undefined;
  const year = latest ? Number(latest.year) : undefined;
  const url =
    year !== undefined ? pictureUrl(parsed.entity, year) : `${HUD_USER_API_ENDPOINT}/picture`;
  const label = `Picture of Subsidized Households, ${programLabelOf(parsed.program)}${
    year !== undefined ? `, ${year}` : ""
  }`;
  return { url, label };
}

/** Where a multi-file Picture comparison points (#212). */
const PICTURE_DATA_HOME = `${HUD_USER_API_ENDPOINT}/picture`;

function pictureIndicator(
  name: string,
  field: PictureField,
  description: string,
): IndicatorDefinition {
  return {
    name,
    program: PICTURE_PROGRAM,
    description,
    defaultSeasonallyAdjusted: false,
    // Undefined at a level Picture does not publish (pictureEntityOf: state, county, city, tract,
    // CBSA only) — the shared indicator tool then reports "unavailable" with a note; no fallback.
    agencyCodeOf: (place) => {
      const entity = pictureEntityOf(place);
      return entity ? encodeEntity(entity) : undefined;
    },
    buildSeriesId: (code, { dimensions }) => `${code}${KEY_SEP}${dimensions.program ?? "1"}`,
    dimensions: [PROGRAM_DIMENSION],
    fetch: pictureFetch(field),
    sourceOf: pictureSourceOf,
    sourceHome: PICTURE_DATA_HOME,
  };
}

/** Picture of Subsidized Households (ADR-018 §3): units, people, income, share below 30% AMI, wait. */
export const pictureIndicatorDefinitions: IndicatorDefinition[] = [
  pictureIndicator(
    "subsidized_units",
    "total_units",
    "Total subsidized housing units reported to HUD.",
  ),
  pictureIndicator(
    "subsidized_people",
    "people_total",
    "Total people housed in subsidized units reported to HUD.",
  ),
  pictureIndicator(
    "average_household_income",
    "hh_income",
    "Average household income of subsidized households (dollars per year).",
  ),
  pictureIndicator(
    "share_below_30_ami",
    "pct_lt30_median",
    "Share of subsidized households with income below 30% of area median income (percent).",
  ),
  pictureIndicator(
    "months_waiting",
    "months_waiting",
    "Average months a household waited before being admitted to the program.",
  ),
];
