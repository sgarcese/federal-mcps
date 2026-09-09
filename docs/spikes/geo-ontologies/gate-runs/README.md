# Gate run artifacts

Reproducibility notes for recorded UGEO-Bench gate runs (see `../GATE-RESULTS.md`).

## weighted_overlap tool outputs

The `with_tools` arm's tool results are exactly what `geo_get_overlap` returns from a
catalog loaded with the **2010 Census ZCTA-to-Tract Relationship File**
(`https://www2.census.gov/geo/docs/maps-data/data/rel/zcta_tract_rel_10.txt`, 148,897 rows).
The benchmark's own `weighted_overlap` ground truths are computed from this same file, so
loading it makes the tool answers exact. Verified against the benchmark:

| Item | Query | File result | Benchmark truth |
|---|---|---|---|
| A01 | ZCTA 19104 → distinct tracts | 17 | 17 |
| A02 | ZCTA 02134 → distinct tracts | 9 | 9 |
| A03 | ZCTA 02108 pop share in tract 25025020101 | 69.86% | 69.86% |
| A04 | largest-share tract of ZCTA 02134 | 25025000802 @ 33.76% | 25025000802, 33.76% |
| A05 | ZCTA 02215 counties | 25025 (14 tracts) + 25021 (2) | Suffolk + Middlesex |
| A06 | Suffolk+Philadelphia tracts overlapped by >1 ZCTA | 237 of 586 | 237 of 586 |

To recompute (the file is not vendored; download it first):

```python
import csv, collections
rows = list(csv.DictReader(open("zcta_tract_rel_10.txt")))
def tracts(z): return {r["GEOID"] for r in rows if r["ZCTA5"] == z}
print(len(tracts("19104")))   # 17
```

This is the targeted, two-county (Suffolk 25025, Philadelphia 42101) coverage that
`geography-build` needs before the tool arm can be run in-harness (a tracked follow-up):
loading real ZCTA↔tract overlaps for these metros, rather than the 12-row Geocorr sample
the build ships today.
