---
name: cdc-places
description: Answer local health questions (obesity, diabetes, smoking, depression, uninsured, screenings, disability, social needs) for any U.S. county, city/town, census tract or ZIP from CDC PLACES on data.cdc.gov, with the right dataset, value type, 95% interval, data year and suppression handling. Use with geo_resolve_place and an OpenContext Socrata connector for data.cdc.gov.
---

# CDC PLACES source guide

PLACES ("Local Data for Better Health") is the CDC's model-based small-area estimate of 40
health measures for every county, incorporated place and CDP, census tract and ZCTA. Verified
live against data.cdc.gov on 2026-09-20 (2025 release). Federal public-domain data; attribute
"Centers for Disease Control and Prevention, National Center for Chronic Disease Prevention and
Health Promotion, Division of Population Health".

## Tools you need

- `geo_resolve_place` (federal-mcps geo server): turns a place name into candidates with a
  `geoid`. PLACES's `locationid` **is** that geoid at every level.
- An OpenContext Socrata connector on `https://data.cdc.gov` (`socrata__query_dataset`,
  `socrata__execute_sql`, `socrata__get_dataset`, `socrata__search_datasets`). The family hosts
  one at **`https://cdc.responsive.city/mcp`** (ADR-016); any OpenContext deployment of
  data.cdc.gov works the same.

## Datasets (2025 release — use these, long format)

| Level | Dataset id | `locationid` | Value types |
|---|---|---|---|
| County | `swc5-untb` | 5-digit county FIPS (`08031`) | crude and age-adjusted |
| Place (city, town, CDP) | `eav7-hnsx` | 7-digit place GEOID (`0820000`) | crude and age-adjusted |
| Census tract | `cwsq-ngmh` | 11-digit tract GEOID | **crude only** |
| ZCTA | `qnzd-25i4` | 5-digit ZCTA | **crude only** |

- **Never use the "GIS Friendly Format" wide files** (`i46a-9kgh`, `vgc8-iyc4`, `yjkw-uj5s`,
  `kee5-23sr`): they omit suppressed rows and carry no footnotes, so a suppressed county looks
  absent. Search ranks them first; ignore them.
- Earlier releases (2020–2024) exist under their own ids; find one with
  `socrata__search_datasets "PLACES: Local Data for Better Health, County Data, 2024 release"`.
  Do not compare across releases as a trend without saying the model and inputs changed.
- **There is no state or metro dataset.** The county file has one national row
  (`locationid` `59`, `stateabbr` `US`).

## Recipe

1. Resolve the place: `geo_resolve_place {query, kind?, state?}`. Take `geoid`. If several
   candidates share a name in different states and no state was given, **ask which state**;
   do not pick one.
2. Query by id, never by name:
   `SELECT year, locationname, data_value_type, data_value, low_confidence_limit,
   high_confidence_limit, totalpopulation, totalpop18plus, data_value_footnote_symbol,
   data_value_footnote WHERE locationid='08031' AND measureid='OBESITY'`
3. Report: the value with its 95% interval, the value type, the `year`, the geography used,
   the dataset id, and "model-based estimate" once.

## Reading a row

- `data_value_type`: `Age-adjusted prevalence` (**default for comparing places**; removes
  age-structure differences) or `Crude prevalence` (the share of the actual adult population).
  County and place carry both; tract and ZCTA carry crude only. Say which you used.
- `low_confidence_limit` / `high_confidence_limit`: a 95% interval from the model. Always
  report it. An interval wider than about 10 points is imprecise; say so.
- `year`: the **data year of that measure**, not the release year. In the 2025 release 35
  measures are 2023 and five are 2022 (colorectal screening, dental visit, mammography, short
  sleep, all teeth lost — biennial BRFSS questions). Report `year`.
- `data_value` null with `data_value_footnote_symbol` `*`: CDC suppressed it — quote
  "Estimates suppressed for population less than 50" and give no number. Only the county file
  has suppressed rows; a place under 50 adults simply has no row (report "not published").
- Symbol `#`: "The estimates are based on 39 states and DC" (social-needs measures) — pass it on.
- `totalpopulation` / `totalpop18plus`: denominators from Census; useful for "how many people".

## Never

- Never aggregate counties into a state or metro figure. State figures come from the BRFSS
  survey directly; say PLACES does not publish them.
- Never present a crude and an age-adjusted number as if comparable.
- Never report a PLACES value without its interval and data year.
- Never treat a small difference between a city and its county as real when the intervals
  overlap (Denver city vs Denver County are modelled independently).

## Measures (40, verified 2026-09-20)

