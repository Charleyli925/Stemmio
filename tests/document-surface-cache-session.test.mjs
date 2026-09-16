import assert from "node:assert/strict";
import test from "node:test";

import {
  documentSurfaceCacheEntryMatchesToken,
  documentSurfaceCacheToken,
  DocumentSurfaceCacheSession,
  sameDocumentSurfaceCacheToken,
} from "../app/application/document-surface-cache-session.js";

const hash = (digit) => `sha256:${String(digit).slice(-1).repeat(64)}`;

function capture(session, id, html = `<p>${id}</p>`) {
  return session.capture({
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
      persistedSourceSha256: hash(id),
      editRevision: 2,
      lastPersistedRevision: 2,
      persistState: "idle",
      hasPendingWrite: false,
      isFlushing: false,
      canvasAuthority: { status: "verified", renderedSha256: hash(id) },
    },
  });
}

test("cache readiness is fenced by the exact hot tab and source token", () => {
  const token = documentSurfaceCacheToken({ tabId: "tab_a", sourceSha256: hash("a") });
  const same = documentSurfaceCacheToken({ tabId: "tab_a", sourceSha256: hash("a") });
  const changed = documentSurfaceCacheToken({ tabId: "tab_a", sourceSha256: hash("b") });
  const entry = {
    tabId: "tab_a",
    sourceSha256: hash("a"),
    tier: "hot",
  };
  assert.equal(Object.isFrozen(token), true);
  assert.equal(sameDocumentSurfaceCacheToken(token, same), true);
  assert.equal(sameDocumentSurfaceCacheToken(token, changed), false);
  assert.equal(documentSurfaceCacheEntryMatchesToken(entry, token), true);
  assert.equal(documentSurfaceCacheEntryMatchesToken({ ...entry, tier: "warm" }, token), false);
  assert.equal(documentSurfaceCacheEntryMatchesToken({ ...entry, sourceSha256: hash("b") }, token), false);
});

test("surface cache admits only exact persisted and Canvas-verified projections", () => {
  const session = new DocumentSurfaceCacheSession();
  const admitted = capture(session, "a");
  assert.equal(admitted?.tier, "hot");
  assert.equal(Object.isFrozen(admitted), true);

  const rejected = session.capture({
    tab: { tabId: "document:project_b:doc_b", kind: "document", projectId: "project_b", documentId: "doc_b" },
    project: { projectId: "project_b", documentId: "doc_b", sourcePath: "/tmp/b.html" },
    document: {
      html: "<p>dirty</p>",
      sourceSha256: hash("b"),
      editRevision: 2,
      lastPersistedRevision: 1,
      persistState: "idle",
      canvasAuthority: { status: "verified", renderedSha256: hash("b") },
    },
  });
  assert.equal(rejected, null);
  assert.equal(session.snapshot.entries.length, 1);
});

test("surface cache honors an explicit three-entry hot override and byte-bounded warm LRU entries", () => {
  const session = new DocumentSurfaceCacheSession({
    maxHotEntries: 3,
    maxWarmEntries: 5,
    maxBytes: 10_000,
  });
  ["a", "b", "c", "d"].forEach((id) => capture(session, id));
  assert.deepEqual(session.snapshot.hotTabIds, [
    "document:project_d:doc_d",
    "document:project_c:doc_c",
    "document:project_b:doc_b",
  ]);
  assert.equal(
    session.snapshot.entries.find((entry) => entry.tabId.endsWith("doc_a"))?.tier,
    "warm",
  );

  session.touch("document:project_a:doc_a");
  assert.equal(session.snapshot.hotTabIds[0], "document:project_a:doc_a");
  assert.equal(session.snapshot.entries.at(-1).tabId, "document:project_a:doc_a");
  const presented = session.updatePresentation("document:project_a:doc_a", {
    canvasMode: "preview",
    pageViewContext: { documentKey: "project_a:doc_a", panel: "details" },
    scrollTop: 420,
  });
  assert.equal(presented.canvasMode, "preview");
  assert.equal(presented.scrollTop, 420);
  assert.equal(presented.pageViewContext.panel, "details");
  assert.equal(Object.isFrozen(presented.pageViewContext), true);
  const scrolled = session.updatePresentation("document:project_a:doc_a", {
    scrollTop: 840,
  });
  assert.equal(scrolled.canvasMode, "preview");
  assert.equal(scrolled.pageViewContext.panel, "details");
  assert.equal(scrolled.scrollTop, 840);
  const recaptured = capture(session, "a");
  assert.equal(recaptured.canvasMode, "preview");
  assert.equal(recaptured.pageViewContext.panel, "details");
  assert.equal(recaptured.scrollTop, 840);
  assert.deepEqual(session.snapshot.warmTabIds, ["document:project_b:doc_b"]);
  assert.deepEqual(session.snapshot.coldTabIds, []);
  assert.deepEqual(session.snapshot.limits, {
    maxHotEntries: 3,
    maxEntries: 5,
    maxBytes: 10_000,
  });
});

test("surface cache eviction makes old tabs cold without changing tab identity", () => {
  const session = new DocumentSurfaceCacheSession({
    maxHotEntries: 2,
    maxWarmEntries: 2,
    maxBytes: 2_000,
  });
  capture(session, "a", "a".repeat(200));
  capture(session, "b", "b".repeat(200));
  capture(session, "c", "c".repeat(200));
  assert.deepEqual(
    session.snapshot.entries.map((entry) => entry.tabId),
    ["document:project_b:doc_b", "document:project_c:doc_c"],
  );
  session.reconcile(["document:project_c:doc_c"]);
  assert.deepEqual(session.snapshot.entries.map((entry) => entry.tabId), [
    "document:project_c:doc_c",
  ]);
});

test("surface cache reports evicted document identities as cold under the default 20-tab budget", () => {
  const session = new DocumentSurfaceCacheSession();
  const tabIds = Array.from({ length: 21 }, (_, index) => (
    `document:project_${index}:doc_${index}`
  ));
  session.reconcile(tabIds);
  for (let index = 0; index < 21; index += 1) capture(session, String(index));

  assert.equal(session.snapshot.hotTabIds.length, 5);
  assert.equal(session.snapshot.warmTabIds.length, 15);
  assert.deepEqual(session.snapshot.coldTabIds, ["document:project_0:doc_0"]);
  assert.deepEqual(session.snapshot.limits, {
    maxHotEntries: 5,
    maxEntries: 20,
    maxBytes: 32 * 1024 * 1024,
  });
});
