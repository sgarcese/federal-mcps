#!/usr/bin/env node
// Static executable shim (a root `tsc -b` does not run a package postbuild), same
// pattern as server-bls. Runs the built stdio entry point.
import "../dist/stdio.js";
