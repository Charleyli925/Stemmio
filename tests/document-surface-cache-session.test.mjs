import assert from "node:assert/strict";
import test from "node:test";

import {
  documentSurfaceCacheEntryMatchesToken,
  documentSurfaceCacheToken,
  DocumentSurfaceCacheSession,
  sameDocumentSurfaceCacheToken,
} from "../app/application/document-surface-cache-session.js";

const hash = (digit) => `sha256:${String(digit).slice(-1).repeat(64)}`;

function fixture(id, html = `<p>${id}</p>`, sourceSha256 = hash(id)) {
  return {
    tab: {
      tabId: `document:project_${id}:doc_${id}`,
      kind: "document",
      projectId: `project_${id}`,
      documentId: `doc_${id}`,
    },
    project: {
      projectId: `project_${id}`,
      documentId: `doc_${id}`,
      sourcePath: `/tmp/${id}.html`,
    },
    document: {
      html,
      persistedSourceSha256: sourceSha256,
      editRevision: 2,
      lastPersistedRevision: 2,
      persistState: "idle",
      hasPendingWrite: false,
      isFlushing: false,
      canvasAuthority: { status: "verified", renderedSha256: sourceSha256 },
    },
  };
}

function capture(session, id, html = `<p>${id}</p>`) {
  return session.capture(fixture(id, html));
}

test("cache readiness is fenced by the exact tab and source token", () => {
  const token = documentSurfaceCacheToken({ tabId: "tab_a", sourceSha256: hash("a") });
  const same = documentSurfaceCacheToken({ tabId: "tab_a", sourceSha256: hash("a") });
  const changed = documentSurfaceCacheToken({ tabId: "tab_a", sourceSha256: hash("b") });
  const entry = { tabId: "tab_a", sourceSha256: hash("a") };
  assert.equal(Object.isFrozen(token), true);
  assert.equal(sameDocumentSurfaceCacheToken(token, same), true);
  assert.equal(sameDocumentSurfaceCacheToken(token, changed), false);
  assert.equal(documentSurfaceCacheEntryMatchesToken(entry, token), true);
  assert.equal(documentSurfaceCacheEntryMatchesToken({ ...entry, sourceSha256: hash("b") }, token), false);
});

test("surface cache admits only exact persisted and Canvas-verified projections", () => {
  const session = new DocumentSurfaceCacheSession();
  const admitted = capture(session, "a");
  assert.equal(admitted?.tabId, "document:project_a:doc_a");
  assert.equal(Object.isFrozen(admitted), true);

  const rejected = session.capture({
    tab: { tabId: "document:project_b:doc_b", kind: "document", projectId: "project_b", documentId: "doc_b" },
    project: { projectId: "project_b", documentId: "doc_b", sourcePath: "/tmp/b.html" },
    document: {
      html: "<p>dirty</p>",
      persistedSourceSha256: hash("b"),
      editRevision: 2,
      lastPersistedRevision: 1,
      persistState: "idle",
      canvasAuthority: { status: "verified", renderedSha256: hash("b") },
    },
  });
  assert.equal(rejected, null);
  assert.equal(session.snapshot.entries.length, 1);
});

test("source projections use byte-bounded LRU without mounting tiers", () => {
  const session = new DocumentSurfaceCacheSession({
    maxEntries: 3,
    maxBytes: 10_000,
  });
  ["a", "b", "c", "d"].forEach((id) => capture(session, id));
  assert.deepEqual(session.snapshot.entries.map((entry) => entry.tabId), [
    "document:project_b:doc_b",
    "document:project_c:doc_c",
    "document:project_d:doc_d",
  ]);
  assert.deepEqual(session.snapshot.coldTabIds, ["document:project_a:doc_a"]);

  session.touch("document:project_b:doc_b");
  assert.equal(session.snapshot.entries.at(-1).tabId, "document:project_b:doc_b");
  assert.deepEqual(session.snapshot.limits, {
    maxEntries: 3,
    maxBytes: 10_000,
  });
});

