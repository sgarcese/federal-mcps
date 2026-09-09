import { GeographyCatalog } from "@federal-mcps/core";

/**
 * Opens the bundled geography catalog read-only, once per process. The catalog file is the
 * `@rc/geo-catalog` artifact bundled into the deployment package (ADR-008 §7); its path is
 * given by `GEO_CATALOG_PATH` (Terraform sets it on the Lambda; the dev server and tests
 * set it too). Cached so every tool call shares one connection.
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

/** Test seam: inject a catalog (a fixture) so the server can be built without a bundled file. */
export function setCatalogForTest(catalog: GeographyCatalog): void {
  cached = catalog;
}
