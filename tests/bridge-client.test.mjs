import assert from "node:assert/strict";
import test from "node:test";

import {
  createBridgeClient,
  createRuntimeBridgeClient,
  isBridgeRequestError,
} from "../app/application/bridge-client.js";

test("runtime Bridge client resolves the preload-published shell connection", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.window = {
      location: { search: "" },
      stemmioRuntime: {
        bridgePort: "",
        bridgeAuthToken: "",
        getBridgeConnection: () => ({
          bridgePort: "43179",
          bridgeAuthToken: "runtime-token",
        }),
      },
    };
    globalThis.fetch = async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify({ projectId: "project_runtime" }), { status: 200 });
    };
    const client = createRuntimeBridgeClient();
    await client.workspace("/tmp/runtime.html");
    assert.match(requests[0].input, /^http:\/\/127\.0\.0\.1:43179\/workspace/u);
    assert.equal(
      new Headers(requests[0].init.headers).get("x-stemmio-bridge-token"),
      "runtime-token",
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test("Bridge client sends replacement proof as an exact structured journal query", async () => {
  const body = { target: { projectId: "project_a" }, journal: { html: "<html>\r\n</html>", journalSha256: "sha256:journal" } };
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "http://127.0.0.1:4317/current-draft/replacement-proof");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), body);
      return new Response(JSON.stringify({ verified: false }), { status: 200 });
    },
  });
  assert.deepEqual(await client.verifyReplacedCurrentDraft(body), { verified: false });
});

test("Bridge client preserves structured conflict details", async () => {
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "DRAFT_REVISION_CONFLICT",
        message: "stale draft",
        details: {
          expectedDraftRevision: 104,
          currentDraftRevision: 106,
        },
      },
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    () => client.saveDraft({
      sourcePath: "/tmp/page.html",
      expectedDraftRevision: 104,
    }),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.code, "DRAFT_REVISION_CONFLICT");
      assert.equal(error.status, 409);
      assert.equal(error.outcome, "rejected");
      assert.deepEqual(error.details, {
        expectedDraftRevision: 104,
        currentDraftRevision: 106,
      });
      return true;
    },
  );
});

test("Bridge client classifies an unacknowledged mutation as unknown", async () => {
  let attempts = 0;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async () => {
      attempts += 1;
      throw new Error("connection reset after write");
    },
  });

  await assert.rejects(
    () => client.saveDraft({
      sourcePath: "/tmp/page.html",
      expectedDraftRevision: 1,
    }),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(attempts, 1, "mutations must not be retried blindly");
});

test("Bridge client treats a server-side mutation failure as an unknown outcome", async () => {
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "INJECTED_FAILPOINT",
        message: "write interrupted after durable state changed",
      },
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    () => client.saveDraft({
      operationId: "draftop_server_failure_0001",
    }),
    (error) => {
      assert.equal(error.outcome, "unknown");
      assert.equal(error.code, "INJECTED_FAILPOINT");
      return true;
    },
  );
});

test("opening project records is a one-shot command, not a read retry", async () => {
  let requests = 0;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("connection reset while opening folder");
    },
  });
  const payload = { sourcePath: "/tmp/page.html" };

  await assert.rejects(
    () => client.openFolder(payload),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(requests, 1, "a command must not be retried blindly");

  await assert.rejects(() => client.openFolder(payload));
  assert.equal(requests, 2, "a later user action may issue a new command");
});

test("managed Working Copy reconcile is a one-shot command", async () => {
  let requests = 0;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      requests += 1;
      assert.equal(String(init?.method || "GET").toUpperCase(), "POST");
      assert.match(String(input), /\/managed-working-copy\/reconcile$/u);
      throw new Error("connection reset after reconcile");
    },
  });

  await assert.rejects(
    () => client.reconcileManagedWorkingCopy({
      operationId: "reconcile_client_operation_01",
      previousSourcePath: "/tmp/page.html",
      projectId: "project_aaaaaaaaaaaaaaaa",
      documentId: "doc_aaaaaaaaaaaaaaaa",
      workingCopyId: "work_ver_0001",
      versionId: "ver_0001",
      expectedSourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reason: "watch",
    }),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(requests, 1);
});


