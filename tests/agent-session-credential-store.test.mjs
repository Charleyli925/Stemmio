import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentSessionCredentialStore } from "../desktop/agent-session-credential-store.mjs";

function memorySafeStorage() {
  return {
    available: true,
    encryptString(value) {
      return Buffer.from(`enc:${value}`, "utf8");
    },
    decryptString(buffer) {
      const text = Buffer.from(buffer).toString("utf8");
      return text.startsWith("enc:") ? text.slice(4) : "";
    },
  };
}

test("remembered Key is stored as ciphertext and never written in plaintext", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => crypto.available,
  });

  const persisted = await store.persist({
    operationId: "credential_save_0001",
    apiKey: "sk-secret",
    vendorId: "deepseek",
  });
  assert.equal(persisted.ok, true);
  assert.equal(persisted.status, "saved");
  assert.match(persisted.recordId, /^cred_[a-f0-9]{32}$/u);
  const raw = await readFile(path.join(userDataPath, "agent-session-credential.v1.json"), "utf8");
  assert.doesNotMatch(raw, /sk-secret/u);
  const durable = JSON.parse(raw);
  assert.equal(durable.schemaVersion, 2);
  assert.equal(durable.operationId, "credential_save_0001");
  assert.equal(durable.recordId, persisted.recordId);
  const loaded = await store.load();
  assert.equal(loaded.apiKey, "sk-secret");
  assert.equal(loaded.vendorId, "deepseek");
  const status = await store.publicStatus();
  assert.equal(status.remembered, true);
  assert.equal(status.vendorId, "deepseek");
  assert.equal("apiKey" in status, false);
});

test("remembered custom vendor also stores the non-secret Model ID", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => crypto.available,
  });

  const persisted = await store.persist({
    operationId: "credential_save_0002",
    apiKey: "sk-secret",
    vendorId: "custom",
    baseUrl: "https://api.example.com/v1",
    modelId: "private-model",
  });
  assert.equal(persisted.ok, true);
  const raw = await readFile(path.join(userDataPath, "agent-session-credential.v1.json"), "utf8");
  assert.doesNotMatch(raw, /sk-secret/u);
  assert.match(raw, /private-model/u);
  const loaded = await store.load();
  assert.equal(loaded.apiKey, "sk-secret");
  assert.equal(loaded.vendorId, "custom");
  assert.equal(loaded.baseUrl, "https://api.example.com/v1");
  assert.equal(loaded.modelId, "private-model");
});

test("unavailable encryption refuses to persist and does not fall back to plaintext", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: () => Buffer.from("nope"),
    decryptString: () => "sk-secret",
    isEncryptionAvailable: () => false,
  });
  const persisted = await store.persist({
    operationId: "credential_save_0003",
    apiKey: "sk-secret",
    vendorId: "deepseek",
  });
  assert.equal(persisted.ok, false);
  assert.equal(persisted.code, "AGENT_CREDENTIAL_STORE_UNAVAILABLE");
  assert.equal(await store.load(), null);
});

test("an unavailable asynchronous credential backend is bounded and never writes plaintext", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: async () => new Promise(() => {}),
    decryptString: async () => new Promise(() => {}),
    isEncryptionAvailable: async () => new Promise(() => {}),
    encryptionTimeoutMs: 5,
  });
  const startedAt = Date.now();
  const persisted = await store.persist({
    operationId: "credential_timeout_0001",
    apiKey: "sk-secret",
    vendorId: "deepseek",
  });
  assert.equal(persisted.ok, false);
  assert.equal(persisted.code, "AGENT_CREDENTIAL_STORE_UNAVAILABLE");
  assert.ok(Date.now() - startedAt < 500);
  await assert.rejects(
    readFile(path.join(userDataPath, "agent-session-credential.v1.json"), "utf8"),
    { code: "ENOENT" },
  );
});

test("missing credential status does not touch macOS safeStorage", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  let availabilityChecks = 0;
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: () => Buffer.from("unused"),
    decryptString: () => "unused",
    isEncryptionAvailable: () => {
      availabilityChecks += 1;
      return false;
    },
  });
  assert.deepEqual(await store.publicStatus(), {
    available: true,
    remembered: false,
    providerId: "stemmio",
    vendorId: null,
    recordId: null,
    status: "missing",
  });
  assert.equal(availabilityChecks, 0);
  assert.deepEqual(await store.loadResult(), { status: "missing", credential: null });
  assert.equal(availabilityChecks, 0);
});

