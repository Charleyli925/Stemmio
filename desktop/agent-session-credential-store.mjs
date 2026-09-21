import {
  mkdir as defaultMkdir,
  readFile as defaultReadFile,
  rename as defaultRename,
  unlink as defaultUnlink,
  writeFile as defaultWriteFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes as defaultRandomBytes } from "node:crypto";

export const AGENT_SESSION_CREDENTIAL_FILE_NAME = "agent-session-credential.v1.json";
const SCHEMA_VERSION = 2;
const MAX_BYTES = 16_384;
const MAX_RECEIPTS = 12;
const DEFAULT_ENCRYPTION_TIMEOUT_MS = 10_000;
const PROVIDER_ID = "stemmio";
const SAFE_VENDOR = /^(?:deepseek|zhipu|dashscope|openai|custom)$/u;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,79}$/u;
const SAFE_OPERATION_ID = /^[A-Za-z0-9_-]{8,160}$/u;
const SAFE_RECORD_ID = /^cred_[a-f0-9]{24,32}$/u;
const HTTPS_ORIGIN = /^https:\/\//u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function credentialPath(userDataPath) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new TypeError("Agent credential store requires an absolute userData path.");
  }
  return path.join(userDataPath, AGENT_SESSION_CREDENTIAL_FILE_NAME);
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 200 || !HTTPS_ORIGIN.test(text)) return "";
  let url;
  try { url = new URL(text); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

function validOperationId(value) {
  const operationId = String(value || "").trim();
  return SAFE_OPERATION_ID.test(operationId) ? operationId : "";
}

function unavailableReceipt(operationId = "") {
  return Object.freeze({
    ok: false,
    status: "unavailable",
    ...(operationId ? { operationId } : {}),
    code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
  });
}

function unreadableReceipt(operationId = "", reason = "AGENT_CREDENTIAL_RECORD_INVALID") {
  return Object.freeze({
    ok: false,
    status: "unreadable",
    ...(operationId ? { operationId } : {}),
    code: reason,
  });
}

function invalidReceipt(operationId = "") {
  return Object.freeze({
    ok: false,
    status: "rejected",
    ...(operationId ? { operationId } : {}),
    code: "AGENT_SESSION_CREDENTIAL_INVALID",
  });
}

function publicMissing(operationId = "") {
  return Object.freeze({
    available: true,
    remembered: false,
    providerId: PROVIDER_ID,
    vendorId: null,
    recordId: null,
    status: "missing",
    ...(operationId ? { operationId } : {}),
  });
}

function parseReceipt(value) {
  if (!isRecord(value)) return null;
  const operationId = validOperationId(value.operationId);
  if (!operationId || !["persist", "clear"].includes(value.kind)) return null;
  const status = String(value.status || "");
  if (!new Set(["saved", "missing", "superseded"]).has(status)) return null;
  const recordId = SAFE_RECORD_ID.test(String(value.recordId || ""))
    ? String(value.recordId)
    : null;
  const expectedRecordId = SAFE_RECORD_ID.test(String(value.expectedRecordId || ""))
    ? String(value.expectedRecordId)
    : null;
  if (value.kind === "persist" && status === "saved" && !recordId) return null;
  return Object.freeze({ operationId, kind: value.kind, status, recordId, expectedRecordId });
}

function serializeReceipt(receipt) {
  return {
    operationId: receipt.operationId,
    kind: receipt.kind,
    status: receipt.status,
    ...(receipt.recordId ? { recordId: receipt.recordId } : {}),
    ...(receipt.expectedRecordId ? { expectedRecordId: receipt.expectedRecordId } : {}),
  };
}

function receiptResult(receipt, current) {
  let status = receipt.status;
  if (["unavailable", "unreadable", "rejected"].includes(status)) {
    return Object.freeze({
      ok: false,
      status,
      operationId: receipt.operationId,
      providerId: PROVIDER_ID,
      remembered: false,
      recordId: null,
      code: receipt.code,
    });
  }
  if (status === "saved") {
    status = current?.state === "saved" && current.operationId === receipt.operationId
      ? "saved"
      : "superseded";
  } else if (status === "missing") {
    status = current?.state === "cleared" && current.operationId === receipt.operationId
      ? "missing"
      : "superseded";
  }
  return Object.freeze({
    ok: status === "saved" || status === "missing",
    status,
    operationId: receipt.operationId,
    providerId: PROVIDER_ID,
    remembered: status === "saved",
    recordId: status === "saved" ? receipt.recordId : null,
    ...(status === "superseded" ? { code: "AGENT_CREDENTIAL_OPERATION_SUPERSEDED" } : {}),
  });
}

function withReceipt(state, receipt) {
  const receipts = [
    ...state.receipts.filter((entry) => entry.operationId !== receipt.operationId),
    receipt,
  ].slice(-MAX_RECEIPTS);
  return Object.freeze({ ...state, receipts: Object.freeze(receipts) });
}

function serializeState(state) {
  const current = state.current;
  return {
    schemaVersion: SCHEMA_VERSION,
    providerId: PROVIDER_ID,
    state: current.state,
    operationId: current.operationId,
    ...(current.state === "saved" ? {
      recordId: current.recordId,
      vendorId: current.vendorId,
      baseUrl: current.baseUrl,
      modelId: current.modelId,
      ciphertext: current.ciphertext,
      rememberedAt: current.rememberedAt,
    } : { clearedAt: current.clearedAt }),
    receipts: state.receipts.map(serializeReceipt),
  };
}

export function createAgentSessionCredentialStore({
  userDataPath,
  encryptString,
  decryptString,
  isEncryptionAvailable,
  encryptionTimeoutMs = DEFAULT_ENCRYPTION_TIMEOUT_MS,
  fileSystem = {},
  randomBytes = defaultRandomBytes,
} = {}) {
  const filePath = credentialPath(userDataPath);
  const encrypt = typeof encryptString === "function" ? encryptString : null;
  const decrypt = typeof decryptString === "function" ? decryptString : null;
  const boundedEncryptionTimeoutMs = Math.max(1, Number(encryptionTimeoutMs) || DEFAULT_ENCRYPTION_TIMEOUT_MS);
  const runEncryptionOperation = (operation) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("Credential encryption timed out."), {
      code: "AGENT_CREDENTIAL_STORE_TIMEOUT",
    })), boundedEncryptionTimeoutMs);
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
  const available = typeof isEncryptionAvailable === "function"
    ? async () => {
      try {
        return await runEncryptionOperation(isEncryptionAvailable) === true;
      } catch {
        return false;
      }
    }
    : async () => false;
  const fs = Object.freeze({
    mkdir: typeof fileSystem.mkdir === "function" ? fileSystem.mkdir : defaultMkdir,
    readFile: typeof fileSystem.readFile === "function" ? fileSystem.readFile : defaultReadFile,
    rename: typeof fileSystem.rename === "function" ? fileSystem.rename : defaultRename,
    unlink: typeof fileSystem.unlink === "function" ? fileSystem.unlink : defaultUnlink,
    writeFile: typeof fileSystem.writeFile === "function" ? fileSystem.writeFile : defaultWriteFile,
  });
  const volatileReceipts = new Map();
  let mutationQueue = Promise.resolve();

  function nextRecordId() {
    return `cred_${randomBytes(16).toString("hex")}`;
  }

  async function atomicWrite(payload) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.rename(temporaryPath, filePath);
    } catch (cause) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw cause;
    }
  }

  async function readState() {
    let raw;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return Object.freeze({ state: "missing", current: null, receipts: Object.freeze([]) });
      }
      return Object.freeze({ state: "unreadable", current: null, receipts: Object.freeze([]), reason: "AGENT_CREDENTIAL_FILE_UNREADABLE" });
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
      return Object.freeze({ state: "unreadable", current: null, receipts: Object.freeze([]), reason: "AGENT_CREDENTIAL_RECORD_INVALID" });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Object.freeze({ state: "unreadable", current: null, receipts: Object.freeze([]), reason: "AGENT_CREDENTIAL_RECORD_INVALID" });
    }

    const operationId = validOperationId(parsed?.operationId);
    const receipts = Array.isArray(parsed?.receipts)
      ? parsed.receipts.map(parseReceipt).filter(Boolean).slice(-MAX_RECEIPTS)
      : [];
    if (
      !isRecord(parsed)
      || parsed.schemaVersion !== SCHEMA_VERSION
      || parsed.providerId !== PROVIDER_ID
      || !operationId
      || !["saved", "cleared"].includes(parsed.state)
      || !Array.isArray(parsed.receipts)
      || receipts.length !== parsed.receipts.length
    ) {
      return Object.freeze({ state: "unreadable", current: null, receipts: Object.freeze([]), reason: "AGENT_CREDENTIAL_RECORD_INVALID" });
    }
    if (parsed.state === "cleared") {
      return Object.freeze({
        state: "record",
        receipts: Object.freeze(receipts),
        current: Object.freeze({ state: "cleared", operationId, clearedAt: typeof parsed.clearedAt === "string" ? parsed.clearedAt : null }),
      });
    }
    if (
      !SAFE_RECORD_ID.test(String(parsed.recordId || ""))
      || !SAFE_VENDOR.test(parsed.vendorId || "")
      || typeof parsed.ciphertext !== "string"
      || !parsed.ciphertext
    ) {
      return Object.freeze({ state: "unreadable", current: null, receipts: Object.freeze([]), reason: "AGENT_CREDENTIAL_RECORD_INVALID" });
    }
    return Object.freeze({
      state: "record",
      receipts: Object.freeze(receipts),
      current: Object.freeze({
        state: "saved",
        operationId,
        recordId: parsed.recordId,
        providerId: PROVIDER_ID,
        vendorId: parsed.vendorId,
        baseUrl: normalizeBaseUrl(parsed.baseUrl),
        modelId: SAFE_MODEL_ID.test(String(parsed.modelId || "")) ? String(parsed.modelId) : "",
        ciphertext: parsed.ciphertext,
        rememberedAt: typeof parsed.rememberedAt === "string" ? parsed.rememberedAt : null,
      }),
    });
  }

  function enqueueMutation(task) {
    const accepted = mutationQueue.then(task, task);
    mutationQueue = accepted.then(() => undefined, () => undefined);
    return accepted;
  }

  function findReceipt(state, operationId) {
    return state.receipts.find((entry) => entry.operationId === operationId)
      || volatileReceipts.get(operationId)
      || null;
  }

  function rememberVolatile(receipt) {
    volatileReceipts.set(receipt.operationId, receipt);
    if (volatileReceipts.size > MAX_RECEIPTS * 2) {
      volatileReceipts.delete(volatileReceipts.keys().next().value);
    }
  }

  async function statusFor(operationIdInput = "") {
    const operationId = operationIdInput ? validOperationId(operationIdInput) : "";
    if (operationIdInput && !operationId) return invalidReceipt();
    await mutationQueue;
    const result = await readState();
    if (result.state === "missing") return publicMissing(operationId);
    if (result.state !== "record") {
      return Object.freeze({
        available: false,
        remembered: true,
        providerId: PROVIDER_ID,
        vendorId: null,
        recordId: null,
        status: "unreadable",
        ...(operationId ? { operationId } : {}),
        unreadable: true,
        reason: result.reason || "AGENT_CREDENTIAL_RECORD_INVALID",
      });
    }
    const current = result.current;
    const receipt = operationId ? findReceipt(result, operationId) : null;
    if (receipt) {
      const projected = receiptResult(receipt, current);
      if (projected.status !== "saved") {
        return Object.freeze({
          ...projected,
          available: projected.status !== "unavailable" && projected.status !== "unreadable",
          vendorId: null,
        });
      }
    }
    if (operationId && current.operationId && current.operationId !== operationId) {
      return Object.freeze({
        available: true,
        remembered: false,
        providerId: PROVIDER_ID,
        vendorId: null,
        recordId: null,
        status: "superseded",
        operationId,
        code: "AGENT_CREDENTIAL_OPERATION_SUPERSEDED",
      });
    }
    if (current.state === "cleared") return publicMissing(operationId || current.operationId);
    if (!await available()) {
      return Object.freeze({
        available: false,
        remembered: true,
        providerId: PROVIDER_ID,
        vendorId: current.vendorId,
        recordId: current.recordId,
        status: "unavailable",
        ...(operationId ? { operationId } : {}),
        reason: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
      });
    }
    return Object.freeze({
      available: true,
      remembered: true,
      providerId: PROVIDER_ID,
      vendorId: current.vendorId,
      recordId: current.recordId,
      status: "saved",
      ...(operationId || current.operationId ? { operationId: operationId || current.operationId } : {}),
    });
  }

  return Object.freeze({
    status(operationId) {
      return statusFor(operationId);
    },
    async publicStatus({ operationId } = {}) {
      return statusFor(operationId);
    },
    persist({ operationId: operationIdInput, apiKey, vendorId, baseUrl, modelId } = {}) {
      const operationId = validOperationId(operationIdInput);
      if (!operationId) return Promise.resolve(invalidReceipt());
      return enqueueMutation(async () => {
        const state = await readState();
        const durableReceipt = state.state === "record" ? findReceipt(state, operationId) : volatileReceipts.get(operationId);
        if (durableReceipt) return receiptResult(durableReceipt, state.current);
        if (state.state === "unreadable") return unreadableReceipt(operationId, state.reason);
        if (!encrypt || !await available()) {
          const result = unavailableReceipt(operationId);
          rememberVolatile(Object.freeze({ ...result, operationId, kind: "persist" }));
          return result;
        }
        const key = String(apiKey || "").trim();
        const vendor = String(vendorId || "").trim();
        if (!key || key.length > 8_192 || !SAFE_VENDOR.test(vendor)) {
          const result = invalidReceipt(operationId);
          rememberVolatile(Object.freeze({ ...result, operationId, kind: "persist" }));
          return result;
        }
        let ciphertext;
        try {
          const encrypted = await runEncryptionOperation(() => encrypt(key));
          ciphertext = Buffer.isBuffer(encrypted)
            ? encrypted.toString("base64")
            : Buffer.from(String(encrypted || ""), "utf8").toString("base64");
        } catch {
          const result = unavailableReceipt(operationId);
          rememberVolatile(Object.freeze({ ...result, operationId, kind: "persist" }));
          return result;
        }
        if (!ciphertext) {
          const result = unavailableReceipt(operationId);
          rememberVolatile(Object.freeze({ ...result, operationId, kind: "persist" }));
          return result;
        }
        const recordId = nextRecordId();
        const receipt = Object.freeze({ operationId, kind: "persist", status: "saved", recordId, expectedRecordId: null });
        const nextState = withReceipt({
          receipts: state.receipts,
          current: Object.freeze({
            state: "saved",
            operationId,
            recordId,
            providerId: PROVIDER_ID,
            vendorId: vendor,
            baseUrl: vendor === "custom" ? normalizeBaseUrl(baseUrl) : "",
            modelId: vendor === "custom" && SAFE_MODEL_ID.test(String(modelId || "")) ? String(modelId) : "",
            ciphertext,
            rememberedAt: new Date().toISOString(),
          }),
        }, receipt);
        try {
          await atomicWrite(serializeState(nextState));
        } catch {
          const result = unavailableReceipt(operationId);
          rememberVolatile(Object.freeze({ ...result, operationId, kind: "persist" }));
          return result;
        }
        rememberVolatile(receipt);
        return receiptResult(receipt, nextState.current);
      });
    },
    async loadResult() {
      await mutationQueue;
      const result = await readState();
      if (result.state === "missing" || result.current?.state === "cleared") {
        return Object.freeze({ status: "missing", credential: null });
      }
      if (result.state !== "record") {
        return Object.freeze({ status: "unreadable", credential: null, reason: result.reason || "AGENT_CREDENTIAL_RECORD_INVALID" });
      }
      if (!decrypt || !await available()) {
        return Object.freeze({
          status: "unavailable",
          credential: null,
          vendorId: result.current.vendorId,
          reason: "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
        });
      }
      const record = result.current;
      let apiKey = "";
      try {
        apiKey = String(await runEncryptionOperation(
          () => decrypt(Buffer.from(record.ciphertext, "base64")),
        ) || "").trim();
      } catch {
        return Object.freeze({ status: "unreadable", credential: null, vendorId: record.vendorId, reason: "AGENT_CREDENTIAL_DECRYPT_FAILED" });
      }
      if (!apiKey) {
        return Object.freeze({ status: "unreadable", credential: null, vendorId: record.vendorId, reason: "AGENT_CREDENTIAL_DECRYPT_FAILED" });
      }
      return Object.freeze({
        status: "loaded",
        credential: Object.freeze({
          providerId: PROVIDER_ID,
          vendorId: record.vendorId,
          baseUrl: record.baseUrl,
          modelId: record.modelId || "",
          apiKey,
        }),
      });
    },
    async load() {
      const result = await this.loadResult();
      return result.credential || null;
    },
    clear({ operationId: operationIdInput, expectedRecordId: expectedRecordIdInput = null } = {}) {
      const operationId = validOperationId(operationIdInput);
      const expectedRecordId = expectedRecordIdInput === null || expectedRecordIdInput === undefined
        ? null
        : String(expectedRecordIdInput || "").trim();
      if (!operationId || (expectedRecordId !== null && !SAFE_RECORD_ID.test(expectedRecordId))) {
        return Promise.resolve(invalidReceipt(operationId));
      }
      return enqueueMutation(async () => {
        const state = await readState();
        const known = state.state === "record" ? findReceipt(state, operationId) : volatileReceipts.get(operationId);
        if (known) return receiptResult(known, state.current);
        if (state.state === "unreadable" && expectedRecordId !== null) {
          return unreadableReceipt(operationId, state.reason);
        }
        if (expectedRecordId !== null && state.current?.state !== "saved") {
          const receipt = Object.freeze({ operationId, kind: "clear", status: "superseded", recordId: null, expectedRecordId });
          rememberVolatile(receipt);
          return receiptResult(receipt, state.current);
        }
        if (expectedRecordId !== null && state.current.recordId !== expectedRecordId) {
          const receipt = Object.freeze({ operationId, kind: "clear", status: "superseded", recordId: null, expectedRecordId });
          rememberVolatile(receipt);
          return receiptResult(receipt, state.current);
        }
        const receipt = Object.freeze({ operationId, kind: "clear", status: "missing", recordId: null, expectedRecordId });
        const nextState = withReceipt({
          receipts: state.state === "record" ? state.receipts : Object.freeze([]),
          current: Object.freeze({ state: "cleared", operationId, clearedAt: new Date().toISOString() }),
        }, receipt);
        try {
          await atomicWrite(serializeState(nextState));
        } catch {
          const result = unavailableReceipt(operationId);
          rememberVolatile(Object.freeze({ ...result, operationId, kind: "clear" }));
          return result;
        }
        rememberVolatile(receipt);
        return receiptResult(receipt, nextState.current);
      });
    },
  });
}
