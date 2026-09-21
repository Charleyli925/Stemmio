import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";

import { selectGatePlan, validateImpactMap } from "../scripts/test-gate-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Workflow entry points: the documents, skills and role configs that tell an
// agent how to work in this repository. These checks cover objective contracts:
// local Markdown links and anchors resolve, commands exist, skill metadata uses
// the loader's YAML format, and impact routing selects this test. They do not
// attempt to decide whether free-form prose expresses the right policy.
const ENTRY_DOCUMENTS = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs/ADR_CURATION.md",
  "docs/CODEX_SUBAGENT_ROUTING_WORKSHEET.md",
  "docs/CODEX_WORKFLOW.md",
  "docs/DEVELOPMENT.md",
  "docs/ENGINEERING_STANDARDS.md",
  "docs/GIT_WORKFLOW.md",
  "docs/SIMPLIFICATION_AUDIT.md",
  "tests/TEST_STRATEGY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

const ENTRY_CONFIGS = [
  ".codex/agents/reviewer.toml",
  ".codex/agents/tester.toml",
];

// These are working or generated carriers rather than committed references.
// A Markdown link to one is allowed as a reproduction location but is not
// treated as a repository source link.
const ARTIFACT_PREFIXES = [
  "output/",
  "release/",
  "dist/",
  "dist-desktop/",
  "node_modules/",
  ".next/",
  ".wrangler/",
  ".codex-worktrees/",
];

const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(([^)\n]+)\)/gu;
const NPM_RUN = /\bnpm run ([a-z][a-z0-9:_-]*)/gu;
const PLACEHOLDER = /[<>{}*$]|YYYY|NNNN|\.\.\./u;

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function linkDestination(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/u, 1)[0];
}

function isExternalLink(target) {
  return /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("//");
}

function isArtifactPath(resolved) {
  return ARTIFACT_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

function resolveMarkdownTarget(file, target) {
  if (!target || isExternalLink(target) || PLACEHOLDER.test(target)) return null;
  const hashIndex = target.indexOf("#");
  const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : decoded(target.slice(hashIndex + 1)).toLowerCase();
  const withoutQuery = pathPart.split("?", 1)[0];
  const resolved = withoutQuery === ""
    ? file
    : path.posix.normalize(
      withoutQuery.startsWith("/")
        ? withoutQuery.slice(1)
        : path.posix.join(path.posix.dirname(file), withoutQuery),
    );
  if (isArtifactPath(resolved)) return null;
  return { reference: target, resolved, anchor };
}

export function markdownReferences(source, { file }) {
  const references = [];
  const seen = new Set();
  for (const match of source.matchAll(MARKDOWN_LINK)) {
    const target = linkDestination(match[1]);
    const resolved = resolveMarkdownTarget(file, target);
    if (!resolved) continue;
    const key = [resolved.resolved, resolved.anchor].join("#");
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ file, ...resolved });
  }
  return references;
}

