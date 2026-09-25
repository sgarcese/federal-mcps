import type { CompactRendering } from "@federal-mcps/core";

/**
 * `bls_get_raw`'s compact text (#210, ADR-017 §1): the column header and the API's messages once,
 * then one block per series — an id line and one `year,period,value,footnotes` line per
 * observation — so the shell can cut on whole series. Collects series across the batched
 * responses (the API takes 50 ids per request). Declines (undefined) on anything that is not a
 * BLS v2 response, so the shell falls back to the JSON rendering.
 */
export function renderBlsRaw(data: unknown): CompactRendering | undefined {
  const responses = (data as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(responses)) return undefined;

  const notes: string[] = [];
  const items: string[] = [];
  for (const response of responses) {
    const r = response as {
      message?: unknown;
      Results?: { series?: { seriesID?: unknown; data?: unknown }[] };
    };
    if (Array.isArray(r.message)) {
      for (const m of r.message) if (typeof m === "string" && m.trim()) notes.push(`note: ${m}`);
    }
    for (const series of r.Results?.series ?? []) {
      const obs = Array.isArray(series.data) ? series.data : [];
      const lines = obs.map((o) => {
        const { year, period, value, footnotes } = o as {
          year?: unknown;
          period?: unknown;
          value?: unknown;
          footnotes?: { code?: unknown }[];
        };
        const codes = (footnotes ?? [])
          .map((f) => (typeof f?.code === "string" ? f.code : ""))
          .filter(Boolean)
          .join(";");
        return `${String(year ?? "")},${String(period ?? "")},${String(value ?? "")},${codes}`;
      });
      const label = obs.length === 1 ? "observation" : "observations";
      items.push(
        [`series ${String(series.seriesID ?? "?")} (${obs.length} ${label})`, ...lines].join("\n"),
      );
    }
  }

  return {
    head: ["columns: year,period,value,footnotes", ...notes],
    items,
    unit: "series",
    narrowHint: "Narrow the call: fewer ids per call, or a shorter startYear–endYear span.",
  };
}
