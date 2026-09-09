#!/usr/bin/env node
/**
 * The `federal-mcps-geo` bin: the local stdio entry point hosts launch as a child process.
 * Nothing here may write to stdout — stdout IS the transport (core/server/stdio.ts).
 */
import { runStdio } from "@federal-mcps/core";
import { createGeoServer } from "./index.js";

await runStdio(createGeoServer());
