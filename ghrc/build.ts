#!/usr/bin/env tsx
/**
 * Fetches GHCR metadata and generates all markdown views.
 * Usage: tsx build.ts
 */

import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

execSync(`tsx src/fetch.ts`, { cwd: root, stdio: "inherit" });
execSync(`tsx src/generate-md.ts`, { cwd: root, stdio: "inherit" });
