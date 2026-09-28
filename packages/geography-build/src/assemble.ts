import { ucgidOf } from "@federal-mcps/core";
import { CENSUS_DIVISIONS, CENSUS_REGIONS, COUNTY_CHANGES, PUBLISHES_AT } from "./data/static.js";
import { parseAcsPopulation } from "./parse/acs-population.js";
import { parseBeaCombinations } from "./parse/bea-geofips.js";
import { parseDelineation } from "./parse/delineation.js";
import {
  parseCesArea,
  parseCpiArea,
  parseLausArea,
  parseOewsArea,
  parseQcewArea,
} from "./parse/bls-area.js";
import { parseGazetteer, stripLsad } from "./parse/gazetteer.js";
import { parseGeocorr } from "./parse/geocorr.js";
import {
  parseCdCounty,
  parseCdPlace,
  parsePlaceCounty,
  parseTractLineage,
  parseZctaCounty,
  parseZctaPlace,
  parseZctaTract,
} from "./parse/relationship.js";
import type {
  AgencyCodeRow,
  AliasRow,
  CatalogRows,
  ContainmentRow,
  EntityRow,
  LineageRow,
} from "./types.js";

/** The source files a catalog build reads, as already-decoded text. */
export interface Sources {
  /** Census National Gazetteer files, keyed by the summary level they contain. */
  gazetteers: Partial<Record<string, string>>;
  /**
   * The 2020 county-subdivision gazetteer (#241), joined to the 2025 one by ANSI code so a
   * recoded town (Connecticut's 2022 planning regions) carries its 2020 GEOID as a code.
   */
  cousubs2020?: string;
  /**
   * OMB's CBSA delineation as spreadsheet rows (`list1_2023.xlsx`, read by `parse/delineation.ts`):
   * each county's metropolitan or micropolitan statistical area (#271).
   */
  cbsaDelineation?: readonly (readonly string[])[];
  /** BEA's Regional GeoFips list (JSON), for its combination areas (#257, ADR-019 §6). */
  beaGeoFips?: string;
  /** BLS LABSTAT area tables, when present. */
  lausArea?: string;
  cesArea?: string;
  oewsArea?: string;
  cpiArea?: string;
  /** QCEW `area_titles.csv`: metro `C`-codes onto CBSAs (#153, ADR-013 §5). */
  qcewArea?: string;
  /** Census 2020 relationship files (ADR-008 §2, #55). */
  zctaTract?: string;
  zctaCounty?: string;
  zctaPlace?: string;
  cdCounty?: string;
  cdPlace?: string;
  /** Place↔county weighted containment, when a source carries the tab20 shape (#55). */
  placeCounty?: string;
  /** `tab20_tract20_tract10_natl.txt`, 2010→2020 tract succession (#55). */
  tractLineage?: string;
  /** The vendored Geocorr export (#55); population-weighted, wins over relationship shares. */
  geocorr?: string;
  /**
   * ACS 5-year total population API responses (`B01003_001E`, ADR-014 §6, #172), JSON text
   * keyed by summary level ("040", "050", "160", "310", "860", "020", "030"). Each entity
   * whose UCGID appears in one of these responses gets `population` and `populationVintage`
   * set; entities absent from every response keep a null population.
   */
  acsPopulation?: Partial<Record<string, string>>;
}

/** The ACS 5-year vintage `SOURCE_URLS.acsPopulation` defaults to (`download.ts`, ADR-014 §6). */
const ACS_POPULATION_VINTAGE = "2024";

/**
 * Turns source file contents into the rows a catalog build inserts. Pure and testable —
 * the CLI does the downloading, this does the parsing and the derivations.
 *
 * Containment combines three layers: STRICT geoid-nesting (county in state, tract in
 * county, place in state — share always 1.0), area-weighted overlap from the Census 2020
 * relationship files, and population-weighted overlap from the vendored Geocorr export.
 * Where both a relationship file and Geocorr cover the same `(child, parent)` edge,
 * Geocorr's population-weighted share wins (#55; see `parse/geocorr.ts`).
 */
