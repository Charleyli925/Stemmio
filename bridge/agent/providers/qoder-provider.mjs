import { execFile } from "node:child_process";
import {
  access,
  constants as fsConstants,
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import semver from "semver";

import { sha256 } from "../../lifecycle-core.mjs";
import { loadExecutionPolicy } from "../policies/execution-policy.mjs";
import { acpProcessEnvironment } from "../runtimes/acp-protocol.mjs";
import { runVerifiedJavaScript } from "../runtimes/acp-verified-javascript.mjs";
import {
  AgentProviderError,
  agentProviderError,
  defineAgentProvider,
} from "./agent-provider-contract.mjs";
import {
  runOfficialAgentLogin,
  runOfficialAgentLogout,
  waitForAgentAuthentication,
} from "../catalog/agent-login-command.mjs";
import { describeQoderAuthSource } from "../../../shared/agent-auth-source.mjs";
import { probeAcpProcess } from "../runtimes/acp-process.mjs";

export const QODER_PROVIDER_ID = "qoder";
export const QODER_RUNTIME_ID = "acp";
export const MIN_QODER_VERSION = "1.1.27";

const MAX_PUBLIC_MODELS = 40;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,79}$/u;
const execFileAsync = promisify(execFile);

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

export function cleanProviderText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maxLength);
}

