import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  atomicWriteRecoveryJournalFile,
  createRecoveryJournalStore,
} from "../desktop/recovery-journal-store.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;

function removalReceipt(receipt) {
  return {
    projectId: receipt.projectId,
    documentId: receipt.documentId,
    sourcePath: receipt.sourcePath,
    workingCopyId: receipt.workingCopyId,
    revision: receipt.revision,
    recoveryHtmlSha256: receipt.recoveryHtmlSha256,
    expectedJournalSha256: receipt.journalSha256,
  };
}

function checkpoint(overrides = {}) {
  return {
    projectId: "project_0123456789abcdef",
    documentId: "doc_0123456789abcdef",
    sourcePath: "/tmp/report.html",
    workingCopyId: "working_0001",
    expectedSourceSha256: HASH_A,
    revision: 7,
    html: "<!doctype html><html><body>saved locally</body></html>",
    ...overrides,
  };
}

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "stemmio-recovery-journal-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(parent, { recursive: true, force: true });
  });
  const rootPath = path.join(parent, "journals");
  const store = createRecoveryJournalStore({
    rootPath,
    now: () => new Date("2026-09-01T01:02:03.000Z"),
  });
  return { parent, rootPath, store };
}

test("recovery journal atomically commits and reads back exact verified HTML", async (t) => {
  const { rootPath, store } = await fixture(t);
  const committed = await store.commit(checkpoint());

  assert.equal(committed.recoveryHtmlSha256.length, 71);
  assert.equal(committed.journalSha256.length, 71);
  assert.equal(committed.revision, 7);
  assert.equal(committed.byteLength, Buffer.byteLength(checkpoint().html));
  assert.equal("journalPath" in committed, false);

  const recovered = await store.readVerified({
    projectId: committed.projectId,
    documentId: committed.documentId,
    expectedJournalSha256: committed.journalSha256,
  });
  assert.equal(recovered.html, checkpoint().html);
  assert.equal(recovered.recoveryHtmlSha256, committed.recoveryHtmlSha256);

  const names = await (await import("node:fs/promises")).readdir(rootPath);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f0-9]{64}\.json$/u);
  assert.equal(names.some((name) => name.endsWith(".tmp")), false);
});

test("recovery journal rejects the retired 1.0 envelope without rewriting it", async (t) => {
  const { rootPath, store } = await fixture(t);
  await store.commit(checkpoint());
  const [name] = await readdir(rootPath);
  const filePath = path.join(rootPath, name);
  const before = await readFile(filePath, "utf8");
  const envelope = JSON.parse(before);
  envelope.schemaVersion = "1.0.0";
  await writeFile(filePath, JSON.stringify(envelope));
  const retired = await readFile(filePath, "utf8");
  await assert.rejects(
    store.readVerified(checkpoint()),
    (error) => error.code === "RECOVERY_JOURNAL_SCHEMA_UNSUPPORTED",
  );
  assert.equal(await readFile(filePath, "utf8"), retired);
});

test("default journal limits read back JSON-escaped product-valid HTML", async (t) => {
  const { store } = await fixture(t);
  const html = `<!doctype html><html><body>${"\0".repeat(5 * 1024 * 1024)}</body></html>`;
  const committed = await store.commit(checkpoint({ html }));
  const recovered = await store.readVerified(committed);
  assert.equal(recovered.html, html);
  assert.ok(committed.byteLength < Buffer.byteLength(JSON.stringify({ html }), "utf8"));
});

test("journal rejects an oversized serialized envelope before publishing it", async (t) => {
  const { rootPath } = await fixture(t);
  await mkdir(rootPath, { recursive: true });
  const store = createRecoveryJournalStore({ rootPath, maxEntryBytes: 1_024 });
  await assert.rejects(
    store.commit(checkpoint({
      html: `<!doctype html><html><body>${"\0".repeat(512)}</body></html>`,
    })),
    (error) => error.code === "RECOVERY_JOURNAL_ENTRY_TOO_LARGE",
  );
  assert.deepEqual(await readdir(rootPath), []);
});

