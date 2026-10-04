#!/usr/bin/env tsx
/**
 * Fetches all GitHub Release metadata (with assets + download counts) for
 * every repo owned by diegonmarcos. Writes releases-data.json.
 *
 * Usage: npx tsx fetch.ts
 * Requires: gh CLI authenticated (GH_TOKEN with `repo` scope to see private repos)
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const OUT = join(DIST, "releases-data.json");
const USER = "diegonmarcos";

interface Asset {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
  content_type: string;
  updated_at: string;
}

interface Release {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
  tarball_url: string | null;
  zipball_url: string | null;
  assets: Asset[];
}

interface RepoGroup {
  repo_url: string;
  releases: Release[];
}

type ReleasesData = {
  fetched_at: string;
  owner: string;
  total_releases: number;
  total_assets: number;
  total_downloads: number;
  repos: Record<string, RepoGroup>;
};

function gh<T>(endpoint: string): T {
  const raw = execSync(`gh api '${endpoint}' --paginate 2>/dev/null`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(raw) as T;
}

function fetchReleases(fullName: string): Release[] {
  try {
    const raw = gh<
      Array<{
        tag_name: string;
        name: string | null;
        draft: boolean;
        prerelease: boolean;
        created_at: string;
        published_at: string | null;
        html_url: string;
        tarball_url: string | null;
        zipball_url: string | null;
        assets: Array<{
          name: string;
          size: number;
          download_count: number;
          browser_download_url: string;
          content_type: string;
          updated_at: string;
        }>;
      }>
    >(`repos/${fullName}/releases`);

    return raw.map((r) => ({
      tag_name: r.tag_name,
      name: r.name ?? r.tag_name,
      draft: r.draft,
      prerelease: r.prerelease,
      created_at: r.created_at,
      published_at: r.published_at,
      html_url: r.html_url,
      tarball_url: r.tarball_url,
      zipball_url: r.zipball_url,
      assets: r.assets.map((a) => ({
        name: a.name,
        size: a.size,
        download_count: a.download_count,
        browser_download_url: a.browser_download_url,
        content_type: a.content_type,
        updated_at: a.updated_at,
      })),
    }));
  } catch {
    console.warn(`  ⚠ Failed to fetch releases for ${fullName}`);
    return [];
  }
}

function main() {
  console.log(`Fetching repos for ${USER}...`);

  // Authenticated endpoint: sees ALL owned repos incl. private (the
  // users/<name>/repos endpoint silently returns only public repos).
  const repos = gh<
    Array<{ name: string; full_name: string; html_url: string }>
  >(`user/repos?per_page=100&affiliation=owner`);

  console.log(`Found ${repos.length} repos. Fetching releases...`);

  const out: Record<string, RepoGroup> = {};
  let totalReleases = 0;
  let totalAssets = 0;
  let totalDownloads = 0;

  for (const repo of repos) {
    const releases = fetchReleases(repo.full_name);
    if (releases.length === 0) continue;

    console.log(`  ${repo.name} → ${releases.length} releases`);
    out[repo.name] = { repo_url: repo.html_url, releases };
    totalReleases += releases.length;
    for (const rel of releases) {
      totalAssets += rel.assets.length;
      totalDownloads += rel.assets.reduce((s, a) => s + a.download_count, 0);
    }
  }

  const data: ReleasesData = {
    fetched_at: new Date().toISOString(),
    owner: USER,
    total_releases: totalReleases,
    total_assets: totalAssets,
    total_downloads: totalDownloads,
    repos: out,
  };

  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWrote dist/releases-data.json`);
}

main();
