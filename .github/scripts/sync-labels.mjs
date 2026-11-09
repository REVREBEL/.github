#!/usr/bin/env node
// Sync the canonical REVREBEL issue-label catalog to installed repositories.
// Dry-run by default. No deletion or renaming of noncanonical labels.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function parseLabels(text) {
  const labels = [];
  let entry = null;
  const commit = () => {
    if (!entry) return;
    if (!entry.name || !/^[a-fA-F0-9]{6}$/.test(entry.color || "") || !entry.description) {
      throw Error("Malformed labels.yml entry: " + JSON.stringify(entry));
    }
    if (labels.some(label => label.name.toLowerCase() === entry.name.toLowerCase())) {
      throw Error("Duplicate label: " + entry.name);
    }
    labels.push(entry);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const name = line.match(/^- name:\s*(['"])(.*?)\1\s*$/);
    if (name) {
      commit();
      entry = { name: name[2] };
      continue;
    }
    const property = line.match(/^\s{2}(color|description):\s*(.*?)\s*$/);
    if (!entry || !property || Object.hasOwn(entry, property[1])) {
      throw Error("Unsupported labels.yml syntax: " + line);
    }
    let value = property[2];
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    entry[property[1]] = value;
  }
  commit();
  if (!labels.length) throw Error("No canonical labels found");
  return labels;
}

export function createGitHubClient(token, fetcher = fetch) {
  if (!token) throw Error("Missing GH_TOKEN; configure the revrebel-github App credentials.");
  return async function request(route, options = {}) {
    const response = await fetcher("https://api.github.com" + route, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const body = await response.text();
    if (!response.ok) throw Error(`GitHub API HTTP ${response.status} on ${options.method || "GET"} ${route}: ${body.slice(0, 500)}`);
    return body ? JSON.parse(body) : null;
  };
}

export async function listInstallationRepos(request) {
  const repos = [];
  for (let page = 1; ; page++) {
    const result = await request(`/installation/repositories?per_page=100&page=${page}`);
    if (!Array.isArray(result?.repositories)) throw Error("App installation repository list unavailable");
    repos.push(...result.repositories);
    if (result.repositories.length < 100) return repos;
  }
}

export async function syncRepository(request, repo, labels, { dryRun = true, log = console.log } = {}) {
  const base = `/repos/${repo}/labels`;
  const existing = new Map();
  for (let page = 1; ; page++) {
    const batch = await request(base + `?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error("Could not load labels for " + repo);
    for (const label of batch) existing.set(label.name.toLowerCase(), label);
    if (batch.length < 100) break;
  }
  const counts = { create: 0, update: 0, unchanged: 0 };
  for (const label of labels) {
    const current = existing.get(label.name.toLowerCase());
    const desired = { name: label.name, color: label.color.toLowerCase(), description: label.description };
    if (!current) {
      counts.create++;
      log(`${dryRun ? "[DRY-RUN]" : "[CREATE]"} ${repo}: ${label.name} (create)`);
      if (!dryRun) await request(base, { method: "POST", body: JSON.stringify(desired) });
    } else if (current.color?.toLowerCase() !== desired.color ||
               (current.description || "") !== desired.description ||
               current.name !== desired.name) {
      counts.update++;
      log(`${dryRun ? "[DRY-RUN]" : "[UPDATE]"} ${repo}: ${label.name} (update)`);
      if (!dryRun) await request(base + "/" + encodeURIComponent(current.name), {
        method: "PATCH", body: JSON.stringify(desired),
      });
    } else counts.unchanged++;
  }
  log(`${repo}: ${JSON.stringify(counts)} (dryRun=${dryRun})`);
  return counts;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = !args.has("--apply");
  if (args.has("--apply") && args.has("--dry-run")) throw Error("Select one execution mode");
  const yamlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../labels.yml");
  const labels = parseLabels(await readFile(yamlPath, "utf8"));
  const request = createGitHubClient(process.env.GH_TOKEN);
  const repositories = await listInstallationRepos(request);
  const owner = (process.env.GITHUB_REPOSITORY_OWNER || "REVREBEL").toLowerCase();
  const only = process.env.LABEL_SYNC_REPOSITORY?.trim();
  const selected = repositories.filter(r =>
    r.full_name.toLowerCase().startsWith(owner + "/") &&
    !r.archived && !r.disabled && r.has_issues !== false &&
    (!only || r.full_name.toLowerCase() === only.toLowerCase()));
  if (only && selected.length !== 1) throw Error("Requested repository not accessible in the app installation: " + only);
  if (!selected.length) throw Error("No accessible repositories with Issues enabled");
  console.log(`Synchronizing ${labels.length} canonical labels across ${selected.length} repositories; dry-run=${dryRun}`);
  let failures = 0;
  for (const repo of selected) {
    try { await syncRepository(request, repo.full_name, labels, { dryRun }); }
    catch (error) { failures++; console.error(`${repo.full_name}: ${error.message}`); }
  }
  if (failures) throw Error(`${failures} repositories failed label reconciliation`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