export function assemble(sources: Sources): CatalogRows {
  const entities: EntityRow[] = [];
  const aliases: AliasRow[] = [];

  for (const [sumlevel, text] of Object.entries(sources.gazetteers)) {
    if (!text) continue;
    const parsed = parseGazetteer(text, sumlevel);
    extend(entities, parsed.entities);
    extend(aliases, parsed.aliases);
  }

  // Census regions and divisions (#154, ADR-013 §6): built from the static table, nested
  // state → division → region, so CPI can walk up and later servers reuse the levels.
  const regional = regionDivisionRows();
  extend(entities, regional.entities);
  extend(aliases, regional.aliases);

  const agencyCodes: AgencyCodeRow[] = [];
  if (sources.cousubs2020) extend(agencyCodes, recodedCousubGeoids(entities, sources.cousubs2020));
  if (sources.beaGeoFips) extend(agencyCodes, parseBeaCombinations(sources.beaGeoFips, entities));
  if (sources.lausArea) {
    extend(agencyCodes, parseLausArea(sources.lausArea));
    extend(agencyCodes, lausTownCodes(entities, sources.lausArea));
  }
  if (sources.cesArea) extend(agencyCodes, parseCesArea(sources.cesArea));
  if (sources.oewsArea) extend(agencyCodes, parseOewsArea(sources.oewsArea));
  if (sources.cpiArea) extend(agencyCodes, parseCpiArea(sources.cpiArea));
  if (sources.qcewArea) extend(agencyCodes, parseQcewArea(sources.qcewArea));

  // Relationship-file edges are areal overlaps (ZCTA/CD layers do not nest); a place
  // spanning counties is a hierarchy allocation ("nests"). (#57 discriminator.)
  const weighted: ContainmentRow[] = [];
  if (sources.zctaTract)
    extend(weighted, withRelation(parseZctaTract(sources.zctaTract), "overlaps"));
  if (sources.zctaCounty)
    extend(weighted, withRelation(parseZctaCounty(sources.zctaCounty), "overlaps"));
  if (sources.zctaPlace)
    extend(weighted, withRelation(parseZctaPlace(sources.zctaPlace), "overlaps"));
  if (sources.cdCounty) extend(weighted, withRelation(parseCdCounty(sources.cdCounty), "overlaps"));
  if (sources.cdPlace) extend(weighted, withRelation(parseCdPlace(sources.cdPlace), "overlaps"));
  if (sources.placeCounty)
    extend(weighted, withRelation(parsePlaceCounty(sources.placeCounty), "nests"));

  const geocorr: ContainmentRow[] = [];
  if (sources.geocorr) {
    for (const pair of ["place_county", "cousub_cbsa", "zcta_tract"]) {
      const rel = pair.startsWith("zcta") ? "overlaps" : "nests";
      extend(geocorr, withRelation(parseGeocorr(sources.geocorr, pair), rel));
    }
  }

  const lineage: LineageRow[] = sources.tractLineage ? parseTractLineage(sources.tractLineage) : [];

  applyAcsPopulation(entities, sources.acsPopulation);

  return {
    entities,
    aliases,
    containment: [
      ...deriveStrictContainment(entities),
      ...deriveTownTwins(entities),
      ...countyCbsaEdges(entities, sources.cbsaDelineation),
      ...regional.containment,
      ...mergeWeighted(weighted, geocorr),
    ],
    agencyCodes,
    publishesAt: [...PUBLISHES_AT],
    countyChange: [...COUNTY_CHANGES],
    lineage,
  };
}

/**
 * Sets `population`/`populationVintage` on every entity whose UCGID appears in one of the
 * per-summary-level ACS responses (#172); entities absent from every response are left
 * untouched, so they keep a null population at insert (`catalog.ts`).
 */
function applyAcsPopulation(
  entities: EntityRow[],
  acsPopulation: Partial<Record<string, string>> | undefined,
): void {
  if (!acsPopulation) return;
  const byUcgid = new Map<string, number | null>();
  for (const [sumlevel, text] of Object.entries(acsPopulation)) {
    if (!text) continue;
    for (const row of parseAcsPopulation(JSON.parse(text), sumlevel)) {
      byUcgid.set(row.ucgid, row.population);
    }
  }
  for (const e of entities) {
    if (!byUcgid.has(e.ucgid)) continue;
    e.population = byUcgid.get(e.ucgid) ?? null;
    e.populationVintage = ACS_POPULATION_VINTAGE;
  }
}

/**
 * Combines area-weighted (relationship-file) and population-weighted (Geocorr) containment
 * for the same `(child, parent)` edge, letting Geocorr win — it is population-weighted and
 * declared authoritative (#55, `data/geocorr/README.md`).
 */
function mergeWeighted(
  relationship: readonly ContainmentRow[],
  geocorr: readonly ContainmentRow[],
): ContainmentRow[] {
  const byKey = new Map<string, ContainmentRow>();
  for (const row of relationship) byKey.set(`${row.childUcgid} ${row.parentUcgid}`, row);
  for (const row of geocorr) byKey.set(`${row.childUcgid} ${row.parentUcgid}`, row); // Geocorr wins
  return [...byKey.values()];
}