test("light presentation state survives HTML eviction and rejects stale source context", () => {
  const session = new DocumentSurfaceCacheSession({ maxEntries: 1, maxBytes: 10_000 });
  const a = fixture("a");
  session.reconcile([a.tab.tabId]);
  const remembered = session.updatePresentation(a.tab.tabId, {
    canvasMode: "preview",
    pageViewContext: { documentKey: "project_a:doc_a", panel: "details" },
    scrollTop: 420,
  }, {
    projectId: a.tab.projectId,
    documentId: a.tab.documentId,
    sourceSha256: hash("a"),
  });
  assert.equal(remembered.canvasMode, "preview");
  assert.equal(Object.isFrozen(remembered.pageViewContext), true);

  const recaptured = session.capture(a);
  assert.equal(recaptured.canvasMode, "preview");
  assert.equal(recaptured.scrollTop, 420);
  assert.equal(recaptured.pageViewContext.panel, "details");

  capture(session, "b");
  assert.equal(session.snapshot.entries.some((entry) => entry.tabId === a.tab.tabId), false);
  assert.equal(
    session.snapshot.presentations.find((entry) => entry.tabId === a.tab.tabId)?.scrollTop,
    420,
  );

  session.updatePresentation(a.tab.tabId, { scrollTop: 840 }, {
    projectId: a.tab.projectId,
    documentId: a.tab.documentId,
    sourceSha256: hash("a"),
  });
  assert.equal(
    session.snapshot.presentations.find((entry) => entry.tabId === a.tab.tabId)?.scrollTop,
    840,
  );

  const changedSource = fixture("a", "<p>changed</p>", hash("c"));
  const changed = session.capture(changedSource);
  assert.equal(changed.canvasMode, "edit");
  assert.equal(changed.scrollTop, 0);
  assert.equal(changed.pageViewContext, null);
});

test("a delayed display callback cannot relabel old-version scroll as the new source", () => {
  const session = new DocumentSurfaceCacheSession();
  const tabId = fixture("a").tab.tabId;
  capture(session, "a", "<p>first</p>");
  const firstToken = { tabId, sourceSha256: hash("a") };
  assert.equal(
    session.updatePresentationForToken(firstToken, { scrollTop: 420 })?.scrollTop,
    420,
  );

  session.capture(fixture("a", "<p>second</p>", hash("b")));
  assert.equal(
    session.updatePresentationForToken(firstToken, { scrollTop: 840 }),
    null,
  );
  assert.deepEqual(
    session.snapshot.presentations.find((entry) => entry.tabId === tabId),
    {
      tabId,
      projectId: "project_a",
      documentId: "doc_a",
      sourceSha256: hash("b"),
      canvasMode: "edit",
      pageViewContext: null,
      scrollTop: 0,
      byteLength: 0,
    },
  );
});

test("surface cache eviction makes old tabs cold without changing tab identity", () => {
  const session = new DocumentSurfaceCacheSession({
    maxEntries: 2,
    maxBytes: 2_000,
  });
  capture(session, "a", "a".repeat(200));
  capture(session, "b", "b".repeat(200));
  capture(session, "c", "c".repeat(200));
  assert.deepEqual(
    session.snapshot.entries.map((entry) => entry.tabId),
    ["document:project_b:doc_b", "document:project_c:doc_c"],
  );
  assert.deepEqual(session.snapshot.coldTabIds, ["document:project_a:doc_a"]);
  session.reconcile(["document:project_c:doc_c"]);
  assert.deepEqual(session.snapshot.entries.map((entry) => entry.tabId), [
    "document:project_c:doc_c",
  ]);
  assert.deepEqual(session.snapshot.presentations.map((entry) => entry.tabId), [
    "document:project_c:doc_c",
  ]);
});

test("surface cache reports evicted document identities as cold under the default budget", () => {
  const session = new DocumentSurfaceCacheSession();
  const tabIds = Array.from({ length: 21 }, (_, index) => (
    `document:project_${index}:doc_${index}`
  ));
  session.reconcile(tabIds);
  for (let index = 0; index < 21; index += 1) capture(session, String(index));

  assert.equal(session.snapshot.entries.length, 20);
  assert.equal(session.snapshot.presentations.length, 21);
  assert.deepEqual(session.snapshot.coldTabIds, ["document:project_0:doc_0"]);
  assert.deepEqual(session.snapshot.limits, {
    maxEntries: 20,
    maxBytes: 32 * 1024 * 1024,
  });
});
