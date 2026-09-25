/**
 * The observation shapes every indicator fetch capability returns (ADR-011 §2, ADR-014). A
 * "series id" is the program's opaque key: a BLS timeseries id, a QCEW `area|own|industry` key,
 * an ACS `dataset/vintage/variable/ucgid` key. Programs parse their own; the tools never do.
 */
export interface SeriesObservation {
  year: string;
  /** Period code, e.g. "M06" (June), "M13" (annual average), "Q01", "A01", or "5Y" for an ACS 5-year period. */
  period: string;
  periodName: string;
  /** Parsed numeric value, or null when suppressed/blank/annotated. */
  value: number | null;
  footnotes: { code: string; text: string }[];
  /** Margin of error at the program's stated confidence (ACS: 90%), when the program publishes one. */
  marginOfError?: number | null;
  /** Reliability grade from the coefficient of variation, when the program publishes a margin. */
  reliability?: "high" | "medium" | "low";
}

export interface SeriesResult {
  seriesId: string;
  observations: SeriesObservation[];
  /** Caveats from the fetch (e.g. a capped range, an unpublished code), carried as limitations (#213). */
  notes?: string[];
}

export interface SeriesFetchOptions {
  startYear?: number;
  endYear?: number;
  /** Agency registration key. Omitted → unregistered limits; used only in production, never in fixtures. */
  apiKey?: string;
  /**
   * True when the caller asked for years, false when the tool filled its default range (#213): a
   * program whose history is costly (QCEW: one file per quarter) returns only its latest period
   * unless years were asked for.
   */
  explicitYears?: boolean;
  /** Cache TTL (seconds) for a batch response; omit to skip caching. */
  freshTtlSeconds?: number;
}
