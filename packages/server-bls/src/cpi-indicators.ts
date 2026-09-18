import { type GeographyCatalog, type PlaceCandidate, ucgidOf } from "@federal-mcps/core";
import { buildCuSeriesId, CPI_ALL_ITEMS, CPI_US_CITY_AVERAGE_AREA } from "./cpi.js";
import type { DimensionDefinition, IndicatorDefinition, IndicatorFallback } from "./registry.js";

/**
 * CPI registered as an indicator definition (ADR-010 §1, §4). CPI publishes only for the U.S. city
 * average, census regions/divisions, and ~23 named metros — the catalog carries the metro CPI area
 * codes on those CBSAs. A place that is one of those metros gets its real series; every other place
 * falls back to the U.S. city average with an explicit "CPI is not published for <place>" caveat —
 * never a fabricated local index (ADR-010 §4). (Census region/division fallbacks are a refinement.)
 */
const CPI_PROGRAM = "CPI";

/** The CPI area code on a resolved place, if it is one of the ~23 published metros. */
export function cpiAreaOf(place: PlaceCandidate): string | undefined {
  return place.agencyCodes.find((c) => c.agency === "bls" && c.program === CPI_PROGRAM)?.code;
}

const DIVISION_SUMLEVEL = "030";
const REGION_SUMLEVEL = "020";

/** The CPI code on a catalog entity, if the entity exists and carries one. */
function cpiCodeOfUcgid(catalog: GeographyCatalog, ucgid: string): string | undefined {
  return catalog.agencyCodesOf(ucgid).find((c) => c.agency === "bls" && c.program === CPI_PROGRAM)
    ?.code;
}

/**
 * CPI's "no local CPI" fallback ladder (ADR-013 §6): a place without its own published CPI area
 * reads its Census **division**, else its **region**, else the U.S. city average — each step
 * flagged with a caveat, never a fabricated local index. The ladder walks the catalog's nesting
 * from the place's state (a multi-state metro has no single state and goes straight to the U.S.
 * average). Always returns, so `get_indicator` never reports CPI as unavailable.
 */
function cpiFallback(catalog: GeographyCatalog, place: PlaceCandidate): IndicatorFallback {
  if (place.stateFips) {
    const division = catalog
      .parentsOf(ucgidOf("040", place.stateFips))
      .map((p) => p.entity)
      .find((e) => e.sumlevel === DIVISION_SUMLEVEL);
    const divisionCode = division ? cpiCodeOfUcgid(catalog, division.ucgid) : undefined;
    if (division && divisionCode) {
      return {
        geoid: division.geoid,
        name: `${division.name} division`,
        sumlevel: DIVISION_SUMLEVEL,
        code: divisionCode,
        caveat: `CPI is not published for ${place.name}; showing the ${division.name} division (CPI-U). Local CPI is available only for about 23 large metro areas; many division series publish bimonthly.`,
      };
    }
    const region = division
      ? catalog
          .parentsOf(division.ucgid)
          .map((p) => p.entity)
          .find((e) => e.sumlevel === REGION_SUMLEVEL)
      : undefined;
    const regionCode = region ? cpiCodeOfUcgid(catalog, region.ucgid) : undefined;
    if (region && regionCode) {
      return {
        geoid: region.geoid,
        name: `${region.name} region`,
        sumlevel: REGION_SUMLEVEL,
        code: regionCode,
        caveat: `CPI is not published for ${place.name}; showing the ${region.name} region (CPI-U). Local CPI is available only for about 23 large metro areas; some region series publish bimonthly.`,
      };
    }
  }
  return {
    geoid: CPI_US_CITY_AVERAGE_AREA,
    name: "U.S. city average",
    sumlevel: "010",
    code: CPI_US_CITY_AVERAGE_AREA,
    caveat: `CPI is not published for ${place.name}; showing the U.S. city average (CPI-U). Local CPI is available only for about 23 large metro areas, census divisions and regions.`,
  };
}

/**
 * The curated CPI expenditure-item vocabulary (ADR-013 §1–2, #150) — ~10 groups, each verified
 * against the live BLS API (see cpi.ts's header for the ids and date checked). All items (`SA0`)
 * is the default, so an unqualified call is unchanged.
 */
const CPI_ITEM_DIMENSION: DimensionDefinition = {
  argument: "item",
  description: "A CPI expenditure-item group (default: all items).",
  default: CPI_ALL_ITEMS,
  vocabulary: [
    { code: "SA0", label: "all items" },
    { code: "SAF1", label: "food" },
    { code: "SAF11", label: "food at home" },
    { code: "SAH", label: "housing" },
    { code: "SAH1", label: "shelter" },
    { code: "SA0E", label: "energy" },
    { code: "SETB01", label: "gasoline, all types" },
    { code: "SAM", label: "medical care" },
    { code: "SAT", label: "transportation" },
    { code: "SAA", label: "apparel" },
  ],
};

/** CPI all items (CPI-U), NSA by default (ADR-010 §5); an `item` picks an expenditure group. */
export const cpiIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "cpi_all_items",
    program: CPI_PROGRAM,
    description:
      "Consumer Price Index for All Urban Consumers (CPI-U), all items by default; pass item to pick an expenditure group (e.g. food, housing, energy — see bls_list_indicators).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: cpiAreaOf,
    buildSeriesId: (code, { seasonallyAdjusted, dimensions }) =>
      buildCuSeriesId(code, {
        seasonallyAdjusted,
        ...(dimensions.item ? { item: dimensions.item } : {}),
      }),
    dimensions: [CPI_ITEM_DIMENSION],
    fallback: cpiFallback,
  },
];
