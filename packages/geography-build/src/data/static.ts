import type { CountyChangeRow, PublishesAtRow } from "../types.js";

/**
 * CPI publishes for the U.S. city average, regions/divisions, and ~23 named metros whose
 * bespoke `cu.area` codes are not derivable from FIPS/CBSA. This hand table maps the
 * metro codes to their CBSA GEOID. Titles in cu.area lag the current delineation, so the
 * GEOID is authoritative here, not the CPI title. Extend as BLS adds/renames metros.
 */
export const CPI_AREA_TO_CBSA: Readonly<Record<string, string>> = Object.freeze({
  S49A: "38060", // Phoenix-Mesa-Chandler, AZ
  S49B: "41740", // San Diego-Chula Vista-Carlsbad, CA
  S49C: "42660", // Seattle-Tacoma-Bellevue, WA
  S49D: "38900", // Portland-Vancouver-Hillsboro, OR-WA
  S49E: "41860", // San Francisco-Oakland-Berkeley, CA (CPI groups the Bay Area)
  S49F: "31080", // Los Angeles-Long Beach-Anaheim, CA
  S49G: "19820", // Detroit-Warren-Dearborn, MI
  S48A: "16980", // Chicago-Naperville-Elgin, IL-IN-WI
  S48B: "19740", // Denver-Aurora-Lakewood, CO
  S24A: "47900", // Washington-Arlington-Alexandria, DC-VA-MD-WV
  S24B: "33100", // Miami-Fort Lauderdale-Pompano Beach, FL
  S23A: "12060", // Atlanta-Sandy Springs-Alpharetta, GA
  S23B: "45300", // Tampa-St. Petersburg-Clearwater, FL
  S35A: "35620", // New York-Newark-Jersey City, NY-NJ-PA
  S35B: "37980", // Philadelphia-Camden-Wilmington, PA-NJ-DE-MD
  S35C: "14460", // Boston-Cambridge-Newton, MA-NH
  S37A: "12580", // Baltimore-Columbia-Towson, MD
  S37B: "33340", // Milwaukee (grouped) — approximate; verify at build
  S11A: "35380", // New Orleans-Metairie, LA (grouped)
  S12A: "26420", // Houston-The Woodlands-Sugar Land, TX
  S12B: "19100", // Dallas-Fort Worth-Arlington, TX
  S35D: "38300", // Pittsburgh, PA (grouped)
  S49H: "41940", // San Jose-Sunnyvale-Santa Clara, CA
});

/**
 * Which summary level each program publishes at, and any constraint the model must know.
 * Powers `publishes_at` and the geography guide (ADR-003 §9). BLS Release 1 programs.
 */
export const PUBLISHES_AT: readonly PublishesAtRow[] = [
  { agency: "bls", program: "LAUS", sumlevel: "040", constraintNote: null },
  { agency: "bls", program: "LAUS", sumlevel: "050", constraintNote: null },
  { agency: "bls", program: "LAUS", sumlevel: "310", constraintNote: null },
  {
    agency: "bls",
    program: "LAUS",
    sumlevel: "160",
    constraintNote: "incorporated place, population >= 25000",
  },
  { agency: "bls", program: "SM", sumlevel: "040", constraintNote: null },
  { agency: "bls", program: "SM", sumlevel: "310", constraintNote: null },
  { agency: "bls", program: "OEWS", sumlevel: "040", constraintNote: null },
  { agency: "bls", program: "OEWS", sumlevel: "310", constraintNote: null },
  {
    agency: "bls",
    program: "CPI",
    sumlevel: "310",
    constraintNote: "only ~23 metros; most places have no local CPI",
  },
  { agency: "bls", program: "QCEW", sumlevel: "050", constraintNote: null },
  { agency: "bls", program: "JOLTS", sumlevel: "040", constraintNote: "state only" },
];

/**
 * County-equivalent boundary changes that break naive vintage joins (geography spike).
 * Connecticut replaced its 8 counties with 9 planning regions (2022); Alaska, South
 * Dakota and Virginia have code changes. Stored so the resolver can translate across
 * vintages instead of returning an empty result.
 */
export const COUNTY_CHANGES: readonly CountyChangeRow[] = [
  // Connecticut: 8 counties (09001–09015) → 9 planning regions (09110–09190), 2022.
  { oldGeoid: "09001", newGeoid: "09190", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09003", newGeoid: "09110", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09005", newGeoid: "09160", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09007", newGeoid: "09130", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09009", newGeoid: "09170", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09011", newGeoid: "09180", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09013", newGeoid: "09110", effective: "2022-06-01", kind: "recode" },
  { oldGeoid: "09015", newGeoid: "09150", effective: "2022-06-01", kind: "recode" },
  // Alaska.
  { oldGeoid: "02261", newGeoid: "02063", effective: "2019-01-02", kind: "split" },
  { oldGeoid: "02261", newGeoid: "02066", effective: "2019-01-02", kind: "split" },
  { oldGeoid: "02270", newGeoid: "02158", effective: "2015-07-01", kind: "rename" },
  // South Dakota: Shannon → Oglala Lakota.
  { oldGeoid: "46113", newGeoid: "46102", effective: "2015-05-01", kind: "rename" },
  // Virginia: Bedford city → Bedford County.
  { oldGeoid: "51515", newGeoid: "51019", effective: "2013-07-01", kind: "merge" },
];
