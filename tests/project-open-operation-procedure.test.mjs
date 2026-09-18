import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  acquireProjectOpenWorkspace,
  inspectProjectOpenProjection,
  normalizeProjectOpenWorkspaceEnvelope,
  verifyProjectOpenCoreSource,
} from "../app/application/project/open-operation-procedure.js";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("open procedure acquires one split workspace under the injected operation identity", async () => {
  const calls = [];
  const core = { projectId: "project_a", content: "<main>A</main>" };
  const supplemental = {
    operationId: "hydration_1",
    snapshotRevision: "revision_1",
    versions: [],
  };
  const result = await acquireProjectOpenWorkspace({
    bridgeClient: {
      async workspace() {
        throw new Error("flat workspace must not be used");
      },
      async workspaceEnvelope(sourcePath, options) {
        calls.push({ sourcePath, options });
        return {
          workspaceEnvelopeVersion: 1,
          operationId: "hydration_1",
          snapshotRevision: "revision_1",
          core,
          supplemental,
          performanceTiming: { workspaceTotalMs: 12 },
        };
      },
    },
    sourcePath: "/tmp/a.html",
    operationId: "hydration_1",
    isCurrent: () => true,
  });

  assert.equal(result.kind, "ready");
  assert.equal(result.envelope.core, core);
  assert.equal(result.envelope.supplemental, supplemental);
  assert.deepEqual(calls, [{
    sourcePath: "/tmp/a.html",
    options: { operationId: "hydration_1" },
  }]);
});

test("open procedure rejects supplemental bytes from another operation", () => {
  assert.throws(() => normalizeProjectOpenWorkspaceEnvelope({
    workspaceEnvelopeVersion: 1,
    operationId: "hydration_1",
    snapshotRevision: "revision_1",
    core: {},
    supplemental: {
      operationId: "hydration_2",
      snapshotRevision: "revision_1",
    },
  }, "hydration_1"), /operation identity/u);
});

test("open procedure returns stale without exposing a completed Bridge result", async () => {
  const result = await acquireProjectOpenWorkspace({
    bridgeClient: {
      async workspace() {
        return { projectId: "project_old" };
      },
    },
    sourcePath: "/tmp/a.html",
    operationId: "hydration_1",
    isCurrent: () => false,
  });
  assert.deepEqual(result, { kind: "stale" });
});

test("core source verification proves content bytes against the workspace hash", async () => {
  const content = "<!doctype html><html><body>A</body></html>";
  const sourceSha256 = sha256(content);
  const verified = await verifyProjectOpenCoreSource({
    core: { content, sourceSha256, lastModifiedAt: "2026-08-27T00:00:00.000Z" },
    hashPort: { sha256: async (value) => sha256(value) },
    expectedSourceSha256: sourceSha256,
  });
  assert.deepEqual(verified, {
    content,
    sourceSha256,
    lastModifiedAt: "2026-08-27T00:00:00.000Z",
  });
});

test("exact opening authority compares the workspace hash with Document authority hashes", async () => {
  const content = "<!doctype html><html><body>Exact</body></html>";
  const contentSha256 = sha256(content);
  let hashCalls = 0;
  const matching = await inspectProjectOpenProjection({
    document: {
      html: content,
      persistedSourceSha256: contentSha256,
      workingHtmlSha256: contentSha256,
      persistState: "idle",
      editRevision: 0,
      lastPersistedRevision: 0,
    },
    hashPort: { sha256: async () => { hashCalls += 1; return contentSha256; } },
    workspaceSha256: contentSha256,
    hasExactOpeningAuthority: true,
  });
  assert.deepEqual(matching, { clean: true, cleanMismatch: false });
  assert.equal(hashCalls, 0);

  const changed = await inspectProjectOpenProjection({
    document: {
      html: content,
      persistedSourceSha256: contentSha256,
      workingHtmlSha256: sha256(`${content} changed`),
      persistState: "idle",
      editRevision: 0,
      lastPersistedRevision: 0,
    },
    hashPort: { sha256: async () => { hashCalls += 1; return contentSha256; } },
    workspaceSha256: contentSha256,
    hasExactOpeningAuthority: true,
  });
  assert.deepEqual(changed, { clean: true, cleanMismatch: true });
  assert.equal(hashCalls, 0);
});
