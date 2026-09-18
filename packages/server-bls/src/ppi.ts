/**
 * PPI (Producer Price Index, program "PPI", commodity series prefix "WPU"/"WPS") series
 * identifiers, built — never typed (CLAUDE.md). A PPI commodity series id is:
 *
 *   WP · seasonal(1: U not adjusted, S adjusted) · item code (2–12 chars, e.g. FD4, 00000000, IP2311001)
 *
 * PPI is published **nationally only** — there is no state or metro PPI (ADR-013 §7), which is why
 * the indicator built on this module carries `scope: "national"`. Verified against the live BLS
 * API on 2026-09-17 (registered key; every id REQUEST_SUCCEEDED with 2026-M08 data): final demand
 * `WPUFD4` 157.604; final demand less foods and energy `WPUFD49104` 154.749; final demand less
 * foods, energy and trade services `WPUFD49116` 143.337; finished goods `WPUFD49207` 282.086;
 * all commodities `WPU00000000` 287.928; industrial commodities `WPU03THRU15` 293.207; lumber and
 * wood products `WPU08` 315.049; lumber `WPU081` 286.633; metals and metal products `WPU10`
 * 388.690; iron and steel `WPU101` 378.128; steel mill products `WPU1017` 381.162; nonmetallic
 * mineral products `WPU13` 368.153; concrete ingredients `WPU132` 478.678; concrete products
 * `WPU133` 409.479; inputs to residential construction, goods `WPUIP2311001` 348.993; inputs to
 * nonresidential construction, goods `WPUIP2312001` 180.686; gasoline `WPU0571` 319.584.
 */

/** The final-demand headline item — the default when no item is chosen. */
export const PPI_FINAL_DEMAND = "FD4";

export interface WpuSeriesOptions {
  /** Seasonally adjusted (`WPS`) vs not (`WPU`, the default). */
  seasonallyAdjusted?: boolean;
}

/** Build a PPI commodity series id from an item code. Throws on a malformed item code. */
export function buildWpuSeriesId(item: string, options: WpuSeriesOptions = {}): string {
  if (!/^[A-Z0-9]{2,12}$/.test(item)) {
    throw new Error(
      `PPI item code must be 2–12 characters of A–Z/0–9 (e.g. "FD4", "IP2311001"); got "${item}".`,
    );
  }
  return `WP${options.seasonallyAdjusted ? "S" : "U"}${item}`;
}

/** True for a well-formed PPI commodity series id (`WP` + U/S + item). */
export function isWpuSeriesId(id: string): boolean {
  return /^WP[US][A-Z0-9]{2,12}$/.test(id);
}