export function parsePublicModels(stdout) {
  const seen = new Set();
  const models = [];
  for (const rawLine of String(stdout || "").split(/\r?\n/u)) {
    const line = cleanProviderText(rawLine, 80);
    if (!line || line.toUpperCase() === "MODEL") continue;
    const id = line.split(/\s+/u)[0];
    if (!SAFE_MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push(Object.freeze({ id, displayName: id }));
    if (models.length >= MAX_PUBLIC_MODELS) break;
  }
  return Object.freeze(models);
}

export function namespaceQoderModels(models) {
  return Object.freeze((Array.isArray(models) ? models : []).map((model, index) => {
    const localId = String(model?.id || "").replace(/^qoder:/u, "");
    return Object.freeze({
      id: `qoder:${localId}`,
      providerModelId: localId,
      displayName: cleanProviderText(model?.displayName || localId, 80) || localId,
      isDefault: index === 0,
    });
  }));
}

function localQoderModelId(modelId) {
  const value = String(modelId || "");
  return value.startsWith("qoder:") ? value.slice("qoder:".length) : value;
}

function resolvedQoderSelection(selection, { evidence } = {}) {
  const models = evidence?.models || [];
  const requestedId = selection?.requestedModelId || null;
  const selected = requestedId
    ? models.find((model) => model.id === requestedId)
    : models.find((model) => model.isDefault) || models[0];
  if (requestedId && !selected) {
    fail("AGENT_SELECTION_UNSUPPORTED", "The requested Qoder model is unavailable.", { status: 409 });
  }
  return Object.freeze({
    providerId: QODER_PROVIDER_ID,
    runtimeId: QODER_RUNTIME_ID,
    requestedModelId: requestedId,
    resolvedModelId: selected?.id || null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
}

export function qoderFailure(code) {
  switch (code) {
    case "QODER_AUTH_REQUIRED":
      return "Qoder CLI 尚未登录。请先在 Qoder CLI 完成登录，再重试本轮。";
    case "QODER_ACCOUNT_CAPACITY_UNAVAILABLE":
    case "QODER_CAPACITY_UNAVAILABLE":
      return "Qoder 账号当前没有可用模型容量。本轮 Request 已保留，可稍后重试或复制给其他 Agent。";
    case "QODER_MODEL_CATALOG_EMPTY":
      return "Qoder 当前没有返回可用模型。Request 与当前 HTML 均已保留，可重试或改用复制任务。";
    case "QODER_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Qoder CLI。请先安装 Qoder CLI，或改用复制任务。";
    case "QODER_COMMAND_UNTRUSTED":
      return "找到的 Qoder CLI 不符合独立安装校验，Stemmio 没有启动它。";
    case "QODER_VERSION_UNSUPPORTED":
      return "当前 Qoder CLI 版本不受支持。请更新后再试。";
    case "AGENT_CANCELLED":
      return "Qoder 已停止。";
    case "AGENT_TURN_TIMEOUT":
      return "Qoder 本轮连续等待过久，已停止；Request 与当前 HTML 均已保留。";
    case "AGENT_NETWORK_INTERRUPTED":
      return "Qoder 连接中断，Request 与当前 HTML 均已保留。";
    case "ACP_AGENT_IDENTITY_MISMATCH":
      return "ACP 进程没有证明自己是 Qoder CLI，Stemmio 已停止它。";
    case "ACP_PROTOCOL_UNSUPPORTED":
    case "ACP_PROTOCOL_INVALID":
      return "Qoder CLI 的 ACP 协议未通过连接检查。当前 HTML 与 Request 均未改变。";
    case "ACP_PROCESS_CLEANUP_UNCONFIRMED":
      return "Qoder 连接检查进程未确认停止。Stemmio 已停止继续操作。";
    case "AGENT_RUNTIME_AUTHORITY_DRIFT":
    case "ACP_RUNTIME_AUTHORITY_DRIFT":
      return "本轮 Request 权限已经变化，Qoder 的后续写入已被拒绝。";
    case "AGENT_RETRY_OUTPUT_PRESENT":
      return "本轮已留下未最终化输出，Stemmio 不会覆盖或转交同一路径。请结束本轮后重新发送。";
    case "AGENT_RESTART_RECOVERY_REQUIRED":
      return "Bridge 上次退出后无法证明旧 Qoder 会话已经停止。请结束本轮，再重新发送为新的 Request。";
    default:
      return "Qoder CLI 没有完成本轮任务。Request 与当前 HTML 均已保留。";
  }
}

export function qoderPreflightFailure(code) {
  switch (code) {
    case "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED":
      return "Qoder 预检进程未确认停止。Stemmio 尚未创建本轮 Request；为避免失去控制，本次不能继续，应用也不会退出。";
    case "QODER_AUTH_REQUIRED":
      return "Qoder CLI 尚未登录。Stemmio 尚未创建本轮 Request；请先完成登录，再重试或改用复制任务。";
    case "QODER_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Qoder CLI。Stemmio 尚未创建本轮 Request；请先安装，或改用复制任务。";
    case "QODER_COMMAND_UNTRUSTED":
      return "找到的 Qoder CLI 不符合独立安装校验。Stemmio 尚未创建本轮 Request，也没有启动该命令。";
    case "QODER_VERSION_UNSUPPORTED":
      return "当前 Qoder CLI 版本不受支持。Stemmio 尚未创建本轮 Request；请更新后再试。";
    case "QODER_COMMAND_CHANGED":
      return "Qoder CLI 在预检期间发生变化。Stemmio 尚未创建本轮 Request，也没有启动变化后的命令。";
    case "QODER_VERSION_INVALID":
      return "Qoder CLI 没有返回可验证的版本号。Stemmio 尚未创建本轮 Request；请更新或重新安装后再试。";
    case "QODER_VERSION_MISMATCH":
      return "Qoder CLI 版本与独立安装清单不一致。Stemmio 尚未创建本轮 Request；请重新安装后再试。";
    case "QODER_ACCOUNT_CAPACITY_UNAVAILABLE":
    case "QODER_CAPACITY_UNAVAILABLE":
      return "Qoder 账号当前没有可用模型容量。Stemmio 尚未创建本轮 Request；当前 HTML 和评论保持不变，可稍后重试或改用复制任务。";
    case "QODER_MODEL_CATALOG_EMPTY":
      return "Qoder 当前没有返回可用模型。Stemmio 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
    case "QODER_PREFLIGHT_TIMEOUT":
      return "Qoder CLI 预检超时。Stemmio 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
    case "ACP_AGENT_IDENTITY_MISMATCH":
      return "Qoder ACP 进程身份不符。Stemmio 尚未创建本轮 Request，也没有执行任务。";
    case "ACP_PROTOCOL_UNSUPPORTED":
    case "ACP_PROTOCOL_INVALID":
      return "Qoder ACP 协议未通过连接检查。Stemmio 尚未创建本轮 Request；请更新或重新安装后再试。";
    default:
      return "Qoder CLI 预检没有完成。Stemmio 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
  }
}

export function normalizedQoderPreflightError(cause) {
  const rawCode = cleanProviderText(cause?.code, 120);
  const code = rawCode === "ACP_PROCESS_CLEANUP_UNCONFIRMED"
    ? "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"
    : cause instanceof AgentProviderError || rawCode.startsWith("ACP_")
      ? rawCode || "QODER_PREFLIGHT_FAILED"
      : "QODER_COMMAND_UNTRUSTED";
  const status = code === "QODER_AUTH_REQUIRED"
    ? 401
    : code === "QODER_COMMAND_NOT_FOUND"
      ? 404
      : Number.isSafeInteger(cause?.status)
        ? cause.status
        : 503;
  return agentProviderError(code, qoderPreflightFailure(code), { status });
}

export function classifyQoderPreflightFailure(cause) {
  const combined = `${cause?.stdout || ""}\n${cause?.stderr || ""}\n${cause?.qoderStderr || ""}\n${cause?.message || ""}`;
  if (/not logged in|sign in|login required|unauthenticated/iu.test(combined)) {
    return "QODER_AUTH_REQUIRED";
  }
  if (cause?.killed || cause?.code === "ETIMEDOUT" || cause?.signal === "SIGTERM") {
    return "QODER_PREFLIGHT_TIMEOUT";
  }
  return "QODER_PREFLIGHT_FAILED";
}

export function classifyQoderRunFailure(cause) {
  const mapped = cleanProviderText(cause?.code, 120);
  if (
    mapped === "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE"
    || mapped === "QODER_ACCOUNT_CAPACITY_UNAVAILABLE"
    || mapped === "QODER_CAPACITY_UNAVAILABLE"
  ) {
    return "QODER_ACCOUNT_CAPACITY_UNAVAILABLE";
  }
  if (["AGENT_TURN_TIMEOUT", "ACP_TURN_TIMEOUT", "ACP_TIMEOUT"].includes(mapped)) {
    return "AGENT_TURN_TIMEOUT";
  }
  if (mapped === "AGENT_NETWORK_INTERRUPTED") {
    return mapped;
  }
  const combined = `${cause?.message || ""}\n${cause?.qoderStderr || ""}`;
  if (/not logged in|sign in|login required|unauthenticated/iu.test(combined)) {
    return "QODER_AUTH_REQUIRED";
  }
  return mapped || "QODER_ACP_RUN_FAILED";
}

const QODER_RUNTIME_CODE_MAP = Object.freeze({
  ACP_CANCELLED: "AGENT_CANCELLED",
  ACP_TIMEOUT: "AGENT_TURN_TIMEOUT",
  ACP_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
  QODER_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
  AGENT_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
  ACP_AGENT_PROCESS_ERROR: "AGENT_NETWORK_INTERRUPTED",
  ACP_AGENT_EXITED_EARLY: "AGENT_NETWORK_INTERRUPTED",
  ACP_CONNECTION_CLOSED: "AGENT_NETWORK_INTERRUPTED",
  ACP_PROTOCOL_INVALID: "AGENT_NETWORK_INTERRUPTED",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "QODER_ACCOUNT_CAPACITY_UNAVAILABLE",
  ACP_OUTPUT_PREEXISTS: "AGENT_OUTPUT_PREEXISTS",
  ACP_COMPLETION_PREEXISTS: "AGENT_COMPLETION_PREEXISTS",
  ACP_PROCESS_CLEANUP_UNCONFIRMED: "AGENT_PROCESS_CLEANUP_UNCONFIRMED",
});

export function normalizeQoderRuntimeError(cause) {
  const code = QODER_RUNTIME_CODE_MAP[cleanProviderText(cause?.code, 120)]
    || cleanProviderText(cause?.code, 120)
    || "QODER_ACP_RUN_FAILED";
  if (cause instanceof Error) {
    cause.code = code;
    return cause;
  }
  return Object.assign(new Error("Agent runtime failed."), { code });
}

function expandedHomePath(value, homeDirectory) {
  const text = String(value || "").trim().replace(/^['"]|['"]$/gu, "");
  if (!text) return null;
  const expanded = text
    .replace(/^~(?=\/|$)/u, homeDirectory)
    .replaceAll("${HOME}", homeDirectory)
    .replaceAll("$HOME", homeDirectory);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : null;
}

async function configuredNpmPrefixes(environment, homeDirectory) {
  const prefixes = [];
  const configured = expandedHomePath(environment.NPM_CONFIG_PREFIX, homeDirectory);
  if (configured) prefixes.push(configured);
  const npmrc = await readFile(path.join(homeDirectory, ".npmrc"), "utf8").catch(() => "");
  for (const line of npmrc.split(/\r?\n/u)) {
    const match = line.match(/^\s*prefix\s*=\s*(.+?)\s*$/u);
    if (!match || match[1].trim().startsWith("#")) continue;
    const prefix = expandedHomePath(match[1], homeDirectory);
    if (prefix) prefixes.push(prefix);
  }
  return prefixes;
}

function versionDirectoryOrder(left, right) {
  const leftVersion = semver.coerce(left);
  const rightVersion = semver.coerce(right);
  if (leftVersion && rightVersion) return semver.rcompare(leftVersion, rightVersion);
  if (leftVersion) return -1;
  if (rightVersion) return 1;
  return right.localeCompare(left, "en");
}

async function versionedBinCandidates(root, suffix = ["bin", "qodercli"]) {
  if (!root || !path.isAbsolute(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort(versionDirectoryOrder)
    .map((name) => path.join(root, name, ...suffix));
}

async function commandCandidates(environment, homeDirectory) {
  const xdgDataHome = expandedHomePath(environment.XDG_DATA_HOME, homeDirectory)
    || path.join(homeDirectory, ".local", "share");
  const voltaHome = expandedHomePath(environment.VOLTA_HOME, homeDirectory)
    || path.join(homeDirectory, ".volta");
  const fnmRoots = [
    expandedHomePath(environment.FNM_DIR, homeDirectory),
    path.join(xdgDataHome, "fnm"),
    path.join(homeDirectory, ".fnm"),
  ].filter(Boolean);
  const miseDataHome = expandedHomePath(environment.MISE_DATA_DIR, homeDirectory)
    || path.join(xdgDataHome, "mise");
  const asdfDataHome = expandedHomePath(environment.ASDF_DATA_DIR, homeDirectory)
    || path.join(homeDirectory, ".asdf");
  const values = [];
  for (const directory of String(environment.PATH || "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    values.push(path.join(directory, "qodercli"));
  }
  for (const prefix of await configuredNpmPrefixes(environment, homeDirectory)) {
    values.push(path.join(prefix, "bin", "qodercli"));
  }
  values.push(
    path.join(homeDirectory, ".npm-global", "bin", "qodercli"),
    path.join(homeDirectory, ".local", "bin", "qodercli"),
    path.join(voltaHome, "bin", "qodercli"),
    "/opt/homebrew/bin/qodercli",
    "/usr/local/bin/qodercli",
  );
  values.push(...await versionedBinCandidates(path.join(homeDirectory, ".nvm", "versions", "node")));
  for (const root of fnmRoots) {
    values.push(...await versionedBinCandidates(
      path.join(root, "node-versions"),
      ["installation", "bin", "qodercli"],
    ));
  }
  values.push(...await versionedBinCandidates(path.join(miseDataHome, "installs", "node")));
  values.push(...await versionedBinCandidates(path.join(homeDirectory, ".mise", "installs", "node")));
  values.push(...await versionedBinCandidates(path.join(asdfDataHome, "installs", "nodejs")));
  return [...new Set(values)];
}

async function fileIdentity(filePath) {
  try {
    const information = await lstat(filePath);
    if (
      !information.isFile()
      || information.isSymbolicLink()
      || information.nlink !== 1
      || (information.mode & 0o022) !== 0
    ) {
      fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable is not a protected regular file.");
    }
    await access(filePath, fsConstants.X_OK).catch(() => {
      fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable is not executable.");
    });
    const bytes = await readFile(filePath);
    return Object.freeze({
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(bytes),
    });
  } catch (cause) {
    if (cause instanceof AgentProviderError) throw cause;
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable identity could not be verified.");
  }
}

export async function validateNpmQoderCommand(candidate) {
  let executable;
  try {
    executable = await realpath(candidate);
  } catch {
    return null;
  }
  if (/\.app\/Contents\//u.test(executable)) {
    fail("QODER_COMMAND_UNTRUSTED", "Stemmio 不会使用 Qoder 桌面应用内置的 CLI；请独立安装 Qoder CLI。");
  }
  if (path.basename(executable) !== "qodercli.js" || path.basename(path.dirname(executable)) !== "bundle") {
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable does not match the supported package layout.");
  }
  const packageRoot = path.dirname(path.dirname(executable));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI package manifest could not be verified.");
  }
  if (
    manifest?.name !== "@qoder-ai/qodercli"
    || manifest?.bin?.qodercli !== "bundle/qodercli.js"
    || !semver.valid(manifest?.version)
  ) {
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI package identity could not be verified.");
  }
  if (semver.lt(manifest.version, MIN_QODER_VERSION)) {
    fail(
      "QODER_VERSION_UNSUPPORTED",
      `独立 Qoder CLI 必须是 @qoder-ai/qodercli ${MIN_QODER_VERSION} 或更高版本。`,
    );
  }
  const [identity, packageInformation] = await Promise.all([
    fileIdentity(executable),
    lstat(packageRoot).catch(() => {
      fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI package directory could not be verified.");
    }),
  ]);
  if (!packageInformation.isDirectory() || (packageInformation.mode & 0o022) !== 0) {
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI package directory is writable by other users.");
  }
  return Object.freeze({
    command: executable,
    version: manifest.version,
    identity,
    source: "verified-npm-package",
    installSource: "user",
  });
}

export async function resolveQoderAcpCommand({
  environment = process.env,
  homeDirectory = os.homedir(),
  managedCandidates = async () => [],
} = {}) {
  const configured = cleanProviderText(environment.STEMMIO_QODER_ACP_COMMAND, 4_096);
  const testOverride = configured
    && environment.STEMMIO_E2E === "1"
    && environment.STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND === "1";
  if (configured && !testOverride) {
    fail("QODER_COMMAND_UNTRUSTED", "STEMMIO_QODER_ACP_COMMAND 只允许用于显式 E2E 测试。");
  }
  if (testOverride) {
    if (!path.isAbsolute(configured)) {
      fail("QODER_COMMAND_UNTRUSTED", "测试 Qoder 命令必须是绝对路径。");
    }
    const executable = await realpath(configured).catch(() => null);
    if (!executable) fail("QODER_COMMAND_NOT_FOUND", "测试 Qoder 命令不存在。");
    return Object.freeze({
      command: executable,
      version: null,
      identity: await fileIdentity(executable),
      source: "e2e-override",
      installSource: "none",
    });
  }

  // Collect every source before selecting one. Stemmio-managed Qoder is the
  // reproducible default; a valid user installation remains the fallback.
  const [userResult, managedResult] = await Promise.all([
    commandCandidates(environment, homeDirectory),
    typeof managedCandidates === "function"
      ? Promise.resolve().then(() => managedCandidates()).then(
        (value) => Array.isArray(value) ? value : [],
        () => [],
      )
      : Promise.resolve([]),
  ]);
  const diagnostics = [];
  const candidatesFor = async (candidates, source) => {
    for (const candidate of candidates) {
      try {
        const resolved = await validateNpmQoderCommand(candidate);
        if (resolved) return Object.freeze({ ...resolved, installSource: source });
      } catch (cause) {
        if (cause instanceof AgentProviderError) {
          diagnostics.push({ source, cause });
          continue;
        }
        throw cause;
      }
    }
    return null;
  };

  const managed = await candidatesFor(managedResult, "managed");
  if (managed) return managed;
  const user = await candidatesFor(userResult, "user");
  if (user) return user;
  if (diagnostics[0]?.cause) throw diagnostics[0].cause;
  fail("QODER_COMMAND_NOT_FOUND", "没有找到独立安装的 Qoder CLI。", { status: 404 });
}

export async function assertQoderInstallationUnchanged(command) {
  const current = await fileIdentity(command.command);
  if (
    current.dev !== command.identity.dev
    || current.ino !== command.identity.ino
    || current.nlink !== command.identity.nlink
    || current.size !== command.identity.size
    || current.mtimeMs !== command.identity.mtimeMs
    || current.sha256 !== command.identity.sha256
  ) {
    fail("QODER_COMMAND_CHANGED", "Qoder CLI 在预检后发生变化，Stemmio 没有启动它。", {
      status: 409,
    });
  }
}

function installationDigest(command) {
  return sha256(Buffer.from(JSON.stringify({
    source: command.source,
    version: command.version,
    identity: command.identity,
  }), "utf8"));
}

async function executePreflightCommand(command, args, environment, timeout) {
  if (command.source === "verified-npm-package") {
    return runVerifiedJavaScript({
      command: command.command,
      expectedExecutable: { path: command.command, identity: command.identity },
      args,
      baseEnvironment: environment,
      timeoutMs: timeout,
      maxBuffer: 128 * 1024,
    });
  }
  return execFileAsync(command.command, args, {
    env: acpProcessEnvironment({}, environment),
    encoding: "utf8",
    timeout,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
}

async function inspectQoderRuntime(command, environment, {
  probeRunner = probeAcpProcess,
} = {}) {
  const versionResult = await executePreflightCommand(command, ["--version"], environment, 10_000);
  const reportedVersion = cleanProviderText(versionResult.stdout, 80).split(/\s+/u)[0];
  if (!semver.valid(reportedVersion)) fail("QODER_VERSION_INVALID", "Qoder CLI 没有返回可验证的版本号。");
  if (command.version && reportedVersion !== command.version) {
    fail("QODER_VERSION_MISMATCH", "Qoder CLI 版本与安装清单不一致。");
  }
  const modelResult = await executePreflightCommand(command, ["--list-models"], environment, 30_000);
  const models = parsePublicModels(modelResult.stdout);
  if (models.length === 0) fail("QODER_MODEL_CATALOG_EMPTY", "Qoder 当前没有返回可用模型。");
  await probeRunner({
    command: command.command,
    args: ["--acp"],
    cwd: os.tmpdir(),
    environment: {},
    baseEnvironment: environment,
    expectedExecutable: command.identity
      ? { path: command.command, identity: command.identity }
      : undefined,
    useVerifiedJavaScriptRuntime: command.source === "verified-npm-package",
    expectedAgentName: command.source === "e2e-override"
      ? /qoder|stemmio-e2e/iu
      : /qoder/iu,
    startupTimeoutMs: 15_000,
    stderrFieldPrefix: "qoder",
  });
  return Object.freeze({ reportedVersion, models });
}

// Settings diagnosis creates only a short-lived, no-capability ACP smoke
// session. It never prompts the Agent, creates a ticket, or touches a Request.
export async function diagnoseQoder(command, environment, options) {
  let authenticationReady = false;
  try {
    const versionResult = await executePreflightCommand(command, ["--version"], environment, 10_000);
    const reportedVersion = cleanProviderText(versionResult.stdout, 80).split(/\s+/u)[0];
    if (!semver.valid(reportedVersion)) fail("QODER_VERSION_INVALID", "Qoder CLI 没有返回可验证的版本号。");
    if (command.version && reportedVersion !== command.version) {
      fail("QODER_VERSION_MISMATCH", "Qoder CLI 版本与安装清单不一致。");
    }
    const modelResult = await executePreflightCommand(command, ["--list-models"], environment, 30_000);
    const models = parsePublicModels(modelResult.stdout);
    if (models.length === 0) fail("QODER_MODEL_CATALOG_EMPTY", "Qoder 当前没有返回可用模型。");
    authenticationReady = true;
    await (options?.probeRunner || probeAcpProcess)({
      command: command.command,
      args: ["--acp"],
      cwd: os.tmpdir(),
      environment: {},
      baseEnvironment: environment,
      expectedExecutable: command.identity
        ? { path: command.command, identity: command.identity }
        : undefined,
      useVerifiedJavaScriptRuntime: command.source === "verified-npm-package",
      expectedAgentName: command.source === "e2e-override"
        ? /qoder|stemmio-e2e/iu
        : /qoder/iu,
      startupTimeoutMs: 15_000,
      stderrFieldPrefix: "qoder",
    });
    return Object.freeze({
      readiness: "ready",
      cause: null,
      activeInstallation: null,
      facts: Object.freeze({
        installation: "ready",
        authentication: "ready",
        protocol: "ready",
        service: "ready",
      }),
    });
  } catch (cause) {
    if (authenticationReady && cause?.code !== "ACP_PROCESS_CLEANUP_UNCONFIRMED") {
      return Object.freeze({
        readiness: "connection-failed",
        cause: cleanProviderText(cause?.code, 120) || classifyQoderPreflightFailure(cause),
        activeInstallation: null,
        facts: Object.freeze({
          installation: "ready",
          authentication: "ready",
          protocol: "failed",
          service: "unknown",
        }),
      });
    }
    const code = cause instanceof AgentProviderError
      ? cause.code
      : cause?.code === "ACP_PROCESS_CLEANUP_UNCONFIRMED"
        ? cause.code
        : classifyQoderPreflightFailure(cause);
    fail(code, qoderFailure(code), {
      status: code === "QODER_AUTH_REQUIRED"
        ? 401
        : Number.isSafeInteger(cause?.status)
          ? cause.status
          : 503,
    });
  }
}

export async function preflightQoder(command, environment, options) {
  try {
    const inspected = await inspectQoderRuntime(command, environment, options);
    return Object.freeze({
      version: inspected.reportedVersion,
      modelCount: inspected.models.length,
      models: namespaceQoderModels(inspected.models),
    });
  } catch (cause) {
    const code = cause?.code === "ACP_PROCESS_CLEANUP_UNCONFIRMED"
      ? "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"
      : cause instanceof AgentProviderError
        ? cause.code
        : classifyQoderPreflightFailure(cause);
    fail(code, qoderPreflightFailure(code), {
      status: code === "QODER_AUTH_REQUIRED"
        ? 401
        : Number.isSafeInteger(cause?.status)
          ? cause.status
          : 503,
    });
  }
}

export async function startQoderLogin(command, {
  environment = process.env,
  signal,
  onLoginUrl,
  timeoutMs,
  loginRunner = runOfficialAgentLogin,
  inspectRunner = diagnoseQoder,
} = {}) {
  const auth = describeQoderAuthSource(command, environment);
  if (auth.authSource !== "environment-token") {
    await loginRunner({
      executable: command.command,
      args: ["login"],
      // Keep one browser owner: Qoder prints the URL and Stemmio opens the
      // validated destination through Main.
      env: { ...acpProcessEnvironment({}, environment), NO_BROWSER: "1" },
      providerId: QODER_PROVIDER_ID,
      signal,
      timeoutMs,
      onOutput({ loginUrl }) {
        if (loginUrl) onLoginUrl?.(loginUrl);
      },
    });
  }
  await waitForAgentAuthentication(
    () => inspectRunner(command, environment),
    { signal, timeoutMs },
  );
  return auth;
}

export async function startQoderLogout(command, {
  environment = process.env,
  signal,
  timeoutMs,
  logoutRunner = runOfficialAgentLogout,
} = {}) {
  const auth = describeQoderAuthSource(command, environment);
  if (auth.authSource === "environment-token") {
    throw agentProviderError(
      "AGENT_LOGOUT_UNSUPPORTED",
      "当前使用环境变量凭据，无法在应用内退出账号。",
      { status: 409 },
    );
  }
  await logoutRunner({
    executable: command.command,
    args: ["logout"],
    env: acpProcessEnvironment({}, environment),
    providerId: QODER_PROVIDER_ID,
    signal,
    timeoutMs,
  });
  return Object.freeze({ authSource: null, authScope: null });
}

export function createQoderProvider({
  commandResolver = resolveQoderAcpCommand,
  diagnoseRunner = diagnoseQoder,
  preflightRunner = preflightQoder,
  loginRunner = startQoderLogin,
  policyLoader = loadExecutionPolicy,
  managedCandidates,
} = {}) {
  if (
    typeof commandResolver !== "function"
    || typeof diagnoseRunner !== "function"
    || typeof preflightRunner !== "function"
    || typeof policyLoader !== "function"
  ) {
    throw new TypeError("Qoder provider dependencies are invalid.");
  }
  const resolveInstallation = typeof managedCandidates === "function"
    ? (input) => commandResolver({ ...input, managedCandidates })
    : commandResolver;
  return defineAgentProvider({
    providerId: QODER_PROVIDER_ID,
    displayName: "Qoder",
    runtimeId: QODER_RUNTIME_ID,
    securityProfile: "client-mediated",
    capabilities: {
      availability: true,
      preflight: true,
      execution: true,
      modelCatalog: true,
      install: true,
      login: true,
      logout: true,
    },
    resolveInstallation: ({ environment }) => resolveInstallation({ environment }),
    diagnose: (installation, { environment }) => diagnoseRunner(installation, environment),
    preflight: (installation, { environment }) => preflightRunner(installation, environment),
    startLogin: (installation, options) => loginRunner(installation, {
      ...options,
      inspectRunner: diagnoseRunner,
    }),
    startLogout: (installation, options) => startQoderLogout(installation, options),
    assertInstallationUnchanged: assertQoderInstallationUnchanged,
    installationDigest,
    availabilityFailure(cause) {
      const code = cleanProviderText(cause?.code, 120) || "QODER_AVAILABILITY_FAILED";
      if (code === "QODER_COMMAND_NOT_FOUND") return Object.freeze({ status: "not-installed" });
      return Object.freeze({
        status: "unavailable",
        reason: ["QODER_COMMAND_UNTRUSTED", "QODER_VERSION_UNSUPPORTED"].includes(code)
          ? "invalid-installation"
          : "check-failed",
      });
    },
    normalizePreflightError: normalizedQoderPreflightError,
    normalizeRuntimeError: normalizeQoderRuntimeError,
    preflightFailureMessage: qoderPreflightFailure,
    loadExecutionPolicy: policyLoader,
    createRuntimeLaunch({
      ticket,
      policy,
      prompt,
      baseEnvironment,
      cancellationSignal,
      onEvent,
      turnTimeoutMs,
      inactivityTimeoutMs,
    }) {
      const installation = ticket.installation;
      const modelId = localQoderModelId(ticket.selection?.resolvedModelId);
      return Object.freeze({
        securityProfile: "client-mediated",
        command: installation.command,
        expectedExecutable: {
          path: installation.command,
          identity: installation.identity,
        },
        args: modelId ? ["--acp", "-m", modelId] : ["--acp"],
        policy,
        prompt,
        environment: {},
        baseEnvironment,
        useVerifiedJavaScriptRuntime: installation.source === "verified-npm-package",
        cancellationSignal,
        expectedAgentName: installation.source === "e2e-override"
          ? /qoder|stemmio-e2e/iu
          : /qoder/iu,
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
        ...(inactivityTimeoutMs ? { inactivityTimeoutMs } : {}),
        onEvent,
      });
    },
    classifyRunFailure: classifyQoderRunFailure,
    failureMessage: qoderFailure,
    resolveSelection: resolvedQoderSelection,
  });
}

export const qoderProvider = createQoderProvider();
