# ADR-016: federal-mcps owns its fleet's deployment wrapper; short hostnames; repository safety

**Status:** accepted (2026-09-22) ·
**Context docs:** [`opencontext-socrata-benchmark`](../spikes/opencontext-socrata-benchmark.md),
[`hud-arcgis-hub-guide`](../spikes/hud-arcgis-hub-guide.md), ADR-015 ·
**Amends:** ADR-004 §5 (hostnames), ADR-006 §3 (extends the secret pattern to the Socrata token),
ADR-015 consequences ("two OpenContext deployments are outside this repository's Terraform") ·
**Affects:** `terraform/`, `scripts/deploy.sh`, `scripts/bundle-opencontext.sh`,
`instances.example.json`, `docs/runbooks/`, repository settings on GitHub

## Context

ADR-015 made "source guide + generic portal connector" the surface for portal-hosted sources, and
the owner's data-smart portal wrapper already runs seventeen OpenContext portals (HUD among them)
at `<slug>.responsive.city/mcp`. The question was where the CDC portal that the PLACES guide
needs should be deployed, whether this family's servers should move under that wrapper, and how
much of the deployment can be public without leaking the account. Separately, the repository had
no branch protection at all: `main` accepted direct pushes and force-pushes, and release tags
could be moved or deleted.

## Decision

1. **federal-mcps deploys its own fleet, with its own wrapper.** The fleet is the agency
   servers (BLS, Census, geo) **and** one OpenContext portal Lambda per guide-backed source
   this family owns — CDC (`data.cdc.gov`, Socrata) first. Nothing is added to the data-smart
   wrapper; HUD stays deployed there and the HUD guide points at it. Reason: the agency
   Lambdas are Node bundles with the catalog baked in by this repository's build, their state
   already lives under `rc/federal-mcps/`, and a move would be a destroy-and-recreate for no
   functional gain.
2. **Hostnames are `<service>.responsive.city/mcp`**: `bls`, `census`, `geo`, `cdc`, matching
   the portal fleet's `<slug>` pattern. The existing `bls-mcp`, `geo-mcp` and `census-mcp` names
   are kept as **aliases** (additive certificate, domain name, mapping and records per alias in
   each module), so no connector breaks; docs advertise the short names from M10 on, and the
   aliases are removed no earlier than v1.0.0 with a changelog notice one minor version ahead.
3. **Terraform is public; the account is not.** Modules, instance roots, tests, the deploy
   script and the bundle scripts are committed. The fleet record (`instances.json`) stays
   gitignored with a committed placeholder example; every credential is a `sensitive` variable
   fed from `.env` at deploy time (`BLS_API_KEY`, `CENSUS_API_KEY`, and now the optional
   `SOCRATA_APP_TOKEN` as `TF_VAR_socrata_app_token`), never a default and never in git.
4. **OpenContext is pinned, fetched and built at deploy time, never vendored.**
   `opencontext.lock.json` (committed) names the source repository and commit
   (`sgarcese/OpenContext-upstream`, the owner's fork that carries the connector fixes);
   `scripts/bundle-opencontext.sh` clones that commit into gitignored `build/`, copies the runtime
   packages, installs `requirements.txt` for the Lambda platform and zips. Bumping the pin is a
   one-line PR reviewed like any other. CI validates the module against a committed placeholder
   zip and never fetches.
5. **The OpenContext portal module mirrors the agency modules**: Lambda + HTTP API + custom
   domain + aliases, rc-naming (`rc-cdc-mcp-<env>`), the execution role read by data source and
   provisioned by the administrator script (ADR-007 §4, extended with a `cdc` server). Its
   configuration is one `OPENCONTEXT_CONFIG` JSON environment variable rendered from module
   variables (portal type, URL, display name, organization, optional token, timeout).
6. **Repository rulesets** (applied 2026-09-22, recorded in
   [`runbooks/repository-settings.md`](../runbooks/repository-settings.md)): `main` accepts only
   pull requests with the `ci` check green, linear history, no deletion or force-push, squash
   merges only, no bypass actors; `v*` tags cannot be created over, updated or deleted; secret
   scanning with push protection and Dependabot security updates are on; merged branches are
   deleted. CLAUDE.md's "merges require explicit CI pass" is now enforced by GitHub, not only by
   discipline.

## Consequences

- One more Lambda and domain per guide-backed source, deployed by the same `scripts/deploy.sh`
  run; the admin creates one more execution role per portal (until #204 tests the
  permissions-boundary route that the portal wrapper uses).
- The Python bundle step needs `uv` (or `pip`) on the deploying machine; Node and Python builds
  run in the same script.
- Aliases double the certificates for the agency servers for a while; ACM certificates are free.
- Rulesets apply to the owner too: no direct pushes to `main`, no hotfix tags over old ones.
  An emergency change is still a PR; the `ci` job takes minutes.
- ADR-015's consequence about OpenContext deployments being outside this repository is
  narrowed to HUD (data-smart). The composite endpoint (ADR-001 §4) can later mount the CDC
  portal by URL like any other server.

## Alternatives rejected

- **Add the federal servers to the data-smart portal wrapper.** Cross-repo Node builds inside
  a Python wrapper, a second state to migrate, and a single shared state key across
  environments in that repo (its documented hazard).
- **Rename the hostnames outright.** About thirty files and every existing connector would
  break at once; aliases give the same end state without a cutover.
- **Gitignore the Terraform code.** Unreviewable, untestable, unrecoverable; the evergreen goal
  is met by gitignoring the fleet record and secrets, which was already the pattern.
- **Vendor an OpenContext snapshot** (the data-smart approach). Drift from the fork is invisible
  and reviews become large; a pinned commit is one line to read.
