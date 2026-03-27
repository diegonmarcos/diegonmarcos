#!/usr/bin/env -S npx tsx
/**
 * Fetches all GHCR container package metadata for diegonmarcos
 * and writes ghcr-data.json organized by repo → package name.
 *
 * Usage: npx tsx fetch.ts
 * Requires: gh CLI authenticated
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const OUT = join(DIST, "ghcr-data.json");
const USER = "diegonmarcos";

interface PackageVersion {
  id: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface Package {
  name: string;
  visibility: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  versions: PackageVersion[];
}

interface RepoGroup {
  repo_url: string;
  packages: Package[];
}

type GhcrData = {
  fetched_at: string;
  owner: string;
  total_packages: number;
  repos: Record<string, RepoGroup>;
};

function gh<T>(endpoint: string): T {
  const raw = execSync(`gh api '${endpoint}' --paginate`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(raw) as T;
}

function fetchVersions(name: string): PackageVersion[] {
  try {
    const raw = gh<
      Array<{
        id: number;
        created_at: string;
        updated_at: string;
        html_url: string;
        metadata: { container: { tags: string[] } };
      }>
    >(`user/packages/container/${encodeURIComponent(name)}/versions`);

    return raw.map((v) => ({
      id: v.id,
      tags: v.metadata.container.tags,
      created_at: v.created_at,
      updated_at: v.updated_at,
      html_url: v.html_url,
    }));
  } catch {
    console.warn(`  ⚠ Failed to fetch versions for ${name}`);
    return [];
  }
}

function main() {
  console.log(`Fetching GHCR packages for ${USER}...`);

  const packages = gh<
    Array<{
      name: string;
      visibility: string;
      html_url: string;
      created_at: string;
      updated_at: string;
      repository?: { name: string; html_url: string };
    }>
  >("user/packages?package_type=container");

  console.log(`Found ${packages.length} packages. Fetching versions...`);

  const repos: Record<string, RepoGroup> = {};

  for (const pkg of packages) {
    const repoName = pkg.repository?.name ?? "_unlinked";
    const repoUrl = pkg.repository?.html_url ?? "";

    if (!repos[repoName]) {
      repos[repoName] = { repo_url: repoUrl, packages: [] };
    }

    console.log(`  ${repoName}/${pkg.name}`);
    const versions = fetchVersions(pkg.name);

    repos[repoName].packages.push({
      name: pkg.name,
      visibility: pkg.visibility,
      html_url: pkg.html_url,
      created_at: pkg.created_at,
      updated_at: pkg.updated_at,
      versions,
    });
  }

  // Sort packages within each repo by name
  for (const group of Object.values(repos)) {
    group.packages.sort((a, b) => a.name.localeCompare(b.name));
  }

  const data: GhcrData = {
    fetched_at: new Date().toISOString(),
    owner: USER,
    total_packages: packages.length,
    repos,
  };

  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWrote dist/ghcr-data.json`);
}

main();
