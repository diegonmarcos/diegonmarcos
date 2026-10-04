#!/usr/bin/env tsx
/**
 * Reads releases-data.json and generates markdown views:
 *   RELEASES.md          — main view (per-repo cards with asset tables)
 *   releases-byrepo.md   — compact table, one row per release
 *
 * Mirrors ghrc/src/generate-md.ts styling (nav pills, <details> cards, footer).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const DATA = join(DIST, "releases-data.json");

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

interface ReleasesData {
  fetched_at: string;
  owner: string;
  total_releases: number;
  total_assets: number;
  total_downloads: number;
  repos: Record<string, RepoGroup>;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  return new Date(iso).toISOString().split("T")[0];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function relDownloads(rel: Release): number {
  return rel.assets.reduce((s, a) => s + a.download_count, 0);
}

function repoDownloads(g: RepoGroup): number {
  return g.releases.reduce((s, r) => s + relDownloads(r), 0);
}

function relState(rel: Release): { icon: string; label: string } {
  if (rel.draft) return { icon: "📝", label: "draft" };
  if (rel.prerelease) return { icon: "🧪", label: "prerelease" };
  return { icon: "🟢", label: "latest" };
}

interface NavItem {
  label: string;
  file: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Main", file: "RELEASES.md", icon: "🚀" },
  { label: "By Repo", file: "releases-byrepo.md", icon: "📁" },
];

function renderNav(activeLabel: string, relCount: number, downloads: number): string[] {
  const L: string[] = [];
  const pills = NAV_ITEMS.map((item) => {
    const color = item.label === activeLabel ? "2f81f7" : "30363d";
    const badge = `https://img.shields.io/badge/${encodeURIComponent(item.icon + " " + item.label)}-${color}?style=for-the-badge`;
    if (item.label === activeLabel) {
      return `<img src="${badge}" alt="${item.label}" height="28">`;
    }
    return `<a href="${item.file}"><img src="${badge}" alt="${item.label}" height="28"></a>`;
  }).join("\n  ");

  L.push(`<p align="center">`);
  L.push(`  ${pills}`);
  L.push(`</p>`);
  L.push("");
  L.push(`<p align="center"><sub><b>${relCount}</b> releases · <b>${downloads.toLocaleString()}</b> downloads</sub></p>`);
  L.push("");
  return L;
}

function footer(data: ReleasesData): string[] {
  return [
    "---",
    "",
    `<sub>Auto-generated from GitHub Releases API · <code>releases/src/fetch.ts</code> + <code>releases/src/generate-md.ts</code> · ${fmtDate(data.fetched_at)}</sub>`,
    "",
  ];
}

function renderReleaseCard(rel: Release, owner: string, repo: string): string[] {
  const L: string[] = [];
  const { icon, label } = relState(rel);
  const dl = relDownloads(rel);
  const published = rel.published_at ?? rel.created_at;
  const metaParts = [
    `Published ${relativeDate(published)}`,
    `${rel.assets.length} asset${rel.assets.length !== 1 ? "s" : ""}`,
    dl > 0 ? `${dl.toLocaleString()} downloads` : null,
    label !== "latest" ? label : null,
  ].filter(Boolean).join(" · ");

  L.push("<details>");
  L.push(
    `<summary>${icon} <a href="${rel.html_url}"><b>${rel.name}</b></a> &nbsp;<code>${rel.tag_name}</code> &nbsp;<sub>${metaParts}</sub></summary>`
  );
  L.push("");

  if (rel.assets.length > 0) {
    L.push("| Asset | Size | Downloads | Updated |");
    L.push("|:---|:---|:---|:---|");
    for (const a of [...rel.assets].sort((x, y) => y.download_count - x.download_count)) {
      L.push(
        `| [\`${a.name}\`](${a.browser_download_url}) | ${fmtSize(a.size)} | ${a.download_count.toLocaleString()} | ${fmtDate(a.updated_at)} |`
      );
    }
  } else {
    L.push("*No binary assets — source archives only.*");
  }
  L.push("");
  if (rel.tarball_url || rel.zipball_url) {
    const links = [
      rel.zipball_url ? `[Source (zip)](https://github.com/${owner}/${repo}/archive/refs/tags/${rel.tag_name}.zip)` : null,
      rel.tarball_url ? `[Source (tar.gz)](https://github.com/${owner}/${repo}/archive/refs/tags/${rel.tag_name}.tar.gz)` : null,
    ].filter(Boolean).join(" · ");
    L.push(`<sub>${links}</sub>`);
    L.push("");
  }
  L.push("</details>");
  L.push("");
  return L;
}

// ── 1. RELEASES.md — main view by repo ──
function generateMain(data: ReleasesData): string {
  const L: string[] = [];
  L.push(...renderNav("Main", data.total_releases, data.total_downloads));

  L.push("```");
  L.push("        ╔══════════════════════════════════════════════════╗");
  L.push("        ║                                                  ║");
  L.push("        ║          🚀   R E L E A S E S                    ║");
  L.push("        ║                                                  ║");
  L.push("        ║     v1.0 ──▶ v1.1 ──▶ v1.2 ──▶ v2.0 ──▶ …        ║");
  L.push("        ║                                                  ║");
  L.push("        ║     tagged · versioned · downloadable             ║");
  L.push("        ║                                                  ║");
  L.push("        ╚══════════════════════════════════════════════════╝");
  L.push("```");
  L.push("");
  L.push(`<h1 align="center">🚀 GitHub Releases</h1>`);
  L.push("");
  L.push(`<p align="center"><i>Every milestone gets a tag — cut, versioned, downloadable.<br>Auto-generated catalog of all GitHub releases for <code>@${data.owner}</code>.</i></p>`);
  L.push("");
  L.push("---");
  L.push("");

  const sortedRepos = Object.entries(data.repos).sort(([a], [b]) => a.localeCompare(b));

  if (sortedRepos.length === 0) {
    L.push("*No published releases found.*");
    L.push("");
  }

  for (const [repoName, group] of sortedRepos) {
    const repoLink = group.repo_url ? `<a href="${group.repo_url}/releases">${repoName}</a>` : repoName;
    const dl = repoDownloads(group);
    L.push("---");
    L.push("");
    L.push(
      `### 📁 ${repoLink} &nbsp;<sup>${group.releases.length} release${group.releases.length !== 1 ? "s" : ""} · ${dl.toLocaleString()} downloads</sup>`
    );
    L.push("");
    for (const rel of group.releases) {
      L.push(...renderReleaseCard(rel, data.owner, repoName));
    }
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ── 2. releases-byrepo.md — compact table ──
function generateByRepo(data: ReleasesData): string {
  const L: string[] = [];
  L.push(...renderNav("By Repo", data.total_releases, data.total_downloads));
  L.push(`# 🚀 Releases — By Repository`);
  L.push("");

  const sortedRepos = Object.entries(data.repos).sort(([a], [b]) => a.localeCompare(b));

  for (const [repoName, group] of sortedRepos) {
    const repoLink = group.repo_url ? `[${repoName}](${group.repo_url}/releases)` : repoName;
    L.push("---");
    L.push("");
    L.push(`### 📁 ${repoLink} <sup>${group.releases.length} · ${repoDownloads(group).toLocaleString()} downloads</sup>`);
    L.push("");
    L.push("| Release | Tag | State | Assets | Downloads | Published |");
    L.push("|:---|:---|:---|:---|:---|:---|");
    for (const rel of group.releases) {
      const { label } = relState(rel);
      const published = rel.published_at ?? rel.created_at;
      L.push(
        `| [${rel.name}](${rel.html_url}) | \`${rel.tag_name}\` | ${label} | ${rel.assets.length} | ${relDownloads(rel).toLocaleString()} | ${relativeDate(published)} |`
      );
    }
    L.push("");
  }

  L.push(...footer(data));
  return L.join("\n");
}

function main() {
  const data: ReleasesData = JSON.parse(readFileSync(DATA, "utf-8"));

  const files: Array<[string, string]> = [
    ["RELEASES.md", generateMain(data)],
    ["releases-byrepo.md", generateByRepo(data)],
  ];

  for (const [name, content] of files) {
    writeFileSync(join(DIST, name), content);
    console.log(`Wrote dist/${name}`);
  }

  console.log(
    `\n${data.total_releases} releases across ${Object.keys(data.repos).length} repos, ${data.total_assets} assets, ${data.total_downloads.toLocaleString()} downloads`
  );
}

main();
