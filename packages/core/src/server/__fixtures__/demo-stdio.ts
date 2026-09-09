/**
 * A stdio entry point for the demo server, spawned by `stdio.test.ts`.
 *
 * This is the shape every agency package's `bin` will take: build the
 * definition, hand it to `createServer`, hand that to `runStdio`. Nothing may
 * write to stdout here — stdout IS the transport.
 */
import { createServer } from "../create-server.js";
import { runStdio } from "../stdio.js";
import { demoDefinition } from "./demo-definition.js";

await runStdio(createServer(demoDefinition));