/**
 * Strict, share=1.0 nesting from GEOIDs alone: county→state, tract→county, place→state.
 * Only emitted when the parent entity is actually present, so we never point at a missing
 * row. Non-nesting relations (place↔county, county↔CBSA) are #55's weighted containment.
 */
function withRelation(
  rows: readonly ContainmentRow[],
  relation: "nests" | "overlaps",
): ContainmentRow[] {
  return rows.map((r) => ({ ...r, relation }));
}

/**
 * Append every item of `source` to `target`. Used instead of `target.push(...source)`
 * because the national relationship files run to hundreds of thousands of rows, and a
 * spread into a function call overflows the argument-count / call-stack limit (#73).
 */
function extend<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}

function deriveStrictContainment(entities: EntityRow[]): ContainmentRow[] {
  const present = new Set(entities.map((e) => e.ucgid));
  const out: ContainmentRow[] = [];
  const add = (childUcgid: string, parentUcgid: string): void => {
    if (present.has(parentUcgid))
      out.push({ childUcgid, parentUcgid, share: 1, relation: "nests" });
  };
  for (const e of entities) {
    switch (e.sumlevel) {
      case "050": // county → state
        add(e.ucgid, ucgidOf("040", e.geoid.slice(0, 2)));
        break;
      case "140": // tract → county
        add(e.ucgid, ucgidOf("050", e.geoid.slice(0, 5)));
        break;
      case "160": // place → state (place↔county is weighted, #55)
        add(e.ucgid, ucgidOf("040", e.geoid.slice(0, 2)));
        break;
      case "060": // county subdivision → county, state (#241)
        add(e.ucgid, ucgidOf("050", e.geoid.slice(0, 5)));
        add(e.ucgid, ucgidOf("040", e.geoid.slice(0, 2)));
        break;
      default:
        break;
    }
  }
  return out;
}

/** County → CBSA edges from OMB's delineation (#271), only between entities this catalog holds. */
function countyCbsaEdges(
  entities: readonly EntityRow[],
  delineation: readonly (readonly string[])[] | undefined,
): ContainmentRow[] {
  if (!delineation) return [];
  const present = new Set(entities.map((e) => e.ucgid));
  return parseDelineation(delineation).filter(
    (e) => present.has(e.childUcgid) && present.has(e.parentUcgid),
  );
}

/** County-subdivision functional statuses that mean a working government (Census FUNCSTAT). */
const CONSOLIDATED_FUNCSTAT = new Set(["B", "C"]);

/**
 * Place → county-subdivision edges for the same municipality (#241), so the resolver can fold a
 * town into its city and an agency that publishes by town (HUD in New England) can reach it from
 * the city. Two rules, both from Census data, never from a typed table:
 *
 * 1. Same state and same 5-digit FIPS code — Census gives a place and a county subdivision that
 *    are the same municipality one code (Boston city 2507000 ↔ Boston city 2502507000). A city
 *    split across counties has one subdivision per county; its share is that part's land area
 *    over the parts' total (Columbus, OH).
 * 2. A consolidated town (FUNCSTAT B or C: one government with a city) whose bare name matches
 *    exactly one place in its state, when that state has exactly one such town by that name —
 *    Hartford town 0911037070 ↔ Hartford city 0937000, whose codes differ. Anything less certain
 *    gets no edge (the resolver then reports both, never guessing).
 */
function deriveTownTwins(entities: readonly EntityRow[]): ContainmentRow[] {
  const cousubsByStateCode = new Map<string, EntityRow[]>();
  const consolidatedByStateName = new Map<string, EntityRow[]>();
  const placesByStateName = new Map<string, EntityRow[]>();
  const push = (m: Map<string, EntityRow[]>, key: string, e: EntityRow) => {
    const list = m.get(key);
    if (list) list.push(e);
    else m.set(key, [e]);
  };
  for (const e of entities) {
    if (e.sumlevel === "060") {
      push(cousubsByStateCode, `${e.geoid.slice(0, 2)}:${e.geoid.slice(5)}`, e);
      if (e.funcstat && CONSOLIDATED_FUNCSTAT.has(e.funcstat))
        push(consolidatedByStateName, `${e.geoid.slice(0, 2)}:${bareName(e.name)}`, e);
    } else if (e.sumlevel === "160") {
      push(placesByStateName, `${e.geoid.slice(0, 2)}:${bareName(e.name)}`, e);
    }
  }

  const out: ContainmentRow[] = [];
  const linked = new Set<string>();
  for (const place of entities) {
    if (place.sumlevel !== "160") continue;
    const twins = cousubsByStateCode.get(`${place.geoid.slice(0, 2)}:${place.geoid.slice(2)}`);
    if (!twins) continue;
    const total = twins.reduce((sum, t) => sum + (t.aland ?? 0), 0);
    for (const t of twins) {
      const share = total > 0 ? (t.aland ?? 0) / total : 1 / twins.length;
      out.push({ childUcgid: place.ucgid, parentUcgid: t.ucgid, share, relation: "nests" });
      linked.add(t.ucgid);
    }
  }
  for (const [key, towns] of consolidatedByStateName) {
    const places = placesByStateName.get(key);
    const town = towns[0];
    const place = places?.[0];
    if (towns.length !== 1 || places?.length !== 1 || !town || !place || linked.has(town.ucgid))
      continue;
    out.push({ childUcgid: place.ucgid, parentUcgid: town.ucgid, share: 1, relation: "nests" });
  }
  return out;
}

