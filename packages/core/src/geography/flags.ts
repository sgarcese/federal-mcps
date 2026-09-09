import type { AgencyCode, GeographyFlag } from "./types.js";

/** The raw entity fields flag derivation needs. */
export interface EntityFacts {
  geoid: string;
  sumlevel: string;
  name: string;
  lsad: string | null;
}

const NON_NESTING = new Set(["310", "314", "330", "860"]);
const CDP_LSAD = "57";

/**
 * Derives the structured flags for a resolved place (ADR-008 §3): machine-checkable
 * caveats a small model can branch on, rather than prose it will ignore. `changedGeoid`
 * is whether the geoid appears in `county_change`.
 */
export function deriveFlags(
  entity: EntityFacts,
  agencyCodes: readonly AgencyCode[],
  changedGeoid: boolean,
): { flags: GeographyFlag[]; caveat?: string } {
  const flags: GeographyFlag[] = [];
  const caveats: string[] = [];

  if (NON_NESTING.has(entity.sumlevel)) {
    flags.push("non_nesting");
  }

  const isCdp = entity.lsad === CDP_LSAD || /\bCDP$/.test(entity.name);
  if (isCdp) {
    flags.push("cdp");
    caveats.push("census designated place: unincorporated, no local government");
  }

  if (entity.sumlevel === "170" || /\(balance\)/i.test(entity.name)) {
    flags.push("consolidated_city");
    caveats.push("consolidated city or its balance — not the surrounding county");
  }

  // A place that carries no LAUS code is below the 25,000 threshold; LAUS data for it
  // comes from the surrounding county.
  if (
    entity.sumlevel === "160" &&
    !agencyCodes.some((c) => c.agency === "bls" && c.program === "LAUS")
  ) {
    flags.push("below_threshold");
    caveats.push(
      "below the LAUS 25,000-population threshold; unemployment comes from the surrounding county",
    );
  }

  if (changedGeoid) {
    flags.push("vintage_mismatch");
    caveats.push("this area's code changed across vintages; joins across years may not line up");
  }

  const result: { flags: GeographyFlag[]; caveat?: string } = { flags };
  if (caveats.length > 0) result.caveat = caveats.join("; ");
  return result;
}
