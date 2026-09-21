import { createCodexClientToolsAgent } from "./codex-client-tools.mjs";
import {
  access,
  constants as fsConstants,
  lstat,
  realpath,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import { assertAbsolutePath } from "../policies/execution-policy.mjs";
import { terminateManagedProcess } from "../hosts/execution-host.mjs";
import {
  AcpFrameGuard,
  acpPolicyError,
  acpProcessEnvironment,
  probeAcpSession,
  runAcpTask,
  truncateUtf8Tail,
} from "./acp-protocol.mjs";
import {
  openVerifiedAgentExecutable,
  prepareVerifiedJavaScriptExecution,
} from "./acp-verified-javascript.mjs";

const PROCESS_PROTOCOL_DRAIN_MS = 250;
const processClosePromises = new WeakMap();

function terminalExitStatus(child) {
  if (child.exitCode === null && child.signalCode === null) return null;
  return {
    exitCode: child.exitCode,
    signal: child.signalCode,
  };
}

async function waitForExit(child) {
  const existing = processClosePromises.get(child);
  if (existing) return existing;
  const terminal = terminalExitStatus(child);
  if (terminal) return terminal;
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const handleClose = () => {
      cleanup();
      resolve(terminalExitStatus(child));
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("close", handleClose);
    child.once("error", handleError);
  });
  processClosePromises.set(child, promise);
  return promise;
}

async function spawnAcpChild({
  command,
  args,
  cwd,
  environment,
  baseEnvironment,
  expectedExecutable,
  useVerifiedJavaScriptRuntime,
}) {
  const requestedExecutable = assertAbsolutePath(command, "ACP command");
  const executable = await realpath(requestedExecutable).catch(() => {
    throw acpPolicyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is unavailable.");
  });
  const executableInformation = await lstat(executable);
  if (!executableInformation.isFile() || executableInformation.isSymbolicLink()) {
    throw acpPolicyError(
      "ACP_AGENT_EXECUTABLE_INVALID",
      "The ACP Agent executable must resolve to a regular file.",
    );
  }
  await access(executable, fsConstants.X_OK).catch(() => {
    throw acpPolicyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is not executable.");
  });
  const processGroup = process.platform !== "win32";
  if (useVerifiedJavaScriptRuntime) {
    if (!expectedExecutable) {
      throw acpPolicyError(
        "ACP_AGENT_EXECUTABLE_INVALID",
        "Verified JavaScript execution requires preflight executable identity.",
      );
    }
    const prepared = await prepareVerifiedJavaScriptExecution({
      command: executable,
      expectedExecutable,
      environment,
      baseEnvironment,
    });
    const child = await prepared.spawn({
      args,
      cwd,
      detached: processGroup,
      stdin: "pipe",
    });
    return { child, processGroup };
  }
  const executableHandle = expectedExecutable
    ? await openVerifiedAgentExecutable(executable, expectedExecutable)
    : null;
  const childEnvironment = acpProcessEnvironment(environment, baseEnvironment);
  try {
    const child = spawn(executable, [...args], {
      cwd,
      env: childEnvironment,
      detached: processGroup,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { child, processGroup };
  } finally {
    await executableHandle?.close().catch(() => {});
  }
}

export async function runAcpProcessTask({
  command,
  args = ["--acp"],
  policy,
  prompt,
  environment = {},
  onEvent = () => {},
  startupTimeoutMs,
  inactivityTimeoutMs,
  turnTimeoutMs,
  cancellationSignal,
  expectedAgentName,
  sessionModelId,
  codexClientTools = false,
  expectedExecutable,
  useVerifiedJavaScriptRuntime = false,
  baseEnvironment = process.env,
  createHost,
  stderrFieldPrefix = "agent",
  clock = Date,
  scheduler,
} = {}) {
  if (cancellationSignal?.aborted) {
    throw acpPolicyError("ACP_CANCELLED", "The Stemmio ACP task was cancelled.");
  }
  const { child, processGroup } = await spawnAcpChild({
    command,
    args,
    cwd: policy.requestRoot,
    environment,
    baseEnvironment,
    expectedExecutable,
    useVerifiedJavaScriptRuntime,
  });
  const childExitPromise = waitForExit(child);
  void childExitPromise.catch(() => {});
  let turnStopObserved = false;
  const earlyExitPromise = childExitPromise.then(
    async (status) => {
      // A clean exit closes stdout only after Node has handed its buffered bytes
      // to the stream. Let the protocol reader consume those bytes instead of
      // racing it with an arbitrary wall-clock drain window. If the clean exit
      // happened before a valid stop, runAcpTask will reject on the closed
      // connection and the catch below will preserve ACP_AGENT_EXITED_EARLY.
      if (status?.exitCode === 0 && status.signal === null) return new Promise(() => {});
      await new Promise((resolve) => setTimeout(resolve, PROCESS_PROTOCOL_DRAIN_MS));
      if (turnStopObserved) return new Promise(() => {});
      throw acpPolicyError(
        "ACP_AGENT_EXITED_EARLY",
        "The ACP Agent process exited before the task completed.",
        { status },
      );
    },
    (cause) => {
      const error = acpPolicyError(
        "ACP_AGENT_PROCESS_ERROR",
        "The ACP Agent process could not be started or observed.",
      );
      error.cause = cause;
      throw error;
    },
  );
  void earlyExitPromise.catch(() => {});
  const stderr = { value: "", truncated: false };
  child.stdin?.on("error", () => {});
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    const next = truncateUtf8Tail(stderr.value + chunk, 16 * 1024);
    stderr.value = next.value;
    stderr.truncated ||= next.truncated;
  });
  const guardedStdout = child.stdout.pipe(new AcpFrameGuard());
  const codexAdapter = codexClientTools ? createCodexClientToolsAgent({ readable: guardedStdout, writable: child.stdin, policy }) : null;
  const stream = codexAdapter ? codexAdapter.agent : acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(guardedStdout),
  );
  try {
    const observeEvent = (event) => {
      if (event?.kind === "turn-stopping") turnStopObserved = true;
      if (event?.kind === "identity-repair-started") turnStopObserved = false;
      onEvent(event);
    };
    const result = await Promise.race([
      runAcpTask({
        connection: stream,
        policy,
        prompt,
        onEvent: observeEvent,
        cancellationSignal,
        expectedAgentName,
        sessionModelId,
        ...(inactivityTimeoutMs ? { inactivityTimeoutMs } : {}),
        ...(createHost ? { createHost } : {}),
        ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
        clock,
        scheduler,
      }),
      earlyExitPromise,
    ]);
    return {
      ...result,
      stderr: stderr.value,
      stderrTruncated: stderr.truncated,
    };
  } catch (cause) {
    let failure = cause;
    if (String(cause?.message || cause) === "ACP connection closed") {
      const status = await Promise.race([
        childExitPromise.then(
          (value) => value,
          () => null,
        ),
        new Promise((resolve) => setTimeout(resolve, 50, null)),
      ]);
      if (status) {
        failure = acpPolicyError(
          "ACP_AGENT_EXITED_EARLY",
          "The ACP Agent process exited before the task completed.",
          { status },
        );
      }
    }
    const error = failure instanceof Error ? failure : new Error(String(failure));
    error[`${stderrFieldPrefix}Stderr`] = stderr.value;
    error[`${stderrFieldPrefix}StderrTruncated`] = stderr.truncated;
    throw error;
  } finally {
    codexAdapter?.close();
    child.stdin?.end();
    if (!(await terminateManagedProcess(child, { processGroup }))) {
      throw acpPolicyError(
        "ACP_PROCESS_CLEANUP_UNCONFIRMED",
        "The ACP Agent process group could not be confirmed stopped.",
      );
    }
  }
}

