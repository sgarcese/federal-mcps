#!/usr/bin/env node
/**
 * The `federal-mcps-hud` bin target (`package.json` `bin`).
 *
 * This file is static and committed with its executable bit set in git, so
 * `npx federal-mcps-hud` and `node_modules/.bin/federal-mcps-hud` work no
 * matter how `dist/` was produced. A `dist/*.js` output cannot be that
 * target directly: the repo's root `npm run build` runs `tsc -b
 * tsconfig.json` across every package's project references, which recompiles
 * `dist/stdio.js` without preserving (or setting) the executable bit — only
 * this package's own `npm run build` (with its `postbuild` chmod) would.
 * Keeping the actual bin as this tiny static shim, rather than the compiled
 * file, makes `npx federal-mcps-hud` work after either build path.
 */
import "../dist/stdio.js";
