import type {
  DimensionDefinition,
  IndicatorDefinition,
  IndicatorFetch,
  PlaceCandidate,
  SeriesObservation,
} from "@federal-mcps/core";
import { chasEntityOf, type ChasEntity, chasUrl, hudGetJson } from "./hud-api.js";
import { HUD_USER_API_ENDPOINT } from "./describe-source.js";

/**
 * CHAS cost-burden measures (#235, ADR-018 §3). Four indicators — the renter and owner
 * cost-burdened share and count — each over a `level` dimension (30 = over 30% of income, 50 =
 * severe, over 50%; default 30). Each definition supplies its own `fetch` capability built on
 * `hud-api.ts` (the token arrives as `options.apiKey`), an `agencyCodeOf` from `chasEntityOf`
 * (county/state/place only — tract and metro have no CHAS entity and fall through to the
 * shared "unavailable" answer with no extra code here), and a `sourceOf` citing the exact URL
 * read.
 *
 * CHAS field codes used here, from HUD's CHAS API field dictionary (HUD User CHAS API
 * documentation, read 2026-09-24):
 *
 *   Code | Description
 *   -----|------------------------------------------------------------
 *   A16  | Total Owner Occupied
 *   A17  | Total Renter Occupied
 *   A18  | Total Occupied housing units
 *   D1   | Cost Burden <=30% (Owner Occupied)
 *   D2   | Cost Burden <=30% (Renter Occupied)
 *   D4   | Cost Burden >30% to <=50% (Owner Occupied)
 *   D5   | Cost Burden >30% to <=50% (Renter Occupied)
 *   D7   | Cost Burden >50% (Owner Occupied)
 *   D8   | Cost Burden >50% (Renter Occupied)
 *   D10  | Cost Burden not available (Owner Occupied)
 *   D11  | Cost Burden not available (Renter Occupied)
 *
 * Renter share/count at level 30 = (D5 + D8) / A17; at level 50 = D8 / A17. Owner share/count
 * at level 30 = (D4 + D7) / A16; at level 50 = D7 / A16 (the same over-50% cost-burdened
 * households are also over 30%, so level 30 sums both bands rather than double the level-50
 * households on top of them).
 */

const CHAS_PROGRAM = "CHAS";
const CHAS_DATA_HOME = `${HUD_USER_API_ENDPOINT}/chas`;

/** A CHAS release is a 5-year ACS special tabulation, newest first (docs/spikes/m11-hud-user-server.md). */
const CHAS_RELEASES = [
  "2018-2022",
  "2017-2021",
  "2016-2020",
  "2015-2019",
  "2014-2018",
  "2013-2017",
  "2012-2016",
] as const;

/** The newest release whose last year is at or before `endYear`; the oldest release if none is. */
function releaseFor(endYear: number | undefined): string | undefined {
  if (endYear === undefined) return undefined;
  const match = CHAS_RELEASES.find((r) => Number(r.split("-")[1]) <= endYear);
  return match ?? CHAS_RELEASES[CHAS_RELEASES.length - 1];
}

const LEVEL_DIMENSION: DimensionDefinition = {
  argument: "level",
  description:
    "Cost-burden threshold: 30 (cost burden over 30% of income) or 50 (severe, over 50%).",
  vocabulary: [
    { code: "30", label: "cost burden over 30% of income" },
    { code: "50", label: "cost burden over 50% of income (severe)" },
  ],
  default: "30",
};

/** Encode a CHAS entity as the indicator's agency code: "type:stateId:entityId" (entityId omitted for a state). */
function encodeEntity(entity: ChasEntity): string {
  return `${entity.type}:${entity.stateId}:${entity.entityId ?? ""}`;
}

function decodeEntity(code: string): ChasEntity | undefined {
  const [typeStr, stateStr, entityStr] = code.split(":");
  const type = Number(typeStr);
  const stateId = Number(stateStr);
  if ((type !== 2 && type !== 3 && type !== 5) || !Number.isFinite(stateId)) return undefined;
  const entityId = entityStr === "" || entityStr === undefined ? undefined : Number(entityStr);
  return entityId === undefined ? { type, stateId } : { type, stateId, entityId };
}

/** The CHAS agency code for a place: state, county or place only (ADR-018 §4); undefined elsewhere. */
export function chasAgencyCodeOf(place: PlaceCandidate): string | undefined {
  const entity = chasEntityOf(place);
  return entity ? encodeEntity(entity) : undefined;
}

/** The opaque series key: the entity code plus the resolved cost-burden level. */
export function chasBuildSeriesId(code: string, level: string | undefined): string {
  return `${code}|${level ?? LEVEL_DIMENSION.default}`;
}

function parseChasKey(key: string): { entity: ChasEntity; level: string } | undefined {
  const [code, level] = key.split("|");
  if (!code || !level) return undefined;
  const entity = decodeEntity(code);
  return entity ? { entity, level } : undefined;
}

/** One CHAS response row: known totals/cost-burden fields as numeric strings, or null when suppressed. */
type ChasRow = Record<string, string | null> & { year: string; geoname: string };

function num(row: ChasRow, field: string): number | null {
  const v = row[field];
  return v === null || v === undefined ? null : Number(v);
}