test("Bridge client retries a transient read and attaches authorization", async () => {
  const requests = [];
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    authToken: "test-token",
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { code: "BUSY" } }), {
          status: 503,
        });
      }
      return new Response(JSON.stringify({
        projectId: "proj_1",
        documentId: "doc_1",
      }), { status: 200 });
    },
  });

  const payload = await client.workspace("/tmp/page.html");
  assert.equal(payload.projectId, "proj_1");
  assert.equal(requests.length, 2);
  assert.match(
    requests[0].input,
    /workspace\?sourcePath=%2Ftmp%2Fpage\.html&projectStorageVersion=4\.0\.0$/,
  );
  assert.equal(
    new Headers(requests[0].init.headers).get("x-stemmio-bridge-token"),
    "test-token",
  );
});

test("Bridge client requests a Core/Supplemental workspace with one operation identity", async () => {
  let requestedUrl = null;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async (input) => {
      requestedUrl = new URL(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.workspaceEnvelope("/tmp/page.html", { operationId: "hydration_123" });
  assert.equal(requestedUrl.pathname, "/workspace");
  assert.equal(requestedUrl.searchParams.get("shape"), "core-supplemental");
  assert.equal(requestedUrl.searchParams.get("operationId"), "hydration_123");
});

test("Bridge client exposes the Agent catalog, install and execution routes", async () => {
  const requests = [];
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async (input, init) => {
      requests.push({ url: new URL(String(input)), method: String(init?.method || "GET") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.agentProviders();
  await client.installAgent({ providerId: "qoder" });
  await client.cancelAgentInstall({ providerId: "qoder" });
  await client.loginAgent({ providerId: "qoder" });
  await client.cancelAgentLogin({ providerId: "qoder" });
  await client.logoutAgent({ providerId: "qoder" });
  await client.updateAgentConfiguration({
    providerId: "stemmio",
    apiKey: "sk-test",
    vendorId: "deepseek",
  });
  await client.cancelAgentConfiguration({ providerId: "stemmio", generation: 1 });
  await client.preflightAgent({ selection: {} });
  await client.setAgentSessionCredential({
    providerId: "stemmio",
    apiKey: "sk-test",
    vendorId: "zhipu",
  });
  await client.startAgent({ selection: {} });
  await client.agentStatus("/tmp/page.html", "req_1", "attempt_001");
  await client.cancelAgent({ requestId: "req_1" });
  await client.agentAvailability({
    selection: { providerId: "synthetic", runtimeId: "runtime" },
  });
  await client.agentDiagnose({
    selection: { providerId: "synthetic", runtimeId: "runtime" },
  });
  assert.deepEqual(requests.map(({ url, method }) => [method, url.pathname]), [
    ["GET", "/agent/providers"],
    ["POST", "/agent/install"],
    ["POST", "/agent/install/cancel"],
    ["POST", "/agent/login"],
    ["POST", "/agent/login/cancel"],
    ["POST", "/agent/logout"],
    ["POST", "/agent/configuration"],
    ["POST", "/agent/configuration/cancel"],
    ["POST", "/agent/preflight"],
    ["POST", "/agent/session-credential"],
    ["POST", "/agent/start"],
    ["GET", "/agent/status"],
    ["POST", "/agent/cancel"],
    ["GET", "/agent/availability"],
    ["GET", "/agent/diagnose"],
  ]);
  assert.deepEqual(
    JSON.parse(requests.at(-2).url.searchParams.get("selection")),
    { providerId: "synthetic", runtimeId: "runtime" },
  );
  assert.deepEqual(
    JSON.parse(requests.at(-1).url.searchParams.get("selection")),
    { providerId: "synthetic", runtimeId: "runtime" },
  );
  assert.equal("startDiscussion" in client, false);
  assert.equal("discussionStatus" in client, false);
  assert.equal("cancelDiscussion" in client, false);
});
