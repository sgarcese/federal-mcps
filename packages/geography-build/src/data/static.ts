import { ucgidOf } from "@federal-mcps/core";
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
 * USPS state/territory postal abbreviation → 2-digit FIPS. Reference data (geography-build only,
 * never shipped in a server) used to read a CES metro's state from its `sm.area` title, e.g.
 * "Denver-Aurora-Lakewood, CO" → 08. Covers the 50 states, DC and PR (CES State & Area coverage).
 */
export const US_STATE_POSTAL_TO_FIPS: Readonly<Record<string, string>> = Object.freeze({
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
  PR: "72",
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
  {
    oldUcgid: ucgidOf("050", "09001"),
    newUcgid: ucgidOf("050", "09190"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09003"),
    newUcgid: ucgidOf("050", "09110"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09005"),
    newUcgid: ucgidOf("050", "09160"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09007"),
    newUcgid: ucgidOf("050", "09130"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09009"),
    newUcgid: ucgidOf("050", "09170"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09011"),
    newUcgid: ucgidOf("050", "09180"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09013"),
    newUcgid: ucgidOf("050", "09110"),
    effective: "2022-06-01",
    kind: "recode",
  },
  {
    oldUcgid: ucgidOf("050", "09015"),
    newUcgid: ucgidOf("050", "09150"),
    effective: "2022-06-01",
    kind: "recode",
  },
  // Alaska.
  {
    oldUcgid: ucgidOf("050", "02261"),
    newUcgid: ucgidOf("050", "02063"),
    effective: "2019-01-02",
    kind: "split",
  },
  {
    oldUcgid: ucgidOf("050", "02261"),
    newUcgid: ucgidOf("050", "02066"),
    effective: "2019-01-02",
    kind: "split",
  },
  {
    oldUcgid: ucgidOf("050", "02270"),
    newUcgid: ucgidOf("050", "02158"),
    effective: "2015-07-01",
    kind: "rename",
  },
  // South Dakota: Shannon → Oglala Lakota.
  {
    oldUcgid: ucgidOf("050", "46113"),
    newUcgid: ucgidOf("050", "46102"),
    effective: "2015-05-01",
    kind: "rename",
  },
  // Virginia: Bedford city → Bedford County.
  {
    oldUcgid: ucgidOf("050", "51515"),
    newUcgid: ucgidOf("050", "51019"),
    effective: "2013-07-01",
    kind: "merge",
  },
];