export function headingAnchors(source) {
  const anchors = new Set();
  const counts = new Map();
  for (const match of source.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const base = match[1]
      .trim()
      .toLowerCase()
      .replace(/[`*_~]/gu, "")
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/\s+/gu, "-");
    if (!base) continue;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : base + "-" + count);
  }
  return anchors;
}

export async function unresolvedMarkdownReferences({ source, file, exists, read }) {
  const violations = [];
  for (const reference of markdownReferences(source, { file })) {
    if (!(await exists(reference.resolved))) {
      violations.push({ ...reference, reason: "missing-path" });
      continue;
    }
    if (!reference.anchor) continue;
    const anchors = headingAnchors(await read(reference.resolved));
    if (!anchors.has(reference.anchor)) {
      violations.push({ ...reference, reason: "missing-anchor" });
    }
  }
  return violations;
}

export function npmScriptReferences(source) {
  return [...source.matchAll(NPM_RUN)].map((match) => match[1]);
}

export function missingNpmScripts({ source, scripts }) {
  return [...new Set(npmScriptReferences(source))].filter((name) => !scripts.includes(name));
}

export function skillFrontmatter(source) {
  const block = /^---\n([\s\S]*?)\n---\n/u.exec(source);
  if (!block) return { error: "missing frontmatter", fields: null };
  try {
    const fields = parseYaml(block[1]);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return { error: "frontmatter must be a mapping", fields: null };
    }
    return { error: null, fields };
  } catch {
    return { error: "invalid YAML frontmatter", fields: null };
  }
}

export function skillViolations({ directory, source }) {
  const violations = [];
  const { error, fields } = skillFrontmatter(source);
  if (error) return [directory + ": " + error];
  if (fields.name !== directory) {
    violations.push(directory + ": frontmatter name " + (fields.name || "(empty)"));
  }
  if (typeof fields.description !== "string" || fields.description.trim() === "") {
    violations.push(directory + ": frontmatter description is missing");
  }
  const body = source.replace(/^---\n[\s\S]*?\n---\n/u, "");
  if (!/^#\s+\S/mu.test(body)) violations.push(directory + ": missing skill title");
  return violations;
}

async function readRepositoryFile(relativePath) {
  return readFile(path.join(productRoot, relativePath), "utf8");
}

async function pathExists(relativePath) {
  try {
    await stat(path.join(productRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function skillFiles() {
  const directories = (await readdir(path.join(productRoot, ".agents/skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return directories.map((directory) => ({
    directory,
    file: ".agents/skills/" + directory + "/SKILL.md",
  }));
}

async function pointerSkillFiles() {
  const directories = (await readdir(path.join(productRoot, ".qoder/skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return directories.map((directory) => ".qoder/skills/" + directory + "/SKILL.md");
}

async function workflowEntryFiles() {
  return [
    ...ENTRY_DOCUMENTS,
    ...ENTRY_CONFIGS,
    ...(await skillFiles()).map((skill) => skill.file),
    ...await pointerSkillFiles(),
  ];
}

test("every local Markdown link in a workflow entry point resolves", async () => {
  const violations = [];
  for (const file of await workflowEntryFiles()) {
    violations.push(...await unresolvedMarkdownReferences({
      source: await readRepositoryFile(file),
      file,
      exists: pathExists,
      read: readRepositoryFile,
    }));
  }
  assert.deepEqual(violations, []);
});

test("every npm command named by a workflow entry point exists", async () => {
  const scripts = Object.keys(JSON.parse(await readRepositoryFile("package.json")).scripts || {});
  const missing = [];
  for (const file of await workflowEntryFiles()) {
    for (const name of missingNpmScripts({ source: await readRepositoryFile(file), scripts })) {
      missing.push({ file, script: name });
    }
  }
  assert.deepEqual(missing, []);
});

test("every repository skill declares loader-compatible metadata and a title", async () => {
  const violations = [];
  for (const { directory, file } of await skillFiles()) {
    violations.push(...skillViolations({ directory, source: await readRepositoryFile(file) }));
  }
  assert.deepEqual(violations, []);
});

test("workflow entry points still select this contract", async () => {
  const map = validateImpactMap(JSON.parse(await readRepositoryFile("tests/test-impact-map.json")));
  const unselected = [];
  for (const file of await workflowEntryFiles()) {
    const plan = selectGatePlan({ map, lane: "task", changedFiles: [file] });
    if (!plan.selectedNodeTests.includes("tests/workflow-doc-contract.test.mjs")) {
      unselected.push(file);
    }
  }
  assert.deepEqual(unselected, []);
});

test("link checks reject missing targets and accept equivalent valid links", async () => {
  const files = new Map([
    ["AGENTS.md", "# Guidance\n"],
    ["docs/CODEX_WORKFLOW.md", "## Task lifecycle\n"],
  ]);
  const exists = async (candidate) => files.has(candidate);
  const read = async (candidate) => files.get(candidate);

  assert.deepEqual(
    await unresolvedMarkdownReferences({
      source: "[missing root](MISSING.md)",
      file: "AGENTS.md",
      exists,
      read,
    }),
    [{
      file: "AGENTS.md",
      reference: "MISSING.md",
      resolved: "MISSING.md",
      anchor: "",
      reason: "missing-path",
    }],
  );
  assert.deepEqual(
    await unresolvedMarkdownReferences({
      source: "[misspelled directory](docz/MISSING.md)",
      file: "AGENTS.md",
      exists,
      read,
    }),
    [{
      file: "AGENTS.md",
      reference: "docz/MISSING.md",
      resolved: "docz/MISSING.md",
      anchor: "",
      reason: "missing-path",
    }],
  );
  assert.deepEqual(
    await unresolvedMarkdownReferences({
      source: "[missing section](CODEX_WORKFLOW.md#removed-section)",
      file: "docs/ENTRY.md",
      exists,
      read,
    }),
    [{
      file: "docs/ENTRY.md",
      reference: "CODEX_WORKFLOW.md#removed-section",
      resolved: "docs/CODEX_WORKFLOW.md",
      anchor: "removed-section",
      reason: "missing-anchor",
    }],
  );
  assert.deepEqual(
    await unresolvedMarkdownReferences({
      source: "[workflow](CODEX_WORKFLOW.md#task-lifecycle) and [root](../AGENTS.md)",
      file: "docs/ENTRY.md",
      exists,
      read,
    }),
    [],
  );
  assert.deepEqual(
    markdownReferences(
      "[external](https://example.com) [artifact](../output/report.md) [template](docs/{file}.md)",
      { file: "docs/ENTRY.md" },
    ),
    [],
  );
});

test("skill metadata accepts equivalent YAML forms and rejects broken contracts", () => {
  assert.deepEqual(skillViolations({
    directory: "stemmio-example",
    source: [
      "---",
      "name: \"stemmio-example\"",
      "description: >",
      "  Example description split",
      "  across YAML lines.",
      "---",
      "",
      "# Example",
      "",
    ].join("\n"),
  }), []);
  assert.deepEqual(skillViolations({
    directory: "stemmio-example",
    source: "---\nname: stemmio-other\ndescription: \"\"\n---\n",
  }), [
    "stemmio-example: frontmatter name stemmio-other",
    "stemmio-example: frontmatter description is missing",
    "stemmio-example: missing skill title",
  ]);
  assert.deepEqual(skillViolations({
    directory: "stemmio-example",
    source: "---\nname: [broken\n---\n\n# Example\n",
  }), ["stemmio-example: invalid YAML frontmatter"]);
});

test("command checks accept explanatory prose about a real command", () => {
  assert.deepEqual(
    missingNpmScripts({
      source: "Do not run `npm run gate:task` separately from the owning wrapper.",
      scripts: ["gate:task"],
    }),
    [],
  );
  assert.deepEqual(
    missingNpmScripts({ source: "Run npm run gate:gone.", scripts: ["gate:task"] }),
    ["gate:gone"],
  );
});
