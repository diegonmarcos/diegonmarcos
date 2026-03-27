#!/usr/bin/env tsx
/**
 * Fetches all GHCR container package metadata for diegonmarcos,
 * plus GHA workflow and Codespace access mappings.
 * Writes ghcr-data.json.
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
  platforms: PlatformInfo[];
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

type GhcrData = {
  fetched_at: string;
  owner: string;
  total_packages: number;
  repos: Record<string, RepoGroup>;
  gha_access: WorkflowAccess[];
  codespace_access: CodespaceAccess[];
};

function gh<T>(endpoint: string): T {
  const raw = execSync(`gh api '${endpoint}' --paginate 2>/dev/null`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(raw) as T;
}

function ghRaw(endpoint: string): string {
  try {
    return execSync(`gh api '${endpoint}' --paginate`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return "";
  }
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

function curlJson(url: string, headers: string[]): unknown {
  const hArgs = headers.map((h) => `-H '${h}'`).join(" ");
  const raw = execSync(`curl -sL ${hArgs} '${url}'`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function fetchPlatforms(name: string): PlatformInfo[] {
  try {
    // Get anonymous token for public packages
    const tokenData = curlJson(
      `https://ghcr.io/token?scope=repository:${USER}/${name}:pull`,
      []
    ) as { token: string };
    const token = tokenData.token;
    const auth = `Authorization: Bearer ${token}`;
    const acceptIndex =
      "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json";

    // Get manifest index
    const index = curlJson(
      `https://ghcr.io/v2/${USER}/${name}/manifests/latest`,
      [auth, acceptIndex]
    ) as {
      mediaType?: string;
      manifests?: Array<{
        digest: string;
        platform?: { os: string; architecture: string };
      }>;
      config?: { digest: string };
      layers?: Array<{ size: number }>;
    };

    const platforms: PlatformInfo[] = [];

    // Multi-arch image
    if (index.manifests) {
      const realManifests = index.manifests.filter(
        (m) => m.platform && m.platform.os !== "unknown"
      );

      for (const entry of realManifests) {
        // Get platform-specific manifest
        const manifest = curlJson(
          `https://ghcr.io/v2/${USER}/${name}/manifests/${entry.digest}`,
          [auth, "Accept: application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"]
        ) as {
          config: { digest: string };
          layers: Array<{ size: number }>;
        };

        const totalSize = manifest.layers.reduce((s, l) => s + l.size, 0);

        // Get config blob
        const config = curlJson(
          `https://ghcr.io/v2/${USER}/${name}/blobs/${manifest.config.digest}`,
          [auth]
        ) as {
          created?: string;
          config?: {
            Entrypoint?: string[];
            ExposedPorts?: Record<string, unknown>;
            WorkingDir?: string;
            Env?: string[];
            Labels?: Record<string, string>;
          };
          rootfs?: { diff_ids?: string[] };
        };

        platforms.push({
          os: entry.platform!.os,
          architecture: entry.platform!.architecture,
          size_bytes: totalSize,
          entrypoint: config.config?.Entrypoint ?? null,
          exposed_ports: Object.keys(config.config?.ExposedPorts ?? {}),
          working_dir: config.config?.WorkingDir ?? "",
          env: config.config?.Env ?? [],
          labels: config.config?.Labels ?? {},
          layers_count: config.rootfs?.diff_ids?.length ?? manifest.layers.length,
          created: config.created ?? "",
        });
      }
    } else if (index.config) {
      // Single-arch image
      const totalSize = (index.layers ?? []).reduce((s, l) => s + l.size, 0);
      const config = curlJson(
        `https://ghcr.io/v2/${USER}/${name}/blobs/${index.config.digest}`,
        [auth]
      ) as {
        architecture?: string;
        os?: string;
        created?: string;
        config?: {
          Entrypoint?: string[];
          ExposedPorts?: Record<string, unknown>;
          WorkingDir?: string;
          Env?: string[];
          Labels?: Record<string, string>;
        };
        rootfs?: { diff_ids?: string[] };
      };

      platforms.push({
        os: config.os ?? "linux",
        architecture: config.architecture ?? "unknown",
        size_bytes: totalSize,
        entrypoint: config.config?.Entrypoint ?? null,
        exposed_ports: Object.keys(config.config?.ExposedPorts ?? {}),
        working_dir: config.config?.WorkingDir ?? "",
        env: config.config?.Env ?? [],
        labels: config.config?.Labels ?? {},
        layers_count: config.rootfs?.diff_ids?.length ?? 0,
        created: config.created ?? "",
      });
    }

    return platforms;
  } catch {
    console.warn(`    ⚠ Failed to fetch OCI metadata for ${name}`);
    return [];
  }
}

function fetchGhaAccess(allPackageNames: string[]): WorkflowAccess[] {
  console.log("\nFetching GHA workflow access...");

  const repos = gh<Array<{ name: string; full_name: string; html_url: string }>>(
    `users/${USER}/repos?per_page=100&type=owner`
  );

  const access: WorkflowAccess[] = [];

  for (const repo of repos) {
    let workflows: Array<{ name: string; path: string }>;
    try {
      workflows = gh<{ workflows: Array<{ name: string; path: string }> }>(
        `repos/${repo.full_name}/actions/workflows`
      ).workflows;
    } catch {
      continue;
    }

    if (workflows.length === 0) continue;

    for (const wf of workflows) {
      // Read workflow file content
      const filename = wf.path.split("/").pop();
      let content: string;
      try {
        const raw = gh<{ content: string }>(
          `repos/${repo.full_name}/contents/${wf.path}`
        );
        content = Buffer.from(raw.content, "base64").toString("utf-8");
      } catch {
        continue;
      }

      // Check if workflow has packages:write and references ghcr
      if (!content.includes("packages") || !content.toLowerCase().includes("ghcr")) {
        continue;
      }

      // Extract package names referenced in the workflow
      const found: string[] = [];
      for (const pkg of allPackageNames) {
        if (content.includes(pkg)) {
          found.push(pkg);
        }
      }

      // Also check matrix includes for image names
      const matrixNameRe = /name:\s*(\S+)/g;
      let m: RegExpExecArray | null;
      while ((m = matrixNameRe.exec(content)) !== null) {
        const name = m[1];
        if (allPackageNames.includes(name) && !found.includes(name)) {
          found.push(name);
        }
      }

      if (found.length > 0) {
        const wfUrl = `${repo.html_url}/blob/main/${wf.path}`;
        console.log(`  ${repo.name}/${filename} → ${found.length} packages`);
        access.push({
          workflow: wf.name,
          workflow_url: wfUrl,
          repo: repo.name,
          packages: found.sort(),
        });
      }
    }
  }

  return access;
}

function fetchCodespaceAccess(allPackageNames: string[]): CodespaceAccess[] {
  console.log("\nFetching Codespace access...");

  const repos = gh<Array<{ name: string; full_name: string; html_url: string }>>(
    `users/${USER}/repos?per_page=100&type=owner`
  );

  const access: CodespaceAccess[] = [];

  for (const repo of repos) {
    // Check for devcontainer.json
    let hasDevcontainer = false;
    try {
      gh<unknown>(`repos/${repo.full_name}/contents/.devcontainer`);
      hasDevcontainer = true;
    } catch {
      try {
        gh<unknown>(`repos/${repo.full_name}/contents/.devcontainer.json`);
        hasDevcontainer = true;
      } catch {
        // no devcontainer
      }
    }

    if (!hasDevcontainer) continue;

    // Read devcontainer content to find ghcr references
    let content = "";
    try {
      const raw = gh<{ content: string }>(
        `repos/${repo.full_name}/contents/.devcontainer/devcontainer.json`
      );
      content = Buffer.from(raw.content, "base64").toString("utf-8");
    } catch {
      try {
        const raw = gh<{ content: string }>(
          `repos/${repo.full_name}/contents/.devcontainer.json`
        );
        content = Buffer.from(raw.content, "base64").toString("utf-8");
      } catch {
        continue;
      }
    }

    const found = allPackageNames.filter((pkg) => content.includes(pkg));
    if (found.length > 0) {
      console.log(`  ${repo.name} → ${found.length} packages`);
      access.push({
        repo: repo.name,
        repo_url: repo.html_url,
        packages: found.sort(),
      });
    }
  }

  return access;
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
  const allPackageNames: string[] = [];

  for (const pkg of packages) {
    const repoName = pkg.repository?.name ?? "_unlinked";
    const repoUrl = pkg.repository?.html_url ?? "";

    if (!repos[repoName]) {
      repos[repoName] = { repo_url: repoUrl, packages: [] };
    }

    console.log(`  ${repoName}/${pkg.name}`);
    allPackageNames.push(pkg.name);
    const versions = fetchVersions(pkg.name);
    const platforms = fetchPlatforms(pkg.name);
    if (platforms.length > 0) {
      console.log(`    ${platforms.map((p) => `${p.os}/${p.architecture}`).join(", ")}`);
    }

    repos[repoName].packages.push({
      name: pkg.name,
      visibility: pkg.visibility,
      html_url: pkg.html_url,
      created_at: pkg.created_at,
      updated_at: pkg.updated_at,
      versions,
      platforms,
    });
  }

  for (const group of Object.values(repos)) {
    group.packages.sort((a, b) => a.name.localeCompare(b.name));
  }

  const gha_access = fetchGhaAccess(allPackageNames);
  const codespace_access = fetchCodespaceAccess(allPackageNames);

  const data: GhcrData = {
    fetched_at: new Date().toISOString(),
    owner: USER,
    total_packages: packages.length,
    repos,
    gha_access,
    codespace_access,
  };

  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWrote dist/ghcr-data.json`);
}

main();