function add(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/** Round a share to one decimal place; null (suppressed/zero denominator) travels as null, never a guess. */
function share(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

type ChasMeasure = "renter_share" | "owner_share" | "renters_count" | "owners_count";

/** The numerator households for a measure (>30% sums the >30–50% and >50% bands; >50% is D7/D8 alone). */
function numeratorFor(measure: "renter" | "owner", level: string, row: ChasRow): number | null {
  const midField = measure === "renter" ? "D5" : "D4";
  const severeField = measure === "renter" ? "D8" : "D7";
  return level === "50" ? num(row, severeField) : add(num(row, midField), num(row, severeField));
}

function computeValue(measure: ChasMeasure, level: string, row: ChasRow): number | null {
  switch (measure) {
    case "renter_share":
      return share(numeratorFor("renter", level, row), num(row, "A17"));
    case "owner_share":
      return share(numeratorFor("owner", level, row), num(row, "A16"));
    case "renters_count":
      return numeratorFor("renter", level, row);
    case "owners_count":
      return numeratorFor("owner", level, row);
  }
}

const RENTER_DENOMINATOR_NOTE =
  "The share's denominator is all renter-occupied households (HUD field A17), including " +
  "households whose cost burden could not be computed (D11).";
const OWNER_DENOMINATOR_NOTE =
  "The share's denominator is all owner-occupied households (HUD field A16), including " +
  "households whose cost burden could not be computed (D10).";

function releaseNote(release: string): string {
  return `CHAS ${release}, special tabulations of the ACS 5-year estimates; counts are rounded by HUD.`;
}

/**
 * A fetch capability for one CHAS measure (#235): one opaque `entity|level` key → the release
 * HUD answers (its latest unless the caller's `endYear` maps to an earlier one, `releaseFor`) —
 * a single observation, dated by the release's last year. An empty array or a 400/404
 * (`hudGetJson` already turns those into `undefined`) yields no observation and a note, never a
 * fabricated number.
 */
function chasFetch(measure: ChasMeasure): IndicatorFetch {
  return async (client, keys, options) =>
    Promise.all(
      keys.map(async (key) => {
        const parsed = parseChasKey(key);
        if (!parsed) return { seriesId: key, observations: [] };
        const { entity, level } = parsed;
        const requestedRelease = options.explicitYears ? releaseFor(options.endYear) : undefined;
        const url = chasUrl(entity, requestedRelease);
        const body = await hudGetJson<ChasRow[]>(client, url, () => options.apiKey);
        const row = body?.[0];
        if (!row) {
          return {
            seriesId: key,
            observations: [],
            notes: [
              `HUD CHAS has no data published for this place${requestedRelease ? ` in the ${requestedRelease} release` : ""}.`,
            ],
          };
        }
        const release = row.year;
        const lastYear = release.split("-")[1] ?? release;
        const value = computeValue(measure, level, row);
        const observation: SeriesObservation = {
          year: lastYear,
          period: "A01",
          periodName: `CHAS ${release}`,
          value,
          footnotes: [],
        };
        const notes = [releaseNote(release)];
        if (measure === "renter_share") notes.push(RENTER_DENOMINATOR_NOTE);
        if (measure === "owner_share") notes.push(OWNER_DENOMINATOR_NOTE);
        return { seriesId: key, observations: [observation], notes };
      }),
    );
}

const TYPE_LABEL: Record<ChasEntity["type"], string> = { 2: "state", 3: "county", 5: "place" };

/**
 * The URL a CHAS answer's citation points to, and a readable label (#212). `sourceOf` only
 * receives the series key and the latest observation, not the request's `explicitYears` — so a
 * "latest" answer (fetched from the bare, no-year URL) is cited with its release named
 * explicitly anyway, read off `latest.periodName`. That URL still returns the exact rows the
 * answer used; naming the release makes the citation reproducible even after HUD publishes a
 * newer one, rather than reading differently over time.
 */
function chasSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parseChasKey(key);
  if (!parsed) return undefined;
  const { entity, level } = parsed;
  const release = latest ? /^CHAS (\d{4}-\d{4})$/.exec(latest.periodName)?.[1] : undefined;
  const url = chasUrl(entity, release);
  const entityLabel =
    entity.entityId === undefined
      ? `${TYPE_LABEL[entity.type]} stateId=${entity.stateId}`
      : `${TYPE_LABEL[entity.type]} stateId=${entity.stateId}, entityId=${entity.entityId}`;
  const levelLabel = level === "50" ? "over 50% (severe)" : "over 30%";
  const label = `CHAS ${release ?? "latest release"}, ${entityLabel}, cost burden ${levelLabel}`;
  return { url, label };
}

function definitionFor(
  name: string,
  description: string,
  measure: ChasMeasure,
): IndicatorDefinition {
  return {
    name,
    program: CHAS_PROGRAM,
    description,
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: chasAgencyCodeOf,
    buildSeriesId: (code, { dimensions }) => chasBuildSeriesId(code, dimensions.level),
    dimensions: [LEVEL_DIMENSION],
    fetch: chasFetch(measure),
    sourceOf: chasSourceOf,
    sourceHome: CHAS_DATA_HOME,
  };
}

/**
 * CHAS cost-burden measures (ADR-018 §3): the renter and owner share and household count paying
 * more than the `level` dimension's threshold of income toward housing. Published at state,
 * county and place; tract and metro answer "unavailable" (no CHAS entity there, ADR-018 §4).
 */
export const chasIndicatorDefinitions: IndicatorDefinition[] = [
  definitionFor(
    "cost_burdened_renter_share",
    "Percent of renter households paying more than the cost-burden threshold of income toward housing (CHAS).",
    "renter_share",
  ),
  definitionFor(
    "cost_burdened_owner_share",
    "Percent of owner households paying more than the cost-burden threshold of income toward housing (CHAS).",
    "owner_share",
  ),
  definitionFor(
    "cost_burdened_renters",
    "Number of renter households paying more than the cost-burden threshold of income toward housing (CHAS).",
    "renters_count",
  ),
  definitionFor(
    "cost_burdened_owners",
    "Number of owner households paying more than the cost-burden threshold of income toward housing (CHAS).",
    "owners_count",
  ),
];
