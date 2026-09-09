import { GeographyCatalog } from "./catalog.js";

/**
 * Opens the bundled geography catalog read-only, once per process (ADR-008 §7). Every
 * server in the family that resolves places off the shared catalog — server-geo, and
 * server-bls via `geographyTools` — bakes the `@rc/geo-catalog` artifact into its own
 * deployment zip and points `GEO_CATALOG_PATH` at it (Terraform sets it on the Lambda;
 * the dev servers and tests set it too). The connection is cached so every tool call in
 * a process shares one. A process runs a single server, so one cached catalog is right.
 */
let cached: GeographyCatalog | undefined;

export function openBundledCatalog(): GeographyCatalog {
  if (cached) return cached;
  // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
  const path = process.env["GEO_CATALOG_PATH"];
  if (!path) {
    throw new Error(
      "GEO_CATALOG_PATH is not set: the geography catalog artifact path must be provided (see @rc/geo-catalog bundling, ADR-008 §7).",
    );
  }
  cached = new GeographyCatalog(path);
  return cached;
}

/** Test seam: inject a catalog (a fixture) so a server can be built without a bundled file. */
export function setCatalogForTest(catalog: GeographyCatalog): void {
  cached = catalog;
}