test("journal atomic writes remove temporary files after write or sync failure", async (t) => {
  const { rootPath } = await fixture(t);
  await mkdir(rootPath, { recursive: true });
  for (const failurePhase of ["write", "sync"]) {
    const destination = path.join(rootPath, `${failurePhase}.json`);
    await assert.rejects(
      atomicWriteRecoveryJournalFile(destination, "journal payload", {
        async openFile(filePath, flags, mode) {
          const handle = await open(filePath, flags, mode);
          return {
            async writeFile(content) {
              await handle.writeFile(content);
              if (failurePhase === "write") throw new Error("injected write failure");
            },
            async sync() {
              if (failurePhase === "sync") throw new Error("injected sync failure");
              await handle.sync();
            },
            close: () => handle.close(),
          };
        },
      }),
      new RegExp(`injected ${failurePhase} failure`, "u"),
    );
    assert.deepEqual(await readdir(rootPath), []);
  }
});

test("recovery journal refuses stale CAS commit and stale removal", async (t) => {
  const { store } = await fixture(t);
  const first = await store.commit(checkpoint());
  const second = await store.commit(checkpoint({
    revision: 8,
    html: "<!doctype html><html><body>newer</body></html>",
    expectedJournalSha256: first.journalSha256,
  }));

  await assert.rejects(
    store.commit(checkpoint({
      revision: 9,
      expectedJournalSha256: first.journalSha256,
    })),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_MISMATCH",
  );
  await assert.rejects(
    store.remove({
      ...removalReceipt(first),
      expectedJournalSha256: first.journalSha256,
    }),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_MISMATCH",
  );
  assert.equal((await store.readVerified({
    projectId: second.projectId,
    documentId: second.documentId,
  })).revision, 8);
  await assert.rejects(
    store.commit(checkpoint({ revision: 7 })),
    (error) => error.code === "RECOVERY_JOURNAL_STALE_REVISION",
  );
  await assert.rejects(
    store.remove({ projectId: second.projectId, documentId: second.documentId }),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_REQUIRED",
  );
});

test("recovery journal upgrades a previously unknown Working Copy only by CAS", async (t) => {
  const { store } = await fixture(t);
  const unbound = await store.commit(checkpoint({ workingCopyId: "" }));
  await assert.rejects(
    store.commit(checkpoint({ workingCopyId: "working_bound" })),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_REQUIRED",
  );
  const bound = await store.commit(checkpoint({
    workingCopyId: "working_bound",
    expectedJournalSha256: unbound.journalSha256,
  }));
  assert.equal(bound.workingCopyId, "working_bound");
  await assert.rejects(
    store.commit(checkpoint({
      revision: 8,
      workingCopyId: "working_other",
      html: "<!doctype html><html><body>other working copy</body></html>",
      expectedJournalSha256: bound.journalSha256,
    })),
    (error) => error.code === "RECOVERY_JOURNAL_IDENTITY_MISMATCH",
  );
});

test("recovery journal rebases a moved source only with the full receipt identity", async (t) => {
  const { store } = await fixture(t);
  const first = await store.commit(checkpoint());
  const moved = await store.rebase({
    projectId: first.projectId,
    documentId: first.documentId,
    previousSourcePath: first.sourcePath,
    sourcePath: "/tmp/moved/report.html",
    workingCopyId: first.workingCopyId,
    revision: first.revision,
    recoveryHtmlSha256: first.recoveryHtmlSha256,
    expectedJournalSha256: first.journalSha256,
  });
  assert.equal(moved.sourcePath, "/tmp/moved/report.html");
  assert.notEqual(moved.journalSha256, first.journalSha256);
  assert.equal((await store.readVerified(first)).html, checkpoint().html);
  await assert.rejects(
    store.rebase({
      projectId: moved.projectId,
      documentId: moved.documentId,
      previousSourcePath: moved.sourcePath,
      sourcePath: "/tmp/other/report.html",
      workingCopyId: "different-working-copy",
      revision: moved.revision,
      recoveryHtmlSha256: moved.recoveryHtmlSha256,
      expectedJournalSha256: moved.journalSha256,
    }),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_MISMATCH",
  );
  assert.deepEqual(await store.remove(removalReceipt(moved)), { removed: true });
});

