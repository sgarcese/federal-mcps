import type { GeographyCatalog, PlaceCandidate } from "@federal-mcps/core";
import { type IndicatorFetch, timeseriesFetch } from "./series-fetch.js";

/**
 * The BLS indicator registry (ADR-010 §1). `bls_get_indicator` used to hardcode LAUS; the
 * registry turns it into a table of indicators, each mapping the model-facing name to its BLS
 * program, the place's agency code, a series-id builder and the program's defaults — so the tool
 * dispatches across programs (LAUS now, CES/OEWS/CPI/JOLTS in later M4 issues) without ever
 * leaking API shape to the model. The family-verb dispatch stays generic; the vocabulary is
 * agency-specific and lives here in server-bls.
 */

/** A place's agency codes, the shape the registry reads off a resolved candidate. */
export interface PlaceAgencyCodes {
  agencyCodes: { agency: string; program: string; code: string }[];
}

/**
 * A below-coverage substitute: when a place has no direct series for a program that defines a
 * fallback (e.g. a city below the LAUS 25,000 threshold → its surrounding county), the program
 * returns the substitute place's geoid/name/summary-level, its agency code, and the caveat that
 * must travel in the envelope. Never a silent substitution or a fabricated number (ADR-009 §6).
 */
export interface IndicatorFallback {
  geoid: string;
  name: string;
  sumlevel: string;
  code: string;
  caveat: string;
}

/** The named picker arguments a tool accepts (ADR-013 §1). Fixed set; each indicator declares which apply. */
export const DIMENSION_ARGUMENTS = ["item", "industry", "ownership", "occupation"] as const;
export type DimensionArgument = (typeof DIMENSION_ARGUMENTS)[number];

/** One entry a model may pick for a dimension: the code the series id / row picker uses, and its label. */
export interface DimensionVocabularyEntry {
  code: string;
  label: string;
}

/**
 * A dimension an indicator declares (ADR-013 §1–2): which tool argument carries it, a curated
 * vocabulary (published by `bls_list_indicators`), and the code used when the argument is omitted —
 * always today's headline, so declaring a dimension changes no existing call.
 */
export interface DimensionDefinition {
  argument: DimensionArgument;
  description: string;
  vocabulary: readonly DimensionVocabularyEntry[];
  default: string;
}

/** The resolved codes for an indicator's dimensions, defaults filled: what `buildSeriesId` receives. */
export type DimensionSelection = Partial<Record<DimensionArgument, string>>;

/** Options a definition's series-id builder receives. */
export interface BuildSeriesIdOptions {
  seasonallyAdjusted: boolean;
  dimensions: DimensionSelection;
}

/**
 * Validate the picker arguments a caller passed against what `def` declares, and fill defaults.
 * Never a silent default for a bad code: an argument the indicator does not declare, or a code
 * outside its vocabulary, is rejected with a message naming what is accepted (ADR-013 §1).
 */
export function resolveDimensions(
  def: IndicatorDefinition,
  args: DimensionSelection,
): { ok: true; selection: DimensionSelection } | { ok: false; message: string } {
  const declared = def.dimensions ?? [];
  const byArgument = new Map(declared.map((d) => [d.argument, d]));
  for (const argument of DIMENSION_ARGUMENTS) {
    const value = args[argument];
    if (value === undefined || byArgument.has(argument)) continue;
    const accepted = declared.map((d) => d.argument);
    return {
      ok: false,
      message:
        accepted.length === 0
          ? `"${argument}" is not accepted: indicator ${def.name} takes no dimension arguments.`
          : `"${argument}" is not accepted: indicator ${def.name} takes ${accepted.join(", ")}.`,
    };
  }
  const selection: DimensionSelection = {};
  for (const dim of declared) {
    const value = args[dim.argument] ?? dim.default;
    if (!dim.vocabulary.some((v) => v.code === value)) {
      const codes = dim.vocabulary.map((v) => `${v.code} (${v.label})`).join(", ");
      return {
        ok: false,
        message: `${dim.argument} "${value}" is not in ${def.name}'s vocabulary; accepted: ${codes}. See bls_list_indicators.`,
      };
    }
    selection[dim.argument] = value;
  }
  return { ok: true, selection };
}

/** One indicator the model can request, and everything the handler needs to answer it. */
export interface IndicatorDefinition {
  /** The indicator name the model uses, e.g. "unemployment_rate". */
  name: string;
  /** The BLS program code that answers it, e.g. "LAUS". */
  program: string;
  /** Plain-language description, surfaced by `bls_list_indicators`. */
  description: string;
  /** Default seasonal adjustment for this program (ADR-010 §5). */
  defaultSeasonallyAdjusted: boolean;
  /**
   * The program's agency code on a resolved place, if it publishes at that place's level. Receives
   * the full candidate so a program can derive a code from the place's geography (e.g. CES uses a
   * state's FIPS geoid), not only read it off `agencyCodes`.
   */
  agencyCodeOf(place: PlaceCandidate): string | undefined;
  /**
   * Build the series id (or a program's opaque key) from the agency code, the seasonal option and
   * the resolved dimension codes (`options.dimensions`, defaults filled — empty when the indicator
   * declares none).
   */
  buildSeriesId(code: string, options: BuildSeriesIdOptions): string;
  /** Dimensions this indicator accepts as named picker arguments (ADR-013 §1). Omit for none. */
  dimensions?: readonly DimensionDefinition[];
  /**
   * A caveat that must travel with a DIRECT series for this place (the code exists, but with a
   * condition — e.g. a multi-state metro CES files under one state, #153). Undefined when none.
   */
  caveatOf?(place: PlaceCandidate): string | undefined;
  /** The program's below-coverage fallback, if it defines one (undefined when not eligible). */
  fallback?(catalog: GeographyCatalog, place: PlaceCandidate): IndicatorFallback | undefined;
  /**
   * How this indicator fetches observations for its series keys (ADR-011 §2). Omit for the
   * timeseries default (LAUS/CES/OEWS/CPI/JOLTS — the BLS Public Data API); a non-timeseries
   * program supplies its own (QCEW's CSV slices, #124), so `bls_get_indicator`/`bls_compare_places`
   * dispatch through the capability rather than assuming the timeseries API.
   */
  fetch?: IndicatorFetch;
}

/** The fetch capability for a definition: its own if it has one, else the timeseries default. */
export function fetchStrategyOf(def: IndicatorDefinition): IndicatorFetch {
  return def.fetch ?? timeseriesFetch;
}

/** A read-only lookup over a set of indicator definitions, keyed by name. */
export interface IndicatorRegistry {
  get(name: string): IndicatorDefinition | undefined;
  list(): IndicatorDefinition[];
  names(): string[];
}

/** Build a registry from a set of definitions. Names are unique; later duplicates win. */
export function createIndicatorRegistry(
  definitions: readonly IndicatorDefinition[],
): IndicatorRegistry {
  const byName = new Map(definitions.map((d) => [d.name, d]));
  return {
    get: (name) => byName.get(name),
    list: () => [...byName.values()],
    names: () => [...byName.keys()],
  };
}
