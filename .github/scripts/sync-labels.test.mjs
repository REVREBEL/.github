import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseLabels, listInstallationRepos, syncRepository } from "./sync-labels.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("canonical labels YAML parses to unique, validated GitHub labels", () => {
  const labels = parseLabels(readFileSync(path.join(root, "labels.yml"), "utf8"));
  assert.ok(labels.length >= 30);
  assert.ok(labels.some(x => x.name === "agent-location:mac"));
  assert.ok(labels.some(x => x.name === "status: awaiting review"));
  assert.ok(labels.every(x => /^[0-9a-f]{6}$/i.test(x.color)));
  assert.throws(() => parseLabels("- name: 'type: bug'\n  color: invalid\n  description: bad"), /Malformed/);
  assert.throws(() => parseLabels("- name: 'x'\n  color: 123456\n  description: One\n- name: 'X'\n  color: 123456\n  description: Two"), /Duplicate/);
});

test("dry-run reports creates and updates without writing", async () => {
  const calls = [];
  const request = async (route, options = {}) => {
    calls.push([route, options.method || "GET"]);
    if (route.includes("/labels?")) return [{ name: "type: bug", color: "ffffff", description: "old" }];
    throw Error("No writes permitted in dry-run");
  };
  const counts = await syncRepository(request, "REVREBEL/linear-agents", [
    { name: "type: bug", color: "163666", description: "New" },
    { name: "type: feature", color: "047c97", description: "A feature" },
  ], { dryRun: true, log: () => {} });
  assert.deepEqual(counts, { create: 1, update: 1, unchanged: 0 });
  assert.deepEqual(calls.map(x => x[1]), ["GET"]);
});

test("apply updates existing labels, creates missing labels, and never deletes", async () => {
  const calls = [];
  const request = async (route, options = {}) => {
    const method = options.method || "GET";
    calls.push({ route, method, body: options.body && JSON.parse(options.body) });
    if (method === "GET") return [{ name: "type: bug", color: "ffffff", description: "old" }];
    return {};
  };
  await syncRepository(request, "REVREBEL/linear-agents", [
    { name: "type: bug", color: "163666", description: "New" },
    { name: "status: awaiting review", color: "8e456a", description: "Ready" },
  ], { dryRun: false, log: () => {} });
  assert.deepEqual(calls.map(x => x.method), ["GET", "PATCH", "POST"]);
  assert.equal(calls[1].route, "/repos/REVREBEL/linear-agents/labels/type%3A%20bug");
  assert.equal(calls[2].body.name, "status: awaiting review");
});

test("installation repository enumeration handles multiple pages", async () => {
  const pages = [];
  const request = async url => {
    pages.push(url);
    if (url.endsWith("page=1")) return { repositories: Array.from({ length: 100 }, (_, i) => ({ full_name: "REVREBEL/repo" + i })) };
    return { repositories: [{ full_name: "REVREBEL/linear-agents" }] };
  };
  const repos = await listInstallationRepos(request);
  assert.equal(repos.length, 101);
  assert.equal(pages.length, 2);
});
