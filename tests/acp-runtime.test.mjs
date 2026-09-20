import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAcpRuntime } from "../bridge/agent/runtimes/acp-runtime.mjs";
import { runAcpProcessTask } from "../bridge/agent/runtimes/acp-process.mjs";

const runtimeSource = fileURLToPath(new URL("../bridge/agent/runtimes/acp-runtime.mjs", import.meta.url));

test("ACP runtime defaults to the shared process supervisor instead of Qoder symbols", async () => {
  const source = await readFile(runtimeSource, "utf8");
  assert.match(source, /runTask = runAcpProcessTask/u);
  assert.equal(source.includes("runQoderAcpTask"), false);
  assert.equal(source.includes("Qoder"), false);
});

test("ACP runtime can run a protocol task through an injected fake process", async () => {
  const launches = [];
  const runtime = createAcpRuntime({
    runTask: async (launch) => {
      launches.push(launch);
      launch.onEvent({ kind: "visible-text", text: "ready" });
      return Object.freeze({});
    },
  });
  assert.equal(runtime.runtimeId, "acp");
  const events = [];
  const result = await runtime.run({
    securityProfile: "client-mediated",
    command: "/tmp/synthetic-agent",
    onEvent: (event) => events.push(event),
  });
  assert.equal(Object.hasOwn(result, "visibleText"), false);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, "/tmp/synthetic-agent");
  assert.deepEqual(events, [{ kind: "visible-text", text: "ready" }]);
  assert.equal(typeof runAcpProcessTask, "function");
});
