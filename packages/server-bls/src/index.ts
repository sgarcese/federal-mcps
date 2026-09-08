/**
 * @federal-mcps/server-bls — Bureau of Labor Statistics server.
 *
 * The server definition, tools and transports land in issue #8 on top of the
 * core shell (#6). This placeholder proves the workspace wiring: the package
 * builds, depends on core through the workspace, and runs under the shared
 * Vitest projects.
 */
import { CORE_VERSION } from "@federal-mcps/core";

export const AGENCY = "bls" as const;

export function describeBuild(): { agency: typeof AGENCY; coreVersion: string } {
  return { agency: AGENCY, coreVersion: CORE_VERSION };
}
