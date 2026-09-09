#!/usr/bin/env node
/**
 * The `federal-mcps-bls` bin (`package.json` `bin`): the local stdio entry
 * point hosts like Claude Desktop and Claude Code launch as a child process.
 *
 * Nothing here may write to stdout — stdout IS the transport
 * (`packages/core/src/server/stdio.ts`).
 */
import { runStdio } from "@federal-mcps/core";
import { createBlsServer } from "./index.js";

await runStdio(createBlsServer());
