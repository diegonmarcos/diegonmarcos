#!/usr/bin/env -S npx tsx
/**
 * Fetches GHCR metadata and generates GHCR.md in one step.
 * Usage: npx tsx build.ts
 */

import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

execSync(`npx tsx src/fetch.ts`, { cwd: root, stdio: "inherit" });
execSync(`npx tsx src/generate-md.ts`, { cwd: root, stdio: "inherit" });
