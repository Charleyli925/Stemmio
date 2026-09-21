import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELEASE_NOTES_RELATIVE_PATH,
  composeReleaseNotes,
  extractChangelogNotes,
  writeReleaseNotes,
} from "../scripts/release-notes.mjs";

const productRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CHANGELOG = [
  "# Changelog",
  "",
  "Notable user-visible changes are documented here.",
  "",
  "## [Unreleased]",
  "",
  "- 还没有发布的改动。",
  "",
  "## [1.2.3] - 2026-08-19",
  "",
  "- 打开外部 HTML 不再把成功的导入报成失败。",
  "",
  "### 已知限制",
  "",
  "- 仅 Apple silicon 安装包。",
  "",
  "## [1.2.2] - 2026-08-11",
  "",
  "- 更早的一条改动。",
].join("\n");

test("release notes are the exact CHANGELOG section for that version", () => {
  assert.equal(
    extractChangelogNotes(CHANGELOG, "1.2.3"),
    [
      "- 打开外部 HTML 不再把成功的导入报成失败。",
      "",
      "### 已知限制",
      "",
      "- 仅 Apple silicon 安装包。",
    ].join("\n"),
  );
  assert.equal(
    extractChangelogNotes(CHANGELOG, "1.2.2"),
    "- 更早的一条改动。",
  );
});

test("a Windows checkout produces the same notes as a Unix checkout", () => {
  assert.equal(
    extractChangelogNotes(CHANGELOG.replace(/\n/gu, "\r\n"), "1.2.2"),
    extractChangelogNotes(CHANGELOG, "1.2.2"),
  );
});

test("a version without its own section refuses to publish", () => {
  assert.throws(
    () => extractChangelogNotes(CHANGELOG, "1.2.4"),
    /has no "## \[1\.2\.4\]" section/u,
  );
});

test("an empty section refuses to publish instead of shipping blank notes", () => {
  const changelog = [
    "## [1.2.3] - 2026-08-19",
    "",
    "   ",
    "",
    "## [1.2.2] - 2026-08-11",
    "",
    "- 更早的一条改动。",
  ].join("\n");
  assert.throws(
    () => extractChangelogNotes(changelog, "1.2.3"),
    /is empty; describe the user-visible changes/u,
  );
});

test("duplicated or unpublishable version headings fail closed", () => {
  const duplicated = [CHANGELOG, "", "## [1.2.3] - 2026-08-20", "", "- 重复小节。"]
    .join("\n");
  assert.throws(
    () => extractChangelogNotes(duplicated, "1.2.3"),
    /exactly one section/u,
  );
  for (const version of ["Unreleased", "1.2", "v1.2.3", "", null]) {
    assert.throws(
      () => extractChangelogNotes(CHANGELOG, version),
      /semantic release version/u,
    );
  }
});

test("a neighbouring longer version never leaks into the notes", () => {
  const changelog = [
    "## [1.2.30] - 2026-08-19",
    "",
    "- 不属于 1.2.3 的改动。",
    "",
    "## [1.2.3] - 2026-08-18",
    "",
    "- 属于 1.2.3 的改动。",
  ].join("\n");
  assert.equal(extractChangelogNotes(changelog, "1.2.3"), "- 属于 1.2.3 的改动。");
});

test("published notes contain only the reviewed changelog section", () => {
  assert.equal(
    composeReleaseNotes({ changelog: CHANGELOG, version: "1.2.2" }),
    "- 更早的一条改动。\n",
  );
});

test("the CLI writes notes for the current package version by default", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stemmio-release-notes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeReleaseNotes({ productRoot, destination: path.join(directory, "notes.md") });
  const written = await readFile(path.join(directory, "notes.md"), "utf8");
  const { version } = JSON.parse(
    await readFile(path.join(productRoot, "package.json"), "utf8"),
  );
  assert.match(written, /^- /mu);
  assert.doesNotMatch(
    written,
    /https:\/\/github\.com\/Charleyli925\/Stemmio(?:-Releases)?\/blob/u,
  );
  assert.equal(written.endsWith("\n"), true);
  assert.equal(RELEASE_NOTES_RELATIVE_PATH, "output/release-metadata/release-notes.md");
});

test("the shipped version keeps publishable notes in the repository CHANGELOG", async () => {
  const [changelog, packageContents] = await Promise.all([
    readFile(path.join(productRoot, "CHANGELOG.md"), "utf8"),
    readFile(path.join(productRoot, "package.json"), "utf8"),
  ]);
  const { version } = JSON.parse(packageContents);
  assert.ok(extractChangelogNotes(changelog, version).length > 0);
});
