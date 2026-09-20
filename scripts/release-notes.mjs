// User-facing Release notes come from the curated CHANGELOG section for the
// published version, never from an automatically generated commit or Pull
// Request list. A version without its own non-empty section fails closed so a
// Release can never publish notes that no user can read.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const defaultProductRoot = path.resolve(path.dirname(scriptPath), "..");
export const CHANGELOG_RELATIVE_PATH = "CHANGELOG.md";
export const RELEASE_NOTES_RELATIVE_PATH =
  "output/release-metadata/release-notes.md";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const SECTION_HEADING_PATTERN = /^## /u;

export function changelogSectionHeading(version) {
  assert.match(
    String(version ?? ""),
    VERSION_PATTERN,
    "release notes require a semantic release version",
  );
  return `## [${version}]`;
}

export function extractChangelogNotes(changelog, version) {
  const heading = changelogSectionHeading(version);
  const lines = String(changelog).replace(/\r\n/gu, "\n").split("\n");
  const headingIndexes = lines
    .map((line, index) => (line.startsWith(heading) ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(
    headingIndexes.length > 0,
    `${CHANGELOG_RELATIVE_PATH} has no "${heading}" section; move the Unreleased entries into ${version} before publishing.`,
  );
  assert.equal(
    headingIndexes.length,
    1,
    `${CHANGELOG_RELATIVE_PATH} must describe ${version} in exactly one section.`,
  );
  const [headingIndex] = headingIndexes;
  const bodyLines = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (SECTION_HEADING_PATTERN.test(line)) break;
    bodyLines.push(line);
  }
  const notes = bodyLines.join("\n").replace(/^\n+/u, "").replace(/\s+$/u, "");
  assert.ok(
    notes.length > 0,
    `${CHANGELOG_RELATIVE_PATH} section "${heading}" is empty; describe the user-visible changes before publishing.`,
  );
  return notes;
}

export function composeReleaseNotes({ changelog, version }) {
  const notes = extractChangelogNotes(changelog, version);
  return `${notes}\n`;
}

export async function writeReleaseNotes({
  productRoot = defaultProductRoot,
  version,
  destination = RELEASE_NOTES_RELATIVE_PATH,
} = {}) {
  const [changelog, packageContents] = await Promise.all([
    readFile(path.resolve(productRoot, CHANGELOG_RELATIVE_PATH), "utf8"),
    readFile(path.resolve(productRoot, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageContents);
  const releaseVersion = version || packageJson.version;
  const contents = composeReleaseNotes({
    changelog,
    version: releaseVersion,
  });
  const notesPath = path.resolve(productRoot, destination);
  await mkdir(path.dirname(notesPath), { recursive: true });
  await writeFile(notesPath, contents, { encoding: "utf8", mode: 0o644 });
  return Object.freeze({
    contents,
    destination: notesPath,
    version: releaseVersion,
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== "--version" && flag !== "--out") {
      throw new Error(
        "Usage: node scripts/release-notes.mjs [--version <x.y.z>] [--out <path>]",
      );
    }
    if (!value) throw new Error(`Missing value for ${flag}.`);
    options[flag === "--version" ? "version" : "destination"] = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = await writeReleaseNotes(
      parseArguments(process.argv.slice(2)),
    );
    process.stdout.write(
      `Release notes for ${result.version} written to ${result.destination}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
