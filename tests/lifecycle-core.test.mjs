import assert from "node:assert/strict";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CANONICALIZATION_VERSION,
  MANAGED_META_NAMES,
  atomicWriteFile,
  comparisonSha256,
  findUnexpectedAttemptEntry,
  findUnexpectedAttemptOutputEntry,
  sha256,
} from "../bridge/lifecycle-core.mjs";

test("atomic writes support a 255-byte output filename", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stemmio-atomic-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fileName = `${"x".repeat(250)}.html`;
  assert.equal(Buffer.byteLength(fileName), 255);
  const filePath = join(directory, fileName);

  await atomicWriteFile(filePath, "complete");

  assert.equal(await readFile(filePath, "utf8"), "complete");
});

function fault(code, message = code) {
  return Object.assign(new Error(message), { code });
}

async function atomicWriteFixture(t, name) {
  const directory = await mkdtemp(join(tmpdir(), `stemmio-atomic-${name}-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "document.html");
  await writeFile(filePath, "before", "utf8");
  return { directory, filePath };
}

function instrumentedOperations({
  onOpen,
  onWrite,
  onFileSync,
  onClose,
  onRename,
  onDirectorySync,
  onRemove,
} = {}) {
  return {
    async open(temporary, flags, mode) {
      await onOpen?.(temporary);
      const handle = await open(temporary, flags, mode);
      return {
        async writeFile(content) {
          await onWrite?.(temporary);
          return handle.writeFile(content);
        },
        async sync() {
          await onFileSync?.(temporary);
          return handle.sync();
        },
        async close() {
          if (onClose) return onClose(handle, temporary);
          return handle.close();
        },
      };
    },
    async rename(temporary, filePath) {
      await onRename?.(temporary, filePath);
      return rename(temporary, filePath);
    },
    async syncDirectory(directory) {
      await onDirectorySync?.(directory);
    },
    async rm(temporary, options) {
      await onRemove?.(temporary);
      return rm(temporary, options);
    },
  };
}

async function assertOnlyTargetRemains(directory, expected = "before") {
  assert.deepEqual(await readdir(directory), ["document.html"]);
  assert.equal(await readFile(join(directory, "document.html"), "utf8"), expected);
}

test("atomic writes preserve normal overwrite and consecutive-write behavior", async (t) => {
  const { directory, filePath } = await atomicWriteFixture(t, "normal");

  await atomicWriteFile(filePath, "first");
  await atomicWriteFile(filePath, "second");

  await assertOnlyTargetRemains(directory, "second");
  const createdPath = join(directory, "created.html");
  await atomicWriteFile(createdPath, "created");
  assert.equal(await readFile(createdPath, "utf8"), "created");
});

for (const stage of ["create", "write", "file-sync", "close", "rename"]) {
  test(`atomic write cleans the temporary file after ${stage} failure`, async (t) => {
    const { directory, filePath } = await atomicWriteFixture(t, stage);
    const primary = fault(`PRIMARY_${stage.toUpperCase().replace("-", "_")}`);
    const hooks = {};
    if (stage === "create") hooks.onOpen = async () => { throw primary; };
    if (stage === "write") hooks.onWrite = async () => { throw primary; };
    if (stage === "file-sync") hooks.onFileSync = async () => { throw primary; };
    if (stage === "close") {
      hooks.onClose = async (handle) => {
        await handle.close();
        throw primary;
      };
    }
    if (stage === "rename") hooks.onRename = async () => { throw primary; };

    await assert.rejects(
      atomicWriteFile(filePath, "after", {
        operations: instrumentedOperations(hooks),
      }),
      (error) => {
        assert.equal(error, primary);
        assert.equal(error.atomicWriteOutcome, "not-replaced");
        assert.deepEqual(error.cleanupErrors, []);
        return true;
      },
    );
    await assertOnlyTargetRemains(directory);
  });
}

test("atomic write reports replacement when directory sync fails", async (t) => {
  const { directory, filePath } = await atomicWriteFixture(t, "directory-sync");
  const primary = fault("DIRECTORY_SYNC_FAILED");

  await assert.rejects(
    atomicWriteFile(filePath, "after", {
      operations: instrumentedOperations({
        onDirectorySync: async () => { throw primary; },
      }),
    }),
    (error) => {
      assert.equal(error, primary);
      assert.equal(error.atomicWriteOutcome, "replaced-unconfirmed");
      assert.deepEqual(error.cleanupErrors, []);
      return true;
    },
  );
  await assertOnlyTargetRemains(directory, "after");
});

test("atomic write keeps the primary failure when cleanup also fails", async (t) => {
  const { filePath } = await atomicWriteFixture(t, "cleanup");
  const primary = fault("RENAME_FAILED", "rename failed first");
  const cleanup = fault("CLEANUP_FAILED", "temporary cleanup failed second");
  let temporaryPath = "";

  await assert.rejects(
    atomicWriteFile(filePath, "after", {
      operations: instrumentedOperations({
        onOpen: async (temporary) => { temporaryPath = temporary; },
        onRename: async () => { throw primary; },
        onRemove: async () => { throw cleanup; },
      }),
    }),
    (error) => {
      assert.equal(error, primary);
      assert.equal(error.code, "RENAME_FAILED");
      assert.equal(error.message, "rename failed first");
      assert.equal(error.atomicWriteOutcome, "not-replaced");
      assert.deepEqual(error.cleanupErrors, [cleanup]);
      return true;
    },
  );
  assert.equal(await readFile(filePath, "utf8"), "before");
  assert.equal(await readFile(temporaryPath, "utf8"), "after");
});

function directoryEntry(name, kind = "file") {
  return {
    name,
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}

test("Attempt surfaces ignore only regular Finder metadata", () => {
  assert.equal(
    findUnexpectedAttemptEntry([directoryEntry(".DS_Store")]),
    undefined,
  );
  assert.equal(
    findUnexpectedAttemptOutputEntry([
      directoryEntry("index.html"),
      directoryEntry(".DS_Store"),
    ]),
    undefined,
  );
  assert.equal(
    findUnexpectedAttemptOutputEntry(
      [
        directoryEntry("市场概览-V1.9.html"),
        directoryEntry(".DS_Store"),
      ],
      "市场概览-V1.9.html",
    ),
    undefined,
  );
  assert.equal(
    findUnexpectedAttemptEntry([
      directoryEntry(".DS_Store", "symlink"),
    ])?.name,
    ".DS_Store",
  );
  assert.equal(
    findUnexpectedAttemptEntry([directoryEntry(".hidden")])?.name,
    ".hidden",
  );
  assert.equal(
    findUnexpectedAttemptOutputEntry([
      directoryEntry("index.html"),
      directoryEntry("extra.html"),
    ])?.name,
    "extra.html",
  );
  assert.equal(
    findUnexpectedAttemptOutputEntry(
      [
        directoryEntry("市场概览-V1.9.html"),
        directoryEntry("extra.html"),
      ],
      "市场概览-V1.9.html",
    )?.name,
    "extra.html",
  );
});

const base = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="html-ai-custom-note" content="must-stay">
  <title>指标</title>
</head>
<body><main><h1>指标</h1></main></body>
</html>`;

function withManagedMeta(html, identity) {
  const tags = [
    ["html-ai-document-id", identity.documentId],
    ["html-ai-version-id", identity.versionId],
    ["html-ai-version-label", identity.versionLabel],
    ["html-ai-based-on-version-id", identity.basedOnVersionId],
    ["html-ai-request-id", identity.requestId],
  ].map(([name, value]) => `<meta name="${name}" content="${value}">`).join("");
  return html.replace(/<\/head>/i, `${tags}</head>`);
}

test("canonical comparison ignores only the five exact lifecycle meta tags", () => {
  const stamped = withManagedMeta(base, {
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0009",
    versionLabel: "V9",
    basedOnVersionId: "ver_0008",
    requestId: "req_0009",
  });
  assert.equal(CANONICALIZATION_VERSION, "1");
  assert.equal(MANAGED_META_NAMES.length, 5);
  for (const name of MANAGED_META_NAMES) {
    assert.match(stamped, new RegExp(`name="${name}"`));
  }
  assert.match(stamped, /html-ai-custom-note/);
  assert.equal(comparisonSha256(stamped), comparisonSha256(base));
});

test("ordinary whitespace, CSS and body changes remain meaningful", () => {
  assert.notEqual(comparisonSha256(base), comparisonSha256(base.replace("<h1>", "<h1> ")));
  assert.notEqual(
    comparisonSha256(base),
    comparisonSha256(base.replace("</head>", "<style>h1{color:red}</style></head>")),
  );
  assert.notEqual(
    comparisonSha256(base),
    comparisonSha256(base.replace("指标</h1>", "核心指标</h1>")),
  );
});

test("canonical comparison ignores tag-shaped strings in scripts and comments", () => {
  const tricky = base.replace(
    "<title>指标</title>",
    `<script>
const fakeMeta = '<meta name="html-ai-version-id" content="ver_9999">';
const fakeHead = "</head>";
</script>
<!-- <meta name="html-ai-request-id" content="req_9999"> -->
<title>指标</title>`,
  );
  const stamped = tricky.replace(
    "<title>指标</title>",
    '<title>指标</title><meta name="html-ai-version-id" content="ver_0008">',
  );
  assert.equal(comparisonSha256(stamped), comparisonSha256(tricky));
  assert.match(tricky, /fakeMeta = '<meta name="html-ai-version-id"/);
  assert.match(tricky, /<!-- <meta name="html-ai-request-id"/);
  assert.match(sha256(tricky), /^sha256:[a-f0-9]{64}$/);
});

test("template and script metadata do not collapse canonical comparison", () => {
  const withTemplates = base.replace(
    "</body>",
    `<template id="identity-fragment">
  <meta name="html-ai-version-label" content="V8">
</template>
<script>const template = \`<meta name="html-ai-version-label" content="V7">\`;</script>
</body>`,
  );
  assert.match(withTemplates, /<template id="identity-fragment">/);
  assert.match(withTemplates, /content="V7"/);
  assert.notEqual(comparisonSha256(withTemplates), comparisonSha256(base));
});
