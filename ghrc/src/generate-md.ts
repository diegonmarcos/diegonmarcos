#!/usr/bin/env tsx
/**
 * Reads ghcr-data.json and generates 4 markdown files:
 *   GHCR.md              — main view (by source repo)
 *   ghcr-byreposrc.md    — packages grouped by linked source repo
 *   ghcr-byrepogha.md    — packages grouped by GHA workflow access
 *   ghcr-byrepocodespc.md — packages grouped by Codespace access
 *
 * Key: <summary> tags use raw HTML (markdown doesn't render inside them).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const DATA = join(DIST, "ghcr-data.json");

interface PackageVersion {
  id: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface PlatformInfo {
  os: string;
  architecture: string;
  size_bytes: number;
  entrypoint: string[] | null;
  exposed_ports: string[];
  working_dir: string;
  env: string[];
  labels: Record<string, string>;
  layers_count: number;
  created: string;
}

interface Package {
  name: string;
  visibility: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  versions: PackageVersion[];
  platforms?: PlatformInfo[];
}

interface RepoGroup {
  repo_url: string;
  packages: Package[];
}

interface WorkflowAccess {
  workflow: string;
  workflow_url: string;
  repo: string;
  packages: string[];
}

interface CodespaceAccess {
  repo: string;
  repo_url: string;
  packages: string[];
}

interface GhcrData {
  fetched_at: string;
  owner: string;
  total_packages: number;
  repos: Record<string, RepoGroup>;
  gha_access: WorkflowAccess[];
  codespace_access: CodespaceAccess[];
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

function fmtSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getPkgPorts(pkg: Package): string {
  const ports = new Set<string>();
  for (const p of pkg.platforms ?? []) {
    for (const port of p.exposed_ports) {
      ports.add(port.replace("/tcp", ""));
    }
  }
  return ports.size > 0 ? [...ports].join(", ") : "";
}

function getPkgSizeBytes(pkg: Package): number {
  const sizes = (pkg.platforms ?? []).map((p) => p.size_bytes).filter((s) => s > 0);
  return sizes.length > 0 ? Math.max(...sizes) : 0;
}

function getPkgSize(pkg: Package): string {
  const bytes = getPkgSizeBytes(pkg);
  return bytes > 0 ? fmtSize(bytes) : "";
}

function totalSize(pkgs: Package[]): string {
  const total = pkgs.reduce((s, p) => s + getPkgSizeBytes(p), 0);
  return total > 0 ? fmtSize(total) : "—";
}

function getPkgArchs(pkg: Package): string {
  return (pkg.platforms ?? []).map((p) => `${p.os}/${p.architecture}`).join(", ");
}

function visBadgeHtml(vis: string): string {
  const label = vis === "public" ? "Public" : "Private";
  return `<img src="https://img.shields.io/badge/${label}-gray?style=flat-square" alt="${label}" height="18">`;
}

interface NavItem {
  label: string;
  file: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Main", file: "GHCR.md", icon: "📦" },
  { label: "By Repo", file: "ghcr-byreposrc.md", icon: "📁" },
  { label: "By GHA", file: "ghcr-byrepogha.md", icon: "⚙️" },
  { label: "By Arch", file: "ghcr-byarchitecture.md", icon: "🏗️" },
  { label: "By Vis", file: "ghcr-byvisibility.md", icon: "🔒" },
  { label: "By Codespace", file: "ghcr-byrepocodespc.md", icon: "💻" },
];

function renderNav(activeLabel: string, pkgCount: number, totalSizeStr: string): string[] {
  const L: string[] = [];
  const pills = NAV_ITEMS.map((item) => {
    const color = item.label === activeLabel ? "2f81f7" : "30363d";
    const style = "for-the-badge";
    const badge = `https://img.shields.io/badge/${encodeURIComponent(item.icon + " " + item.label)}-${color}?style=${style}`;
    if (item.label === activeLabel) {
      return `<img src="${badge}" alt="${item.label}" height="28">`;
    }
    return `<a href="${item.file}"><img src="${badge}" alt="${item.label}" height="28"></a>`;
  }).join("\n  ");

  L.push(`<p align="center">`);
  L.push(`  ${pills}`);
  L.push(`</p>`);
  L.push("");
  L.push(`<p align="center"><sub><b>${pkgCount}</b> packages · <b>${totalSizeStr}</b> total</sub></p>`);
  L.push("");
  return L;
}

// ── Shared: render a package card ──
function renderPackageCard(pkg: Package, owner: string): string[] {
  const L: string[] = [];
  const { semantic, shaOnly, untagged } = classifyVersions(pkg.versions);
  const taggedCount = semantic.length + shaOnly.length;

  const ports = getPkgPorts(pkg);
  const size = getPkgSize(pkg);
  const archs = getPkgArchs(pkg);
  const metaParts = [
    `Published ${relativeDate(pkg.updated_at)}`,
    `${taggedCount} tags`,
    archs ? archs : null,
    size ? size : null,
    ports ? `port ${ports}` : null,
  ].filter(Boolean).join(" · ");

  L.push("<details>");
  L.push(
    `<summary>📦 <a href="${pkg.html_url}"><b>${pkg.name}</b></a> &nbsp;${visBadgeHtml(pkg.visibility)} &nbsp;<sub>${metaParts}</sub></summary>`
  );
  L.push("");
  L.push("```bash");
  L.push(`docker pull ghcr.io/${owner}/${pkg.name}:latest`);
  L.push("```");
  L.push("");
  L.push("| | Tag | Published | Digest |");
  L.push("|:---|:---|:---|:---|");

  for (const ver of semantic) {
    const primaryTag = ver.tags[0];
    const extraTags = ver.tags.slice(1);
    const tagCell =
      extraTags.length > 0
        ? `\`${primaryTag}\` ${extraTags.map((t) => `\`${t}\``).join(" ")}`
        : `\`${primaryTag}\``;
    const marker = ver.tags.includes("latest") ? "🟢" : "🏷️";
    L.push(
      `| ${marker} | ${tagCell} | ${fmtDate(ver.created_at)} | [\`${ver.id}\`](${ver.html_url}) |`
    );
  }

  const shaDisplay = shaOnly.slice(0, 3);
  for (const ver of shaDisplay) {
    L.push(
      `| 🔹 | \`${ver.tags[0].slice(0, 12)}\` | ${fmtDate(ver.created_at)} | [\`${ver.id}\`](${ver.html_url}) |`
    );
  }
  if (shaOnly.length > 3) {
    L.push(`| | *… +${shaOnly.length - 3} more SHA builds* | | |`);
  }
  if (untagged.length > 0) {
    L.push(
      `| ⚪ | *${untagged.length} untagged image layer${untagged.length !== 1 ? "s" : ""}* | | |`
    );
  }

  L.push("");
  L.push("</details>");
  L.push("");
  return L;
}

function footer(data: GhcrData): string[] {
  return [
    "---",
    "",
    `<sub>Auto-generated from GHCR API · <code>ghrc/src/fetch.ts</code> + <code>ghrc/src/generate-md.ts</code> · ${fmtDate(data.fetched_at)}</sub>`,
    "",
  ];
}

// ── Build a flat lookup: package name → Package ──
function buildPkgMap(data: GhcrData): Map<string, Package> {
  const map = new Map<string, Package>();
  for (const group of Object.values(data.repos)) {
    for (const pkg of group.packages) {
      map.set(pkg.name, pkg);
    }
  }
  return map;
}

// ════════════════════════════════════════════════════════════════
//  1. GHCR.md — main view by source repo (same as before)
// ════════════════════════════════════════════════════════════════
function generateMain(data: GhcrData): string {
  const L: string[] = [];

  const allPkgs = Object.values(data.repos).flatMap((g) => g.packages);
  const total = totalSize(allPkgs);

  L.push(...renderNav("Main", data.total_packages, total));

  L.push("```");
  L.push("        ╔══════════════════════════════════════════════════╗");
  L.push("        ║                                                  ║");
  L.push("        ║     ┌─────────┐  ┌─────────┐  ┌─────────┐      ║");
  L.push("        ║     │  ┌───┐  │  │  ┌───┐  │  │  ┌───┐  │      ║");
  L.push("        ║     │  │ 🐳│  │  │  │ 🐳│  │  │  │ 🐳│  │      ║");
  L.push("        ║     │  └───┘  │  │  └───┘  │  │  └───┘  │      ║");
  L.push("        ║     └────┬────┘  └────┬────┘  └────┬────┘      ║");
  L.push("        ║          │            │            │            ║");
  L.push("        ║     ─────┴────────────┴────────────┴─────      ║");
  L.push("        ║          G H C R   R E G I S T R Y            ║");
  L.push("        ║                                                  ║");
  L.push("        ╚══════════════════════════════════════════════════╝");
  L.push("```");
  L.push("");
  L.push(`<h1 align="center">📦 GitHub Container Registry</h1>`);
  L.push("");
  L.push(`<p align="center"><i>Every service gets a container — immutable, versioned, shipped.<br>Auto-generated catalog of all GHCR packages for <code>@${data.owner}</code>.</i></p>`);
  L.push("");
  L.push("---");
  L.push("");

  const sortedRepos = Object.entries(data.repos).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  for (const [repoName, group] of sortedRepos) {
    const repoLink = group.repo_url
      ? `<a href="${group.repo_url}">${repoName}</a>`
      : repoName;

    L.push("---");
    L.push("");
    const repoTotal = totalSize(group.packages);
    L.push(
      `### 📁 ${repoLink} &nbsp;<sup>${group.packages.length} package${group.packages.length !== 1 ? "s" : ""} · ${repoTotal}</sup>`
    );
    L.push("");

    for (const pkg of group.packages) {
      L.push(...renderPackageCard(pkg, data.owner));
    }
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ════════════════════════════════════════════════════════════════
//  2. ghcr-byreposrc.md — same grouping, compact table view
// ════════════════════════════════════════════════════════════════
function generateByRepoSrc(data: GhcrData): string {
  const L: string[] = [];

  const allPkgsSrc = Object.values(data.repos).flatMap((g) => g.packages);

  L.push(...renderNav("By Repo", data.total_packages, totalSize(allPkgsSrc)));
  L.push(`# 📦 Packages — By Source Repository`);
  L.push("");

  const sortedRepos = Object.entries(data.repos).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  for (const [repoName, group] of sortedRepos) {
    const repoLink = group.repo_url
      ? `[${repoName}](${group.repo_url})`
      : repoName;

    L.push("---");
    L.push("");
    L.push(`### 📁 ${repoLink} <sup>${group.packages.length} · ${totalSize(group.packages)}</sup>`);
    L.push("");
    L.push("| Package | Visibility | Arch | Tags | Size | Updated |");
    L.push("|:---|:---|:---|:---|:---|:---|");

    for (const pkg of group.packages) {
      const { semantic, shaOnly } = classifyVersions(pkg.versions);
      const taggedCount = semantic.length + shaOnly.length;
      const size = getPkgSize(pkg) || "—";
      const arch = getPkgArchs(pkg) || "—";
      L.push(
        `| [${pkg.name}](${pkg.html_url}) | ${pkg.visibility} | ${arch} | ${taggedCount} | ${size} | ${relativeDate(pkg.updated_at)} |`
      );
    }

    L.push("");
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ════════════════════════════════════════════════════════════════
//  3. ghcr-byrepogha.md — grouped by GHA workflow
// ════════════════════════════════════════════════════════════════
function generateByRepoGha(data: GhcrData): string {
  const L: string[] = [];
  const pkgMap = buildPkgMap(data);

  const allPkgsGha = Object.values(data.repos).flatMap((g) => g.packages);
  L.push(...renderNav("By GHA", data.total_packages, totalSize(allPkgsGha)));
  L.push(`# ⚙️ Packages — By GitHub Actions Workflow`);
  L.push("");

  if (!data.gha_access || data.gha_access.length === 0) {
    L.push("*No GHA workflows with `packages:write` found.*");
    L.push("");
  } else {
    // Group by repo
    const byRepo = new Map<string, WorkflowAccess[]>();
    for (const wf of data.gha_access) {
      const list = byRepo.get(wf.repo) ?? [];
      list.push(wf);
      byRepo.set(wf.repo, list);
    }

    for (const [repo, workflows] of [...byRepo.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      L.push("---");
      L.push("");
      L.push(`### 📁 ${repo} <sup>${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}</sup>`);
      L.push("");

      for (const wf of workflows) {
        const wfPkgList = wf.packages.map((n) => pkgMap.get(n)).filter(Boolean) as Package[];
        L.push("<details>");
        L.push(
          `<summary>⚙️ <a href="${wf.workflow_url}"><b>${wf.workflow}</b></a> &nbsp;<sub>${wf.packages.length} package${wf.packages.length !== 1 ? "s" : ""} · ${totalSize(wfPkgList)}</sub></summary>`
        );
        const wfPkgs = wf.packages.map((n) => pkgMap.get(n)).filter(Boolean) as Package[];
        L.push("");
        L.push("| Package | Visibility | Size | Updated |");
        L.push("|:---|:---|:---|:---|");

        for (const name of wf.packages) {
          const pkg = pkgMap.get(name);
          if (pkg) {
            L.push(
              `| [${pkg.name}](${pkg.html_url}) | ${pkg.visibility} | ${getPkgSize(pkg) || "—"} | ${relativeDate(pkg.updated_at)} |`
            );
          } else {
            L.push(`| ${name} | — | — | — |`);
          }
        }

        L.push("");
        L.push("</details>");
        L.push("");
      }
    }

    // Show packages with NO GHA access
    const allGhaPackages = new Set(data.gha_access.flatMap((w) => w.packages));
    const noGha = [...pkgMap.keys()].filter((n) => !allGhaPackages.has(n)).sort();
    if (noGha.length > 0) {
      L.push("---");
      L.push("");
      L.push(`### 🚫 No GHA workflow <sup>${noGha.length}</sup>`);
      L.push("");
      L.push("| Package | Visibility | Size | Source Repo |");
      L.push("|:---|:---|:---|:---|");
      for (const name of noGha) {
        const pkg = pkgMap.get(name)!;
        const repo = Object.entries(data.repos).find(([, g]) =>
          g.packages.some((p) => p.name === name)
        );
        const repoName = repo ? repo[0] : "—";
        L.push(`| [${name}](${pkg.html_url}) | ${pkg.visibility} | ${getPkgSize(pkg) || "—"} | ${repoName} |`);
      }
      L.push("");
    }
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ════════════════════════════════════════════════════════════════
//  4. ghcr-byrepocodespc.md — grouped by Codespace access
// ════════════════════════════════════════════════════════════════
function generateByRepoCodespace(data: GhcrData): string {
  const L: string[] = [];
  const pkgMap = buildPkgMap(data);

  const allPkgsCs = Object.values(data.repos).flatMap((g) => g.packages);
  L.push(...renderNav("By Codespace", data.total_packages, totalSize(allPkgsCs)));
  L.push(`# 💻 Packages — By Codespace Access`);
  L.push("");

  // Derive codespace access from source repo linkage (inherited access)
  const withAccess = new Map<string, Package[]>();
  const noAccess: Package[] = [];

  for (const [repoName, group] of Object.entries(data.repos)) {
    for (const pkg of group.packages) {
      const sourceLabel = pkg.platforms?.[0]?.labels?.["org.opencontainers.image.source"];
      if (sourceLabel || (repoName !== "_unlinked" && group.repo_url)) {
        const list = withAccess.get(repoName) ?? [];
        list.push(pkg);
        withAccess.set(repoName, list);
      } else {
        noAccess.push(pkg);
      }
    }
  }

  if (withAccess.size > 0) {
    L.push("*Codespace read access is inherited from the linked source repository.*");
    L.push("");

    for (const [repoName, pkgs] of [...withAccess.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const repoUrl = data.repos[repoName]?.repo_url;
      const repoLink = repoUrl ? `[${repoName}](${repoUrl})` : repoName;

      L.push("---");
      L.push("");
      L.push(`### 📁 ${repoLink} <sup>${pkgs.length} · ${totalSize(pkgs)} · Role: Read</sup>`);
      L.push("");
      L.push("| Package | Visibility | Size | Updated |");
      L.push("|:---|:---|:---|:---|");
      for (const pkg of pkgs.sort((a, b) => a.name.localeCompare(b.name))) {
        L.push(
          `| [${pkg.name}](${pkg.html_url}) | ${pkg.visibility} | ${getPkgSize(pkg) || "—"} | ${relativeDate(pkg.updated_at)} |`
        );
      }
      L.push("");
    }
  }

  if (noAccess.length > 0) {
    L.push("---");
    L.push("");
    L.push(`### 🚫 Not defined <sup>${noAccess.length}</sup>`);
    L.push("");
    L.push("| Package | Visibility | Size | Updated |");
    L.push("|:---|:---|:---|:---|");
    for (const pkg of noAccess.sort((a, b) => a.name.localeCompare(b.name))) {
      L.push(
        `| [${pkg.name}](${pkg.html_url}) | ${pkg.visibility} | ${getPkgSize(pkg) || "—"} | ${relativeDate(pkg.updated_at)} |`
      );
    }
    L.push("");
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ════════════════════════════════════════════════════════════════
//  5. ghcr-byarchitecture.md — grouped by CPU architecture
// ════════════════════════════════════════════════════════════════
function generateByArchitecture(data: GhcrData): string {
  const L: string[] = [];
  const pkgMap = buildPkgMap(data);

  const allPkgsArch = Object.values(data.repos).flatMap((g) => g.packages);
  L.push(...renderNav("By Arch", data.total_packages, totalSize(allPkgsArch)));
  L.push(`# 🏗️ Packages — By Architecture`);
  L.push("");

  // Collect all architectures and which packages support them
  const archMap = new Map<string, Array<{ pkg: Package; platform: PlatformInfo }>>();
  const noArch: Package[] = [];

  for (const pkg of pkgMap.values()) {
    if (!pkg.platforms || pkg.platforms.length === 0) {
      noArch.push(pkg);
      continue;
    }
    for (const p of pkg.platforms) {
      const key = `${p.os}/${p.architecture}`;
      const list = archMap.get(key) ?? [];
      list.push({ pkg, platform: p });
      archMap.set(key, list);
    }
  }

  // Summary table
  L.push("### Overview");
  L.push("");
  L.push("| Architecture | Packages | Total Size |");
  L.push("|:---|:---|:---|");
  for (const [arch, entries] of [...archMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const totalSize = entries.reduce((s, e) => s + e.platform.size_bytes, 0);
    L.push(`| \`${arch}\` | ${entries.length} | ${fmtSize(totalSize)} |`);
  }
  if (noArch.length > 0) {
    L.push(`| *unknown* | ${noArch.length} | — |`);
  }
  L.push("");

  // Multi-arch vs single-arch classification
  const multiArch: Package[] = [];
  const singleArch: Package[] = [];
  for (const pkg of pkgMap.values()) {
    if (!pkg.platforms || pkg.platforms.length === 0) continue;
    if (pkg.platforms.length > 1) multiArch.push(pkg);
    else singleArch.push(pkg);
  }

  if (multiArch.length > 0) {
    L.push("---");
    L.push("");
    L.push(`### 🌐 Multi-architecture <sup>${multiArch.length}</sup>`);
    L.push("");
    L.push("| Package | Platforms | Size (largest) | Ports | Entrypoint |");
    L.push("|:---|:---|:---|:---|:---|");
    for (const pkg of multiArch.sort((a, b) => a.name.localeCompare(b.name))) {
      const archs = pkg.platforms!.map((p) => `\`${p.os}/${p.architecture}\``).join(" ");
      const size = fmtSize(Math.max(...pkg.platforms!.map((p) => p.size_bytes)));
      const ports = getPkgPorts(pkg) || "—";
      const ep = pkg.platforms![0].entrypoint?.join(" ") ?? "—";
      L.push(`| [${pkg.name}](${pkg.html_url}) | ${archs} | ${size} | ${ports} | \`${ep}\` |`);
    }
    L.push("");
  }

  if (singleArch.length > 0) {
    L.push("---");
    L.push("");
    L.push(`### 💻 Single-architecture <sup>${singleArch.length}</sup>`);
    L.push("");
    L.push("| Package | Platform | Size | Ports | Entrypoint |");
    L.push("|:---|:---|:---|:---|:---|");
    for (const pkg of singleArch.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = pkg.platforms![0];
      const arch = `\`${p.os}/${p.architecture}\``;
      const size = fmtSize(p.size_bytes);
      const ports = getPkgPorts(pkg) || "—";
      const ep = p.entrypoint?.join(" ") ?? "—";
      L.push(`| [${pkg.name}](${pkg.html_url}) | ${arch} | ${size} | ${ports} | \`${ep}\` |`);
    }
    L.push("");
  }

  // Per-architecture detail sections
  for (const [arch, entries] of [...archMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    L.push("---");
    L.push("");
    L.push(`### \`${arch}\` <sup>${entries.length} packages</sup>`);
    L.push("");
    L.push("| Package | Size | Layers | Ports | Working Dir | Entrypoint |");
    L.push("|:---|:---|:---|:---|:---|:---|");
    for (const { pkg, platform: p } of entries.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))) {
      const ports = p.exposed_ports.map((pt) => pt.replace("/tcp", "")).join(", ") || "—";
      const ep = p.entrypoint?.join(" ") ?? "—";
      L.push(
        `| [${pkg.name}](${pkg.html_url}) | ${fmtSize(p.size_bytes)} | ${p.layers_count} | ${ports} | \`${p.working_dir || "/"}\` | \`${ep}\` |`
      );
    }
    L.push("");
  }

  if (noArch.length > 0) {
    L.push("---");
    L.push("");
    L.push(`### ❓ No OCI metadata <sup>${noArch.length}</sup>`);
    L.push("");
    L.push("| Package | Visibility | Updated |");
    L.push("|:---|:---|:---|");
    for (const pkg of noArch.sort((a, b) => a.name.localeCompare(b.name))) {
      L.push(`| [${pkg.name}](${pkg.html_url}) | ${pkg.visibility} | ${relativeDate(pkg.updated_at)} |`);
    }
    L.push("");
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ════════════════════════════════════════════════════════════════
//  6. ghcr-byvisibility.md — public vs private
// ════════════════════════════════════════════════════════════════
function generateByVisibility(data: GhcrData): string {
  const L: string[] = [];
  const allPkgs = Object.values(data.repos).flatMap((g) => g.packages);
  const pubPkgs = allPkgs.filter((p) => p.visibility === "public").sort((a, b) => a.name.localeCompare(b.name));
  const privPkgs = allPkgs.filter((p) => p.visibility !== "public").sort((a, b) => a.name.localeCompare(b.name));

  L.push(...renderNav("By Vis", allPkgs.length, totalSize(allPkgs)));
  L.push(`# 🔒 Packages — By Visibility`);
  L.push("");

  // Overview
  L.push("### Overview");
  L.push("");
  L.push("| Visibility | Packages | Total Size |");
  L.push("|:---|:---|:---|");
  L.push(`| Public | ${pubPkgs.length} | ${totalSize(pubPkgs)} |`);
  L.push(`| Private | ${privPkgs.length} | ${totalSize(privPkgs)} |`);
  L.push("");

  // Public
  L.push("---");
  L.push("");
  L.push(`### 🌐 Public <sup>${pubPkgs.length} · ${totalSize(pubPkgs)}</sup>`);
  L.push("");
  L.push("| Package | Arch | Size | Ports | Source Repo | Updated |");
  L.push("|:---|:---|:---|:---|:---|:---|");
  for (const pkg of pubPkgs) {
    const repo = Object.entries(data.repos).find(([, g]) => g.packages.some((p) => p.name === pkg.name));
    const repoName = repo ? repo[0] : "—";
    L.push(
      `| [${pkg.name}](${pkg.html_url}) | ${getPkgArchs(pkg) || "—"} | ${getPkgSize(pkg) || "—"} | ${getPkgPorts(pkg) || "—"} | ${repoName} | ${relativeDate(pkg.updated_at)} |`
    );
  }
  L.push("");

  // Private
  if (privPkgs.length > 0) {
    L.push("---");
    L.push("");
    L.push(`### 🔒 Private <sup>${privPkgs.length} · ${totalSize(privPkgs)}</sup>`);
    L.push("");
    L.push("| Package | Arch | Size | Ports | Source Repo | Updated |");
    L.push("|:---|:---|:---|:---|:---|:---|");
    for (const pkg of privPkgs) {
      const repo = Object.entries(data.repos).find(([, g]) => g.packages.some((p) => p.name === pkg.name));
      const repoName = repo ? repo[0] : "—";
      L.push(
        `| [${pkg.name}](${pkg.html_url}) | ${getPkgArchs(pkg) || "—"} | ${getPkgSize(pkg) || "—"} | ${getPkgPorts(pkg) || "—"} | ${repoName} | ${relativeDate(pkg.updated_at)} |`
      );
    }
    L.push("");
  } else {
    L.push("---");
    L.push("");
    L.push("### 🔒 Private <sup>0</sup>");
    L.push("");
    L.push("*No private packages.*");
    L.push("");
  }

  L.push(...footer(data));
  return L.join("\n");
}

// ════════════════════════════════════════════════════════════════
function main() {
  const data: GhcrData = JSON.parse(readFileSync(DATA, "utf-8"));

  const files: Array<[string, string]> = [
    ["GHCR.md", generateMain(data)],
    ["ghcr-byreposrc.md", generateByRepoSrc(data)],
    ["ghcr-byrepogha.md", generateByRepoGha(data)],
    ["ghcr-byarchitecture.md", generateByArchitecture(data)],
    ["ghcr-byvisibility.md", generateByVisibility(data)],
    ["ghcr-byrepocodespc.md", generateByRepoCodespace(data)],
  ];

  for (const [name, content] of files) {
    writeFileSync(join(DIST, name), content);
    console.log(`Wrote dist/${name}`);
  }

  console.log(
    `\n${data.total_packages} packages, ${Object.keys(data.repos).length} repos, ${data.gha_access?.length ?? 0} GHA workflows, ${data.codespace_access?.length ?? 0} codespaces`
  );
}

main();
