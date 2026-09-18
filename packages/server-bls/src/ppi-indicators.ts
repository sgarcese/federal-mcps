import { buildWpuSeriesId, PPI_FINAL_DEMAND } from "./ppi.js";
import type { DimensionDefinition, IndicatorDefinition } from "./registry.js";

/**
 * PPI registered as an indicator definition (ADR-013 §7, #155) — the first program with **no
 * geography**. `scope: "national"` tells `bls_get_indicator` that `place` is optional and that a
 * place, when given, only names the caveat: the answer is always the national series. The `item`
 * dimension (ADR-013 §1–2) picks a commodity index; the default is final demand, the headline.
 * Every code below was verified live on 2026-09-17 (see ppi.ts's header).
 */
const PPI_PROGRAM = "PPI";

/** The opaque "agency code" for the nation; PPI ignores it, the series id is the item alone. */
export const PPI_NATIONAL_CODE = "US";

const PPI_ITEM_DIMENSION: DimensionDefinition = {
  argument: "item",
  description: "A PPI commodity or final-demand index (default: final demand).",
  default: PPI_FINAL_DEMAND,
  vocabulary: [
    { code: "FD4", label: "final demand" },
    { code: "FD49104", label: "final demand less foods and energy" },
    { code: "FD49116", label: "final demand less foods, energy, and trade services" },
    { code: "FD49207", label: "final demand: finished goods" },
    { code: "00000000", label: "all commodities" },
    { code: "03THRU15", label: "industrial commodities" },
    { code: "IP2311001", label: "inputs to residential construction, goods" },
    { code: "IP2312001", label: "inputs to nonresidential construction, goods" },
    { code: "08", label: "lumber and wood products" },
    { code: "081", label: "lumber" },
    { code: "10", label: "metals and metal products" },
    { code: "101", label: "iron and steel" },
    { code: "1017", label: "steel mill products" },
    { code: "13", label: "nonmetallic mineral products" },
    { code: "132", label: "concrete ingredients and related products" },
    { code: "133", label: "concrete products" },
    { code: "0571", label: "gasoline" },
  ],
};

/** PPI commodity indexes, national only, NSA by default. */
export const ppiIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "producer_price_index",
    program: PPI_PROGRAM,
    scope: "national",
    description:
      "Producer Price Index (national only): final demand by default; pass item for a commodity index such as inputs to construction, lumber, steel or concrete (see bls_list_indicators). No state or metro PPI exists.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: () => PPI_NATIONAL_CODE,
    buildSeriesId: (_code, { seasonallyAdjusted, dimensions }) =>
      buildWpuSeriesId(dimensions.item ?? PPI_FINAL_DEMAND, { seasonallyAdjusted }),
    dimensions: [PPI_ITEM_DIMENSION],
  },
];
