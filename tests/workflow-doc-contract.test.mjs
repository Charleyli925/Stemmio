import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { selectGatePlan, validateImpactMap } from "../scripts/test-gate-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Workflow entry points: the documents, skills and role configs that tell an
// agent how to work in this repository. The checks below only decide what is
// objectively decidable — references resolve, commands exist, skill metadata is
// complete and the routing still selects this contract. They never try to judge
// whether the prose was followed.
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

// Local artifacts and working copies are not repository source references.
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

// Process statements retired by the evidence-driven workflow. They must not
// return to the Pull Request template: the template once required a separate
// gate:task run although task:finish is the single end-of-task entry, asked for
// a weekly roll-up that no longer exists, and claimed that a later commit
// returns the Pull Request to Draft.
const RETIRED_TEMPLATE_PHRASES = [
  { phrase: "npm run gate:task", reason: "task:finish is the single end-of-task entry" },
  { phrase: "weekly roll-up", reason: "review debt has no weekly roll-up" },
  { phrase: "returns this PR to Draft", reason: "a later commit reruns the matrix for the new head" },
];

const CODE_SPAN = /`([^`\n]+)`/gu;
const LINK_TARGET = /\[[^\]\n]*\]\(([^)\s]+)\)/gu;
const NPM_RUN = /\bnpm run ([a-z][a-z0-9:_-]*)/gu;
const SECTION_WORD = /\bsections?\b/iu;
const PLACEHOLDER = /[<>{}*$]|YYYY|NNNN|\.\.\./u;
const PARAGRAPH = /\n{2,}/u;

function isCandidatePath(value, roots) {
  if (!value || /^[a-z][a-z0-9+.-]*:/iu.test(value)) return false;
  if (PLACEHOLDER.test(value)) return false;
  if (!/^[A-Za-z0-9_./@-]+$/u.test(value)) return false;
  const relative = value.replace(/^(?:\.\.?\/)+/u, "");
  if (!relative.includes("/")) return false;
  const [head] = relative.split("/");
  if (!roots.has(head)) return false;
  return !ARTIFACT_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

export function repositoryPathCandidates(source, { roots }) {
  const raw = [
    ...[...source.matchAll(CODE_SPAN)].map((match) => match[1]),
    ...[...source.matchAll(LINK_TARGET)].map((match) => match[1]),
  ];
  const candidates = [];
  const seen = new Set();
  for (const value of raw) {
    const candidate = value.trim().split("#", 1)[0];
    if (seen.has(candidate) || !isCandidatePath(candidate, roots)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

export async function unresolvedReferences({ source, file, roots, exists }) {
  const missing = [];
  for (const candidate of repositoryPathCandidates(source, { roots })) {
    // Only an explicit "./" or "../" prefix is relative to the referencing
    // file; every other reference is written from the repository root.
    const resolved = /^\.\.?\//u.test(candidate)
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), candidate))
      : candidate;
    if (!(await exists(resolved))) missing.push({ file, reference: candidate, resolved });
  }
  return missing;
}

export function npmScriptReferences(source) {
  return [...source.matchAll(NPM_RUN)].map((match) => match[1]);
}

export function missingNpmScripts({ source, scripts }) {
  return [...new Set(npmScriptReferences(source))].filter((name) => !scripts.includes(name));
}

export function skillFrontmatter(source) {
  const block = /^---\n([\s\S]*?)\n---\n/u.exec(source);
  if (!block) return null;
  const fields = {};
  for (const line of block[1].split("\n")) {
    const field = /^([a-z_]+):\s*(.+)$/u.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

export function skillViolations({ directory, source }) {
  const violations = [];
  const fields = skillFrontmatter(source);
  if (!fields) return [`${directory}: missing frontmatter`];
  if (fields.name !== directory) {
    violations.push(`${directory}: frontmatter name ${fields.name || "(empty)"}`);
  }
  if (!fields.description || fields.description.length < 20) {
    violations.push(`${directory}: frontmatter description is missing or too short`);
  }
  const body = source.replace(/^---\n[\s\S]*?\n---\n/u, "");
  if (!/^#\s+\S/mu.test(body)) violations.push(`${directory}: missing skill title`);
  return violations;
}

// A document reference inside prose is a code span ending in ".md". A heading
// list is introduced by the word "section"/"sections" and continues until the
// next document reference.
export function sectionReferences(source) {
  const references = [];
  for (const paragraph of source.split(PARAGRAPH)) {
    let currentDocument = null;
    let expecting = false;
    for (const match of paragraph.matchAll(/`([^`]+)`|([^`]+)/gu)) {
      if (match[1] === undefined) {
        if (SECTION_WORD.test(match[2])) expecting = true;
        continue;
      }
      const value = match[1].trim();
      if (/\.md$/u.test(value) && !value.includes(" ")) {
        currentDocument = value;
        expecting = false;
        continue;
      }
      if (expecting && currentDocument) references.push({ document: currentDocument, heading: value });
    }
  }
  return references;
}

export function hasHeading(source, heading) {
  // A referenced heading may be wrapped across lines by the surrounding prose.
  const escaped = heading
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/ /gu, "\\s+");
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "mu").test(source);
}

export function missingSections({ references, documents }) {
  return references.filter(({ document, heading }) => (
    !documents.get(document) || !hasHeading(documents.get(document), heading)
  ));
}

async function repositoryRoots() {
  return new Set(await readdir(productRoot));
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

// A document reference may be written from the repository root or as a bare
// file name next to a document in docs/.
async function resolveDocumentPath(reference) {
  const candidates = reference.includes("/") ? [reference] : [reference, `docs/${reference}`];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function skillFiles() {
  const directories = (await readdir(path.join(productRoot, ".agents/skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return directories.map((directory) => ({
    directory,
    file: `.agents/skills/${directory}/SKILL.md`,
  }));
}

async function pointerSkillFiles() {
  const directories = (await readdir(path.join(productRoot, ".qoder/skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return directories.map((directory) => `.qoder/skills/${directory}/SKILL.md`);
}

test("every path referenced by a workflow entry point exists", async () => {
  const roots = await repositoryRoots();
  const files = [
    ...ENTRY_DOCUMENTS,
    ...ENTRY_CONFIGS,
    ...(await skillFiles()).map((skill) => skill.file),
    ...await pointerSkillFiles(),
  ];
  const missing = [];
  for (const file of files) {
    missing.push(...await unresolvedReferences({
      source: await readRepositoryFile(file),
      file,
      roots,
      exists: pathExists,
    }));
  }
  assert.deepEqual(missing, []);
});

test("every npm command named by a workflow entry point exists", async () => {
  const scripts = Object.keys(JSON.parse(await readRepositoryFile("package.json")).scripts || {});
  const missing = [];
  const files = [
    ...ENTRY_DOCUMENTS,
    ...ENTRY_CONFIGS,
    ...(await skillFiles()).map((skill) => skill.file),
    ...await pointerSkillFiles(),
  ];
  for (const file of files) {
    for (const name of missingNpmScripts({ source: await readRepositoryFile(file), scripts })) {
      missing.push({ file, script: name });
    }
  }
  assert.deepEqual(missing, []);
});

test("every repository skill declares complete metadata and a title", async () => {
  const violations = [];
  for (const { directory, file } of await skillFiles()) {
    violations.push(...skillViolations({ directory, source: await readRepositoryFile(file) }));
  }
  assert.deepEqual(violations, []);
});

test("every document section named by an entry point exists", async () => {
  const files = ["AGENTS.md", ...(await skillFiles()).map((skill) => skill.file)];
  const references = [];
  for (const file of files) {
    for (const reference of sectionReferences(await readRepositoryFile(file))) {
      references.push({ file, ...reference });
    }
  }
  const documents = new Map();
  for (const { document } of references) {
    if (documents.has(document)) continue;
    documents.set(document, await resolveDocumentPath(document));
  }
  assert.deepEqual(
    references.filter(({ document }) => documents.get(document) === null),
    [],
  );
  const sources = new Map();
  for (const [document, resolved] of documents) {
    if (resolved) sources.set(document, await readRepositoryFile(resolved));
  }
  assert.deepEqual(missingSections({ references, documents: sources }), []);
});

test("the Pull Request template keeps the current completion process", async () => {
  const source = await readRepositoryFile(".github/PULL_REQUEST_TEMPLATE.md");
  const violations = RETIRED_TEMPLATE_PHRASES
    .filter(({ phrase }) => source.includes(phrase))
    .map(({ phrase, reason }) => `${phrase}: ${reason}`);
  assert.deepEqual(violations, []);
});

test("workflow entry points still select this contract", async () => {
  const map = validateImpactMap(JSON.parse(await readRepositoryFile("tests/test-impact-map.json")));
  const files = [
    ...ENTRY_DOCUMENTS,
    ...ENTRY_CONFIGS,
    ...(await skillFiles()).map((skill) => skill.file),
    ...await pointerSkillFiles(),
  ];
  const unselected = [];
  for (const file of files) {
    const plan = selectGatePlan({ map, lane: "task", changedFiles: [file] });
    if (!plan.selectedNodeTests.includes("tests/workflow-doc-contract.test.mjs")) {
      unselected.push(file);
    }
  }
  assert.deepEqual(unselected, []);
});

test("the reference checks reject their own negative cases", async () => {
  const roots = new Set(["docs", "tests", ".agents"]);
  assert.deepEqual(
    repositoryPathCandidates("read `docs/CODEX_WORKFLOW.md` and `tests/workflow-doc-contract.test.mjs`", { roots }),
    ["docs/CODEX_WORKFLOW.md", "tests/workflow-doc-contract.test.mjs"],
  );
  assert.deepEqual(
    repositoryPathCandidates("see `output/report.md`, `origin/main` and `docs/<name>.md`", { roots }),
    [],
  );
  const exists = async (candidate) => candidate === "docs/CODEX_WORKFLOW.md";
  assert.deepEqual(
    await unresolvedReferences({
      source: "read `docs/CODEX_WORKFLOW.md` then `docs/REMOVED.md`",
      file: "AGENTS.md",
      roots,
      exists,
    }),
    [{ file: "AGENTS.md", reference: "docs/REMOVED.md", resolved: "docs/REMOVED.md" }],
  );
  assert.deepEqual(
    missingNpmScripts({ source: "run `npm run gate:edit`", scripts: ["gate:edit"] }),
    [],
  );
  assert.deepEqual(
    missingNpmScripts({ source: "run npm run gate:gone", scripts: ["gate:edit"] }),
    ["gate:gone"],
  );
  assert.deepEqual(skillViolations({
    directory: "stemmio-example",
    source: "---\nname: stemmio-example\ndescription: A complete example skill description.\n---\n\n# Example\n",
  }), []);
  assert.deepEqual(skillViolations({
    directory: "stemmio-example",
    source: "---\nname: stemmio-other\ndescription: short\n---\n",
  }), [
    "stemmio-example: frontmatter name stemmio-other",
    "stemmio-example: frontmatter description is missing or too short",
    "stemmio-example: missing skill title",
  ]);
  const documents = new Map([["docs/CODEX_WORKFLOW.md", "## Task lifecycle\n"]]);
  const references = sectionReferences(
    "Read `docs/CODEX_WORKFLOW.md` sections `Task lifecycle` and `Removed section`.",
  );
  assert.deepEqual(references, [
    { document: "docs/CODEX_WORKFLOW.md", heading: "Task lifecycle" },
    { document: "docs/CODEX_WORKFLOW.md", heading: "Removed section" },
  ]);
  assert.deepEqual(missingSections({ references, documents }), [
    { document: "docs/CODEX_WORKFLOW.md", heading: "Removed section" },
  ]);
});