test("unreadable remembered credentials stay on disk and do not trigger retry loops", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const credentialPath = path.join(userDataPath, "agent-session-credential.v1.json");
  const crypto = memorySafeStorage();
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: () => {
      throw new Error("keychain denied");
    },
    isEncryptionAvailable: () => true,
  });
  await store.persist({ operationId: "credential_save_0004", apiKey: "sk-secret", vendorId: "deepseek" });
  const before = await readFile(credentialPath, "utf8");
  const status = await store.publicStatus();
  assert.equal(status.remembered, true);
  assert.equal(status.unreadable, undefined);
  const loaded = await store.loadResult();
  assert.equal(loaded.status, "unreadable");
  assert.equal(loaded.reason, "AGENT_CREDENTIAL_DECRYPT_FAILED");
  assert.equal(await readFile(credentialPath, "utf8"), before);
  assert.equal(await store.load(), null);
  assert.equal(await readFile(credentialPath, "utf8"), before);
});

test("legacy v1 ciphertext remains readable and migrates only on an explicit mutation", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const credentialPath = path.join(userDataPath, "agent-session-credential.v1.json");
  const crypto = memorySafeStorage();
  const legacy = {
    schemaVersion: 1,
    providerId: "stemmio",
    vendorId: "custom",
    baseUrl: "https://api.example.com/v1",
    modelId: "legacy-model",
    ciphertext: crypto.encryptString("sk-legacy").toString("base64"),
    rememberedAt: "2026-01-01T00:00:00.000Z",
  };
  await writeFile(credentialPath, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
  });

  const status = await store.publicStatus();
  assert.equal(status.status, "saved");
  assert.match(status.recordId, /^legacy_[a-f0-9]{24}$/u);
  assert.deepEqual(
    await store.publicStatus({ operationId: "credential_unknown_legacy_1" }),
    {
      available: true,
      remembered: false,
      providerId: "stemmio",
      vendorId: null,
      recordId: null,
      status: "unknown",
      operationId: "credential_unknown_legacy_1",
      code: "AGENT_CREDENTIAL_OPERATION_UNKNOWN",
    },
  );
  assert.equal((await store.load()).apiKey, "sk-legacy");
  assert.equal(JSON.parse(await readFile(credentialPath, "utf8")).schemaVersion, 1);

  const cleared = await store.clear({
    operationId: "credential_clear_legacy_1",
    expectedRecordId: status.recordId,
  });
  assert.equal(cleared.status, "missing");
  const migrated = JSON.parse(await readFile(credentialPath, "utf8"));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.state, "cleared");
  assert.equal("ciphertext" in migrated, false);
});

test("provider mutations commit in Main acceptance order even when the first write is pending", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  let releaseFirstRename;
  let firstRenameStarted;
  const firstRename = new Promise((resolve) => { firstRenameStarted = resolve; });
  const release = new Promise((resolve) => { releaseFirstRename = resolve; });
  let renameCalls = 0;
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
    fileSystem: {
      rename: async (...args) => {
        renameCalls += 1;
        if (renameCalls === 1) {
          firstRenameStarted();
          await release;
        }
        return rename(...args);
      },
    },
  });

  const oldSave = store.persist({
    operationId: "credential_order_old_1",
    apiKey: "sk-old",
    vendorId: "deepseek",
  });
  await firstRename;
  const newSave = store.persist({
    operationId: "credential_order_new_1",
    apiKey: "sk-new",
    vendorId: "openai",
  });
  releaseFirstRename();
  assert.equal((await oldSave).status, "saved");
  assert.equal((await newSave).status, "saved");
  assert.equal((await store.load()).apiKey, "sk-new");
  assert.equal((await store.publicStatus({ operationId: "credential_order_old_1" })).status, "superseded");
});

test("a clear accepted behind a pending save leaves a durable tombstone and the save cannot resurrect", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  let releaseFirstRename;
  let firstRenameStarted;
  const firstRename = new Promise((resolve) => { firstRenameStarted = resolve; });
  const release = new Promise((resolve) => { releaseFirstRename = resolve; });
  let renameCalls = 0;
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
    fileSystem: {
      rename: async (...args) => {
        renameCalls += 1;
        if (renameCalls === 1) {
          firstRenameStarted();
          await release;
        }
        return rename(...args);
      },
    },
  });

  const save = store.persist({ operationId: "credential_pending_save_1", apiKey: "sk-old", vendorId: "deepseek" });
  await firstRename;
  const clear = store.clear({ operationId: "credential_forget_after_1", expectedRecordId: null });
  releaseFirstRename();
  const [saveReceipt, clearReceipt] = await Promise.all([save, clear]);
  assert.equal(saveReceipt.status, "saved");
  assert.equal(clearReceipt.status, "missing");
  assert.equal((await store.loadResult()).status, "missing");
  assert.equal((await store.persist({
    operationId: "credential_pending_save_1",
    apiKey: "sk-old",
    vendorId: "deepseek",
  })).status, "superseded");
  assert.equal((await store.loadResult()).status, "missing");
  const durable = JSON.parse(await readFile(path.join(userDataPath, "agent-session-credential.v1.json"), "utf8"));
  assert.equal(durable.state, "cleared");
  assert.equal(durable.operationId, "credential_forget_after_1");
});