function bareName(name: string): string {
  return stripLsad(name).toLowerCase();
}

/**
 * The 2020 GEOID of every county subdivision whose GEOID changed since, joined by its permanent
 * ANSI code (#241): Connecticut's 2022 planning regions recoded all 169 towns (0900337070 →
 * 0911037070), and agencies keep publishing earlier years under the old code.
 */
function recodedCousubGeoids(
  entities: readonly EntityRow[],
  gazetteer2020: string,
): AgencyCodeRow[] {
  const old = new Map<string, string>();
  for (const e of parseGazetteer(gazetteer2020, "060").entities)
    if (e.gnis) old.set(e.gnis, e.geoid);
  const out: AgencyCodeRow[] = [];
  for (const e of entities) {
    if (e.sumlevel !== "060" || !e.gnis) continue;
    const before = old.get(e.gnis);
    if (!before || before === e.geoid) continue;
    out.push({
      ucgid: e.ucgid,
      agency: "census",
      program: "GEOID2020",
      code: before,
      codeVintage: 2020,
      note: "the 2020 GEOID, changed since by a Census recode (e.g. Connecticut's 2022 planning regions)",
    });
  }
  return out;
}

/**
 * LAUS county-subdivision codes (#241): `CS` + state FIPS + the 5-digit town code, no county
 * (`CS2509175000000` Brookline town, MA; `CS4216920000000` Cranberry township, PA). A town code
 * is unique within its state, so the code maps to every county part of that town; a code with no
 * matching county subdivision maps to nothing.
 */
function lausTownCodes(entities: readonly EntityRow[], laArea: string): AgencyCodeRow[] {
  const towns = new Map<string, EntityRow[]>();
  for (const e of entities) {
    if (e.sumlevel !== "060") continue;
    const key = `${e.geoid.slice(0, 2)}${e.geoid.slice(5)}`;
    const list = towns.get(key);
    if (list) list.push(e);
    else towns.set(key, [e]);
  }
  const out: AgencyCodeRow[] = [];
  for (const line of laArea.split(/\r?\n/)) {
    const code = line.split("\t")[1]?.trim();
    if (!code || !code.startsWith("CS") || code.length !== 15) continue;
    for (const town of towns.get(code.slice(2, 9)) ?? []) {
      out.push({
        ucgid: town.ucgid,
        agency: "bls",
        program: "LAUS",
        code,
        codeVintage: null,
        note: null,
      });
    }
  }
  return out;
}

/** Region/division entities, their aliases, and the state → division → region nesting (#154). */
function regionDivisionRows(): {
  entities: EntityRow[];
  aliases: AliasRow[];
  containment: ContainmentRow[];
} {
  const blank = {
    lsad: null,
    funcstat: null,
    stateFips: null,
    gnis: null,
    lat: null,
    lon: null,
    aland: null,
  };
  const entities: EntityRow[] = [];
  const aliases: AliasRow[] = [];
  const containment: ContainmentRow[] = [];
  for (const r of CENSUS_REGIONS) {
    const ucgid = ucgidOf("020", r.code);
    entities.push({ ucgid, geoid: r.code, sumlevel: "020", name: r.name, ...blank });
    aliases.push({ ucgid, alias: `${r.name} region`, source: "hand" });
  }
  for (const d of CENSUS_DIVISIONS) {
    const ucgid = ucgidOf("030", d.code);
    entities.push({ ucgid, geoid: d.code, sumlevel: "030", name: d.name, ...blank });
    aliases.push({ ucgid, alias: `${d.name} division`, source: "hand" });
    containment.push({
      childUcgid: ucgid,
      parentUcgid: ucgidOf("020", d.region),
      share: 1,
      relation: "nests",
    });
    for (const state of d.states) {
      containment.push({
        childUcgid: ucgidOf("040", state),
        parentUcgid: ucgid,
        share: 1,
        relation: "nests",
      });
    }
  }
  return { entities, aliases, containment };
}
