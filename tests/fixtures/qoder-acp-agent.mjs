#!/usr/bin/env node

import { Readable, Writable } from "node:stream";
import { existsSync, writeFileSync } from "node:fs";

import * as acp from "@agentclientprotocol/sdk";

if (process.argv.includes("--version")) {
  process.stdout.write("1.1.27\n");
  process.exit(0);
}

if (process.argv.includes("--list-models")) {
  if (process.argv.includes("--auth-required")) {
    process.stderr.write("Not logged in. Login required.\n");
    process.exit(1);
  }
  if (process.argv.includes("--capacity-unavailable")) {
    process.stderr.write("No available model capacity.\n");
    process.exit(1);
  }
  process.stdout.write("MODEL\nStemmio-E2E\n");
  process.exit(0);
}

if (!process.argv.includes("--acp")) {
  process.stderr.write("Unsupported synthetic Qoder command.\n");
  process.exit(2);
}

const pidFileArgument = process.argv.find((argument) => argument.startsWith("--pid-file="));
if (pidFileArgument) {
  writeFileSync(pidFileArgument.slice("--pid-file=".length), `${process.pid}\n`, "utf8");
}
const hang = process.argv.includes("--hang");
const runtimeFailure = process.argv.includes("--runtime-failure");
const visibleText = process.argv.includes("--visible-text");
const visibleTextLong = process.argv.includes("--visible-text-long");
const visibleTextGateArgument = process.argv.find((argument) => argument.startsWith("--visible-text-gate-ms="));
const visibleTextGateMs = Math.max(
  0,
  Math.min(5_000, Number.parseInt(visibleTextGateArgument?.slice("--visible-text-gate-ms=".length) || "0", 10) || 0),
);

const visibleTextStartGateFile = process.argv
  .find((argument) => argument.startsWith("--visible-text-start-gate="))
  ?.slice("--visible-text-start-gate=".length);

const sessionId = "session_stemmio_e2e_qoder";
let requestRoot = "";

function promptText(params) {
  return (params.prompt || [])
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text || ""))
    .join("\n");
}

function finalizerRequest(params) {
  const line = promptText(params)
    .split(/\r?\n/u)
    .find((value) => value.trim().startsWith("{\"command\""));
  if (!line) throw new Error("Stemmio finalizer request is missing");
  return JSON.parse(line);
}

const app = acp.agent({ name: "stemmio-e2e-qoder" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    authMethods: [],
    agentInfo: {
      name: "stemmio-e2e-qoder",
      title: "Stemmio E2E Qoder",
      version: "1.1.27",
    },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    requestRoot = params.cwd;
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (hang) return new Promise(() => {});
    if (runtimeFailure) {
      throw new Error("Synthetic ACP runtime connection interrupted.");
    }
    if (visibleText) {
      if (visibleTextStartGateFile) {
        const deadline = Date.now() + 60_000;
        while (!existsSync(visibleTextStartGateFile)) {
          if (Date.now() >= deadline) throw new Error("Synthetic public text start was not released");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      const publicTexts = visibleTextLong
        ? Array.from({ length: 18 }, (_, index) => {
          const marker = `长公开说明 ${index + 1}/18`;
          const tail = index === 17
            ? "最终公开段落：结果仍需 Stemmio 校验。"
            : "本段仍在执行，下一段公开说明随后到达。";
          return `${marker}：${"公开内容保持稳定并沿用同一条 Agent 消息容器。".repeat(8)}\n\n${tail}`;
        })
        : ["正在读取冻结任务。", "正在写入 Candidate。", "正在等待校验。"];
      for (const text of publicTexts) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });
        if (visibleTextGateMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, visibleTextGateMs));
        }
      }
    }
    const changeRequest = await client.request(acp.methods.client.fs.readTextFile, {
      sessionId,
      path: `${requestRoot}/change-request.json`,
    });
    const authority = JSON.parse(changeRequest.content);
    const input = await client.request(acp.methods.client.fs.readTextFile, {
      sessionId,
      path: `${requestRoot}/input/base/index.html`,
    });
    const outputPath = `${requestRoot}/attempts/${authority.attemptId}/output/candidate.html`;
    const candidate = input.content
      .replace(
        /<body([^>]*)>/iu,
        '<body$1 data-stemmio-qoder-acp="e2e">',
      )
      .replace(
        /(<h1\b[^>]*>)\u771f\u5b9e /iu,
        "$1Qoder \u5df2\u66f4\u65b0\uff1a\u771f\u5b9e ",
      );
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool_stemmio_e2e",
        title: "Build Stemmio Candidate",
        kind: "edit",
        status: "in_progress",
        locations: [{ path: outputPath }],
      },
    });
    await client.request(acp.methods.client.fs.writeTextFile, {
      sessionId,
      path: outputPath,
      content: candidate,
    });
    const finalizer = finalizerRequest(params);
    const terminal = await client.request(acp.methods.client.terminal.create, {
      sessionId,
      ...finalizer,
      outputByteLimit: 8 * 1024,
    });
    const status = await client.request(acp.methods.client.terminal.waitForExit, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (status.exitCode !== 0 || status.signal) {
      throw new Error("Stemmio finalizer failed");
    }
    await client.request(acp.methods.client.terminal.release, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    return { stopReason: "end_turn" };
  });

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