test("a failed old atomic write cleans only its temp file and cannot remove a newer record", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  const removed = [];
  let renameCalls = 0;
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
    fileSystem: {
      rename: async (...args) => {
        renameCalls += 1;
        if (renameCalls === 1) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
        return rename(...args);
      },
      unlink: async (target) => {
        removed.push(target);
        return unlink(target);
      },
    },
  });

  const failed = await store.persist({ operationId: "credential_failed_old_1", apiKey: "sk-old", vendorId: "deepseek" });
  const saved = await store.persist({ operationId: "credential_saved_new_1", apiKey: "sk-new", vendorId: "openai" });
  assert.equal(failed.status, "unavailable");
  assert.equal(saved.status, "saved");
  assert.equal(removed.length, 1);
  assert.match(path.basename(removed[0]), /\.tmp$/u);
  assert.equal((await store.load()).apiKey, "sk-new");
});

test("a lost persist reply converges through operation status and replay does not encrypt or write twice", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  const first = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
  });
  const original = await first.persist({ operationId: "credential_lost_reply_1", apiKey: "sk-secret", vendorId: "deepseek" });
  let encryptCalls = 0;
  let renameCalls = 0;
  const restarted = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => {
      encryptCalls += 1;
      return crypto.encryptString(value);
    },
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
    fileSystem: {
      rename: async (...args) => {
        renameCalls += 1;
        return rename(...args);
      },
    },
  });
  const status = await restarted.publicStatus({ operationId: "credential_lost_reply_1" });
  assert.equal(status.status, "saved");
  assert.equal(status.recordId, original.recordId);
  const replay = await restarted.persist({ operationId: "credential_lost_reply_1", apiKey: "different", vendorId: "openai" });
  assert.equal(replay.status, "saved");
  assert.equal(replay.recordId, original.recordId);
  assert.equal(encryptCalls, 0);
  assert.equal(renameCalls, 0);
  assert.equal((await restarted.load()).apiKey, "sk-secret");
});

test("clear enforces a concrete record CAS while null clears everything accepted before it", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const crypto = memorySafeStorage();
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => true,
  });
  const oldRecord = await store.persist({ operationId: "credential_cas_old_01", apiKey: "sk-old", vendorId: "deepseek" });
  const newRecord = await store.persist({ operationId: "credential_cas_new_01", apiKey: "sk-new", vendorId: "openai" });
  const staleClear = await store.clear({ operationId: "credential_cas_clear_1", expectedRecordId: oldRecord.recordId });
  assert.equal(staleClear.status, "superseded");
  assert.equal((await store.load()).apiKey, "sk-new");
  const clearAll = await store.clear({ operationId: "credential_null_clear_1", expectedRecordId: null });
  assert.equal(clearAll.status, "missing");
  assert.equal((await store.publicStatus({ operationId: "credential_null_clear_1" })).status, "missing");
  assert.equal((await store.loadResult()).status, "missing");
  assert.notEqual(newRecord.recordId, oldRecord.recordId);
});

test("unavailable and corrupt remembered records are explicit and never collapse to missing", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-credential-"));
  const credentialPath = path.join(userDataPath, "agent-session-credential.v1.json");
  const crypto = memorySafeStorage();
  let available = true;
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => available,
  });
  await store.persist({ operationId: "credential_unavailable_1", apiKey: "sk-secret", vendorId: "deepseek" });
  available = false;
  assert.equal((await store.publicStatus({ operationId: "credential_unavailable_1" })).status, "unavailable");
  assert.equal((await store.loadResult()).status, "unavailable");

  await writeFile(credentialPath, "{corrupt", { mode: 0o600 });
  const corruptStatus = await store.publicStatus({ operationId: "credential_corrupt_query" });
  assert.equal(corruptStatus.status, "unreadable");
  assert.equal(corruptStatus.remembered, true);
  assert.equal((await store.loadResult()).status, "unreadable");
  assert.equal(await readFile(credentialPath, "utf8"), "{corrupt");
});
