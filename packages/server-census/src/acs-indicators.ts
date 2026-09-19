import type {
  DimensionDefinition,
  DimensionSelection,
  IndicatorDefinition,
  PlaceCandidate,
} from "@federal-mcps/core";
import {
  ACS_VINTAGE,
  type AcsFamily,
  type AcsProduct,
  acsFetch,
  buildAcsSeriesKey,
  chooseProduct,
} from "./acs.js";

/**
 * The thirteen ACS headline indicators (ADR-014 §1) on the registry seam. Each is one verified
 * variable from one endpoint family (docs/spikes/m8-census.md, 2024 metadata). The "agency code"
 * for a place carries what the product rule needs — `ucgid|population|sumlevel` — and
 * `buildSeriesId` turns it into an ACS series key after choosing the product (ADR-014 §2). The
 * product and its reason travel as the answer's limitation via `caveatOf`.
 */
export const ACS_PROGRAM = "ACS";

/** Every place has an ACS code: the catalog's ucgid plus the population the product rule reads. */
export function acsCodeOf(place: PlaceCandidate): string {
  return `${place.ucgid}|${place.population ?? ""}|${place.kind.sumlevel}`;
}

function decode(code: string): { ucgid: string; population: number | null; sumlevel: string } {
  const [ucgid = "", pop = "", sumlevel = ""] = code.split("|");
  return { ucgid, population: pop === "" ? null : Number(pop), sumlevel };
}

function requestedProduct(dimensions: DimensionSelection): AcsProduct | undefined {
  const p = dimensions.product;
  return p === "1-year" || p === "5-year" ? p : undefined;
}

const PRODUCT_DIMENSION: DimensionDefinition = {
  argument: "product",
  description:
    "Which ACS product: auto (1-year at 65,000+ people, else 5-year), 1-year, or 5-year. A 1-year request below the threshold is answered with the 5-year figure and says so.",
  default: "auto",
  vocabulary: [
    { code: "auto", label: "by population (1-year at 65,000+, else 5-year)" },
    { code: "1-year", label: "ACS 1-year estimate (areas of 65,000 or more)" },
    { code: "5-year", label: "ACS 5-year estimate (every area; a five-year period)" },
  ],
};

interface AcsSpec {
  name: string;
  variable: string;
  family: AcsFamily;
  description: string;
}

/** Verified against the 2024 detailed/subject/profile metadata on 2026-09-18 (docs/spikes/m8-census.md). */
const SPECS: readonly AcsSpec[] = [
  {
    name: "population",
    variable: "B01003_001",
    family: "detailed",
    description: "Total population (ACS estimate).",
  },
  {
    name: "median_age",
    variable: "B01002_001",
    family: "detailed",
    description: "Median age (years).",
  },
  {
    name: "median_household_income",
    variable: "B19013_001",
    family: "detailed",
    description:
      "Median household income in the past 12 months (inflation-adjusted dollars of the vintage year).",
  },
  {
    name: "per_capita_income",
    variable: "B19301_001",
    family: "detailed",
    description: "Per capita income in the past 12 months (inflation-adjusted dollars).",
  },
  {
    name: "poverty_rate",
    variable: "S1701_C03_001",
    family: "subject",
    description:
      "Percent of the population for whom poverty status is determined that is below the poverty level.",
  },
  {
    name: "unemployment_rate_acs",
    variable: "S2301_C04_001",
    family: "subject",
    description:
      "Unemployment rate, population 16 years and over (ACS; the official monthly rate is BLS LAUS).",
  },
  {
    name: "bachelors_or_higher",
    variable: "S1501_C02_015",
    family: "subject",
    description: "Percent of the population 25 years and over with a bachelor's degree or higher.",
  },
  {
    name: "uninsured_rate",
    variable: "S2701_C05_001",
    family: "subject",
    description:
      "Percent of the civilian noninstitutionalized population without health insurance.",
  },
  {
    name: "mean_commute_minutes",
    variable: "S0801_C01_046",
    family: "subject",
    description:
      "Mean travel time to work in minutes, workers 16 and over who did not work from home.",
  },
  {
    name: "median_gross_rent",
    variable: "B25064_001",
    family: "detailed",
    description: "Median gross rent (dollars).",
  },
  {
    name: "median_home_value",
    variable: "B25077_001",
    family: "detailed",
    description: "Median value of owner-occupied housing units (dollars).",
  },
  {
    name: "owner_occupied_share",
    variable: "DP04_0046P",
    family: "profile",
    description: "Percent of occupied housing units that are owner-occupied.",
  },
  {
    name: "median_housing_cost",
    variable: "S2503_C01_024",
    family: "subject",
    description: "Median monthly housing costs, occupied housing units (dollars).",
  },
];

function periodLabel(product: AcsProduct): string {
  return product === "1-year"
    ? `${ACS_VINTAGE} 1-year`
    : `${Number(ACS_VINTAGE) - 4}–${ACS_VINTAGE} 5-year`;
}

export const acsIndicatorDefinitions: IndicatorDefinition[] = SPECS.map((spec) => ({
  name: spec.name,
  program: ACS_PROGRAM,
  description: `${spec.description} American Community Survey; every value carries a margin of error and a reliability grade.`,
  defaultSeasonallyAdjusted: false,
  agencyCodeOf: acsCodeOf,
  buildSeriesId: (code, { dimensions }) => {
    const { ucgid, population, sumlevel } = decode(code);
    const { product } = chooseProduct({
      population,
      sumlevel,
      requested: requestedProduct(dimensions),
    });
    return buildAcsSeriesKey({
      vintage: ACS_VINTAGE,
      product,
      family: spec.family,
      variable: spec.variable,
      ucgid,
    });
  },
  caveatOf: (place, dimensions) => {
    const { product, reason } = chooseProduct({
      population: place.population,
      sumlevel: place.kind.sumlevel,
      requested: requestedProduct(dimensions),
    });
    return `ACS ${periodLabel(product)} estimate shown: ${reason}.`;
  },
  dimensions: [PRODUCT_DIMENSION],
  // Compare on one product (ADR-014 §5): when sizes mix and no product was requested, every
  // place reads the 5-year product — the only one all of them have — and the answer says so.
  alignDimensions: (places, dimensions) => {
    if (requestedProduct(dimensions) !== undefined) return undefined;
    const below = places.filter(
      (p) =>
        chooseProduct({ population: p.population, sumlevel: p.kind.sumlevel }).product === "5-year",
    );
    if (below.length === 0 || below.length === places.length) return undefined;
    const names = below.map((p) => p.name).join(", ");
    return {
      dimensions: { ...dimensions, product: "5-year" },
      note: `Compared on the ACS ${periodLabel("5-year")} product for every place: ${names} ${below.length === 1 ? "is" : "are"} below 65,000 people (or of unknown population), and ACS 1-year estimates exist only at 65,000 or more.`,
    };
  },
  fetch: acsFetch,
}));