export async function probeAcpProcess({
  command,
  args = ["--acp"],
  cwd,
  environment = {},
  baseEnvironment = process.env,
  expectedAgentName,
  expectedExecutable,
  useVerifiedJavaScriptRuntime = false,
  startupTimeoutMs,
  cancellationSignal,
  stderrFieldPrefix = "agent",
  clock = Date,
  scheduler,
} = {}) {
  if (cancellationSignal?.aborted) {
    throw acpPolicyError("ACP_CANCELLED", "The Stemmio ACP probe was cancelled.");
  }
  const probeCwd = assertAbsolutePath(cwd, "ACP probe cwd");
  const { child, processGroup } = await spawnAcpChild({
    command,
    args,
    cwd: probeCwd,
    environment,
    baseEnvironment,
    expectedExecutable,
    useVerifiedJavaScriptRuntime,
  });
  const childExitPromise = waitForExit(child);
  void childExitPromise.catch(() => {});
  const earlyExitPromise = childExitPromise.then(
    async (status) => {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_PROTOCOL_DRAIN_MS));
      throw acpPolicyError(
        "ACP_AGENT_EXITED_EARLY",
        "The ACP Agent process exited before the probe completed.",
        { status },
      );
    },
    (cause) => {
      const error = acpPolicyError(
        "ACP_AGENT_PROCESS_ERROR",
        "The ACP Agent process could not be started or observed.",
      );
      error.cause = cause;
      throw error;
    },
  );
  void earlyExitPromise.catch(() => {});
  const stderr = { value: "", truncated: false };
  child.stdin?.on("error", () => {});
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    const next = truncateUtf8Tail(stderr.value + chunk, 16 * 1024);
    stderr.value = next.value;
    stderr.truncated ||= next.truncated;
  });
  const guardedStdout = child.stdout.pipe(new AcpFrameGuard());
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(guardedStdout),
  );
  try {
    const result = await Promise.race([
      probeAcpSession({
        connection: stream,
        cwd: probeCwd,
        expectedAgentName,
        cancellationSignal,
        ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
        clock,
        scheduler,
      }),
      earlyExitPromise,
    ]);
    return Object.freeze({
      ...result,
      stderr: stderr.value,
      stderrTruncated: stderr.truncated,
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    error[`${stderrFieldPrefix}Stderr`] = stderr.value;
    error[`${stderrFieldPrefix}StderrTruncated`] = stderr.truncated;
    throw error;
  } finally {
    child.stdin?.end();
    if (!(await terminateManagedProcess(child, { processGroup }))) {
      throw acpPolicyError(
        "ACP_PROCESS_CLEANUP_UNCONFIRMED",
        "The ACP Agent process group could not be confirmed stopped.",
      );
    }
  }
}
