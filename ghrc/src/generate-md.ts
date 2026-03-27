#!/usr/bin/env -S npx tsx
/**
 * Reads ghcr-data.json and generates GHCR.md replicating
 * the GitHub Container Registry UI as closely as GFM allows.
 *
 * Layout: repo sections → package cards with icon, name,
 * visibility badge, published date, version count → expandable
 * version table.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const DATA = join(DIST, "ghcr-data.json");
const OUT = join(DIST, "GHCR.md");

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

interface GhcrData {
  fetched_at: string;
  owner: string;
  total_packages: number;
  repos: Record<string, RepoGroup>;
}

const SHA_RE = /^[0-9a-f]{7,40}$/;

function isSemantic(tag: string): boolean {
  return !SHA_RE.test(tag);
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
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function classifyVersions(versions: PackageVersion[]) {
  const semantic: PackageVersion[] = [];
  const shaOnly: PackageVersion[] = [];
  const untagged: PackageVersion[] = [];
  for (const v of versions) {
    if (v.tags.length === 0) untagged.push(v);
    else if (v.tags.some(isSemantic)) semantic.push(v);
    else shaOnly.push(v);
  }
  return { semantic, shaOnly, untagged };
}

function containerIcon(): string {
  return "📦";
}

function visibilityBadge(vis: string): string {
  return vis === "public"
    ? "![Public](https://img.shields.io/badge/Public-success?style=flat-square)"
    : "![Private](https://img.shields.io/badge/Private-critical?style=flat-square)";
}

function generateMarkdown(data: GhcrData): string {
  const L: string[] = [];

  // ── Header ──
  L.push(`<h1>${containerIcon()} Packages</h1>`);
  L.push("");
  L.push(
    `<blockquote><b>${data.total_packages}</b> container packages published by <a href="https://github.com/${data.owner}"><code>@${data.owner}</code></a> &nbsp;·&nbsp; Updated ${fmtDate(data.fetched_at)}</blockquote>`
  );
  L.push("");

  const sortedRepos = Object.entries(data.repos).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  for (const [repoName, group] of sortedRepos) {
    // ── Repo header ──
    const repoDisplay = group.repo_url
      ? `<a href="${group.repo_url}">${repoName}</a>`
      : `${repoName}`;

    L.push("---");
    L.push("");
    L.push(
      `### 📁 ${repoDisplay} &nbsp;<sup>${group.packages.length} package${group.packages.length !== 1 ? "s" : ""}</sup>`
    );
    L.push("");

    for (const pkg of group.packages) {
      const { semantic, shaOnly, untagged } = classifyVersions(pkg.versions);
      const taggedCount = semantic.length + shaOnly.length;
      const latestTag =
        semantic.find((v) => v.tags.includes("latest")) ??
        shaOnly.find((v) => v.tags.includes("latest"));
      const latestLabel = latestTag
        ? latestTag.tags.find(isSemantic) ?? latestTag.tags[0].slice(0, 12)
        : "latest";

      // ── Package card ──
      L.push("<details>");
      L.push("<summary>");
      L.push("");
      L.push(
        `**${containerIcon()} [${pkg.name}](${pkg.html_url})** &nbsp;${visibilityBadge(pkg.visibility)}`
      );
      L.push("");
      L.push(
        `&emsp;Published ${relativeDate(pkg.updated_at)} &nbsp;·&nbsp; ${taggedCount} tagged version${taggedCount !== 1 ? "s" : ""} &nbsp;·&nbsp; \`ghcr.io/${data.owner}/${pkg.name}\``
      );
      L.push("");
      L.push("</summary>");
      L.push("");

      // ── Pull command ──
      L.push("```bash");
      L.push(`docker pull ghcr.io/${data.owner}/${pkg.name}:latest`);
      L.push("```");
      L.push("");

      // ── Versions table ──
      L.push("| | Tag | Published | Digest |");
      L.push("|:---|:---|:---|:---|");

      // Semantic tags first (latest, buildcache, named versions)
      for (const ver of semantic) {
        const primaryTag = ver.tags[0];
        const extraTags = ver.tags.slice(1);
        const tagCell = extraTags.length > 0
          ? `\`${primaryTag}\` ${extraTags.map((t) => `\`${t}\``).join(" ")}`
          : `\`${primaryTag}\``;
        const isLatest = ver.tags.includes("latest");
        const marker = isLatest ? "🟢" : "🏷️";
        L.push(
          `| ${marker} | ${tagCell} | ${fmtDate(ver.created_at)} | [\`${ver.id}\`](${ver.html_url}) |`
        );
      }

      // SHA builds — show newest 3, then summarize
      const shaDisplay = shaOnly.slice(0, 3);
      for (const ver of shaDisplay) {
        const shortSha = ver.tags[0].slice(0, 12);
        L.push(
          `| 🔹 | \`${shortSha}\` | ${fmtDate(ver.created_at)} | [\`${ver.id}\`](${ver.html_url}) |`
        );
      }
      if (shaOnly.length > 3) {
        L.push(
          `| | *… +${shaOnly.length - 3} more SHA builds* | | |`
        );
      }

      // Untagged summary
      if (untagged.length > 0) {
        L.push(
          `| ⚪ | *${untagged.length} untagged image layer${untagged.length !== 1 ? "s" : ""}* | | |`
        );
      }

      L.push("");
      L.push("</details>");
      L.push("");
    }
  }

  // ── Footer ──
  L.push("---");
  L.push("");
  L.push(
    `<sub>Auto-generated from GHCR API &nbsp;·&nbsp; <code>ghrc/src/fetch.ts</code> + <code>ghrc/src/generate-md.ts</code> &nbsp;·&nbsp; ${fmtDate(data.fetched_at)}</sub>`
  );
  L.push("");

  return L.join("\n");
}

function main() {
  const data: GhcrData = JSON.parse(readFileSync(DATA, "utf-8"));
  const md = generateMarkdown(data);
  writeFileSync(OUT, md);
  console.log(
    `Wrote dist/GHCR.md (${data.total_packages} packages, ${Object.keys(data.repos).length} repos)`
  );
}

main();