test("one corrupt recovery entry does not hide other recoverable documents", async (t) => {
  const { rootPath, store } = await fixture(t);
  const valid = await store.commit(checkpoint());
  await writeFile(path.join(rootPath, `${"f".repeat(64)}.json`), "not json");

  const listed = await store.listRecoverable();
  assert.equal(listed.invalidCount, 1);
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].journalSha256, valid.journalSha256);
  assert.equal("html" in listed.entries[0], false);
});

test("recovery journal rejects symlink roots and tampered HTML hashes", async (t) => {
  const unsafe = await fixture(t);
  const realRoot = path.join(unsafe.parent, "real");
  await mkdir(realRoot);
  await symlink(realRoot, unsafe.rootPath);
  await assert.rejects(
    unsafe.store.initialize(),
    (error) => error.code === "RECOVERY_JOURNAL_ROOT_UNSAFE",
  );

  const safe = await fixture(t);
  await safe.store.commit(checkpoint());
  const [name] = await (await import("node:fs/promises")).readdir(safe.rootPath);
  const filePath = path.join(safe.rootPath, name);
  const envelope = JSON.parse(await readFile(filePath, "utf8"));
  envelope.html = "<!doctype html><html><body>tampered</body></html>";
  await writeFile(filePath, JSON.stringify(envelope));
  await assert.rejects(
    safe.store.readVerified(checkpoint()),
    (error) => error.code === "RECOVERY_JOURNAL_HASH_MISMATCH",
  );
});

test("recovery journal serializes one document without blocking another", async (t) => {
  const { store } = await fixture(t);
  const [left, right] = await Promise.all([
    store.commit(checkpoint({ documentId: "doc_1111111111111111" })),
    store.commit(checkpoint({ documentId: "doc_2222222222222222" })),
  ]);
  const listed = await store.listRecoverable();
  assert.equal(listed.entries.length, 2);
  assert.notEqual(left.journalSha256, right.journalSha256);
});

test("recovery journal scan paginates every verified entry within total byte bounds", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "stemmio-recovery-bounded-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(parent, { recursive: true, force: true });
  });
  const rootPath = path.join(parent, "journals");
  const writer = createRecoveryJournalStore({ rootPath });
  await writer.commit(checkpoint({
    documentId: "doc_1111111111111111",
    html: `<!doctype html><html><body>${"a".repeat(2_000)}</body></html>`,
  }));
  await writer.commit(checkpoint({
    documentId: "doc_2222222222222222",
    html: `<!doctype html><html><body>${"b".repeat(2_000)}</body></html>`,
  }));
  const names = (await readdir(rootPath)).sort();
  const sizes = await Promise.all(names.map(async (name) => (
    (await readFile(path.join(rootPath, name))).byteLength
  )));
  const pageBytes = Math.max(...sizes) + 1;
  const store = createRecoveryJournalStore({
    rootPath,
    maxEntryBytes: pageBytes,
    maxTotalBytes: pageBytes,
  });

  const first = await store.listRecoverable();
  assert.equal(first.entries.length, 1);
  assert.equal(first.scannedCount, 1);
  assert.equal(first.truncated, true);
  assert.match(first.nextCursor, /^[a-f0-9]{64}\.json$/u);

  const second = await store.listRecoverable({ cursor: first.nextCursor });
  assert.equal(second.entries.length, 1);
  assert.equal(second.scannedCount, 1);
  assert.equal(second.truncated, false);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    new Set([...first.entries, ...second.entries].map((entry) => entry.documentId)),
    new Set(["doc_1111111111111111", "doc_2222222222222222"]),
  );
});