| Category | `measureid` | Measure (CDC label) | Data year (2025 release) |
|---|---|---|---|
| Health Outcomes | `ARTHRITIS` | Arthritis among adults | 2023 |
| Health Outcomes | `BPHIGH` | High blood pressure among adults | 2023 |
| Health Outcomes | `CANCER` | Cancer (non-skin) or melanoma among adults | 2023 |
| Health Outcomes | `CASTHMA` | Current asthma among adults | 2023 |
| Health Outcomes | `CHD` | Coronary heart disease among adults | 2023 |
| Health Outcomes | `COPD` | Chronic obstructive pulmonary disease among adults | 2023 |
| Health Outcomes | `DEPRESSION` | Depression among adults | 2023 |
| Health Outcomes | `DIABETES` | Diagnosed diabetes among adults | 2023 |
| Health Outcomes | `HIGHCHOL` | High cholesterol among adults who have ever been screened | 2023 |
| Health Outcomes | `OBESITY` | Obesity among adults | 2023 |
| Health Outcomes | `STROKE` | Stroke among adults | 2023 |
| Health Outcomes | `TEETHLOST` | All teeth lost among adults aged >=65 years | 2022 |
| Prevention | `ACCESS2` | Current lack of health insurance among adults aged 18-64 years | 2023 |
| Prevention | `BPMED` | Taking medicine to control high blood pressure among adults with high blood pressure | 2023 |
| Prevention | `CHECKUP` | Visits to doctor for routine checkup within the past year among adults | 2023 |
| Prevention | `CHOLSCREEN` | Cholesterol screening among adults | 2023 |
| Prevention | `COLON_SCREEN` | Colorectal cancer screening among adults aged 45–75 years | 2022 |
| Prevention | `DENTAL` | Visited dentist or dental clinic in the past year among adults | 2022 |
| Prevention | `MAMMOUSE` | Mammography use among women aged 50-74 years | 2022 |
| Health Risk Behaviors | `BINGE` | Binge drinking among adults | 2023 |
| Health Risk Behaviors | `CSMOKING` | Current cigarette smoking among adults | 2023 |
| Health Risk Behaviors | `LPA` | No leisure-time physical activity among adults | 2023 |
| Health Risk Behaviors | `SLEEP` | Short sleep duration among adults | 2022 |
| Disability | `COGNITION` | Cognitive disability among adults | 2023 |
| Disability | `DISABILITY` | Any disability among adults | 2023 |
| Disability | `HEARING` | Hearing disability among adults | 2023 |
| Disability | `INDEPLIVE` | Independent living disability among adults | 2023 |
| Disability | `MOBILITY` | Mobility disability among adults | 2023 |
| Disability | `SELFCARE` | Self-care disability among adults | 2023 |
| Disability | `VISION` | Vision disability among adults | 2023 |
| Health Status | `GHLTH` | Fair or poor self-rated health status among adults | 2023 |
| Health Status | `MHLTH` | Frequent mental distress among adults | 2023 |
| Health Status | `PHLTH` | Frequent physical distress among adults | 2023 |
| Health-Related Social Needs | `EMOTIONSPT` | Lack of social and emotional support among adults | 2023 |
| Health-Related Social Needs | `FOODINSECU` | Food insecurity in the past 12 months among adults | 2023 |
| Health-Related Social Needs | `FOODSTAMP` | Received food stamps in the past 12 months among adults | 2023 |
| Health-Related Social Needs | `HOUSINSECU` | Housing insecurity in the past 12 months among adults | 2023 |
| Health-Related Social Needs | `LACKTRPT` | Lack of reliable transportation in the past 12 months among adults | 2023 |
| Health-Related Social Needs | `LONELINESS` | Loneliness among adults | 2023 |
| Health-Related Social Needs | `SHUTUTILITY` | Utility services shut-off threat in the past 12 months among adults | 2023 |

The nine "non-medical factors" PLACES also displays (income, education, housing cost, etc.) are
ACS variables — use the Census server for those.

## Worked examples (verified numbers)

- **Denver County obesity:** `swc5-untb`, `locationid='08031'`, `measureid='OBESITY'` → age-adjusted
  21.6% (18.4–25.2), crude 21.6% (18.4–25.1), year 2023.
- **Denver city vs county diabetes:** `eav7-hnsx` `0820000` age-adjusted 8.0% (7.1–9.0) vs
  `swc5-untb` `08031` 7.8% (6.7–9.0), 2023 — intervals overlap; no meaningful difference.
- **Highest-smoking tract in Denver County:** `cwsq-ngmh`, `WHERE countyfips='08031' AND
  measureid='CSMOKING' ORDER BY data_value DESC` → 08031000800, crude 26.8% (23.7–29.9).
- **Loving County, TX:** `swc5-untb` `48301` → null, "Estimates suppressed for population less
  than 50" (population 43). Say suppressed; no number.
- **Colorado statewide:** not published by PLACES; point to BRFSS.
- **Colorectal screening, Denver County:** age-adjusted 59.0% (54.8–62.9), **year 2022** even
  though it is the 2025 release.

## Connector notes

- OpenContext's Socrata plugin requires a non-empty `app_token` although data.cdc.gov serves
  untokened requests; a free Socrata app token (Developer Settings → App Tokens) works.
- The place file's `placename` column holds the FIPS code, not the name; the name is `locationname`.
- SoQL: `GROUP BY` is required with aggregates; quote ids as strings — single or double quotes
  both work (`locationid='08031'` or `locationid="08031"`). A "Type mismatch: expected text, but
  found number" error means an id reached Socrata unquoted (often a shell-quoting slip); re-send
  it quoted rather than switching tools.
