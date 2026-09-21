import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  APPLICATION_UPDATE_INITIAL_DELAY_MS,
  APPLICATION_UPDATE_INTERVAL_MS,
  createApplicationUpdateController,
} from "../desktop/application-update.mjs";

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCount = 0;
    this.downloadCount = 0;
    this.downloadTargets = [];
    this.availableVersion = null;
    this.installCount = 0;
    this.checkResult = Promise.resolve();
    this.downloadResult = Promise.resolve();
  }

  emit(eventName, ...args) {
    if (eventName === "update-available") {
      this.availableVersion = args[0]?.version || null;
    } else if (eventName === "update-not-available") {
      this.availableVersion = null;
    }
    return super.emit(eventName, ...args);
  }

  checkForUpdates() {
    this.checkCount += 1;
    return this.checkResult;
  }

  downloadUpdate() {
    this.downloadCount += 1;
    this.downloadTargets.push(this.availableVersion || null);
    return this.downloadResult;
  }

  quitAndInstall() {
    this.installCount += 1;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function controller(options = {}) {
  const updater = options.updater || new FakeUpdater();
  const statuses = [];
  return {
    updater,
    statuses,
    value: createApplicationUpdateController({
      updater,
      currentVersion: "0.9.0",
      architecture: "arm64",
      enabled: true,
      logger: { warn() {} },
      onStatus: (status) => statuses.push(status),
      ...options,
    }),
  };
}

test("stable updater waits for an explicit download and never installs on ordinary quit", () => {
  const { updater, value } = controller();

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.autoRunAppAfterInstall, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.disableDifferentialDownload, false);
  assert.deepEqual(value.getStatus(), {
    status: "idle",
    currentVersion: "0.9.0",
    latestVersion: null,
    architecture: "arm64",
    downloadPercent: null,
    publishedAt: null,
  });
  assert.equal(Object.isFrozen(value.getStatus()), true);
});

test("update events expose bounded public progress and a restart-ready state", () => {
  const { updater, value, statuses } = controller();

  updater.emit("checking-for-update");
  updater.emit("update-available", {
    version: "0.10.0",
    releaseDate: "2026-07-28T12:00:00.000Z",
  });
  updater.emit("download-progress", { percent: 42.345 });
  updater.emit("download-progress", { percent: 120 });
  updater.emit("update-downloaded", {
    version: "0.10.0",
    releaseDate: "2026-07-28T12:00:00.000Z",
  });

  assert.deepEqual(
    statuses.map((status) => [status.status, status.downloadPercent]),
    [
      ["checking", null],
      ["available", null],
      ["downloading", 42.3],
      ["downloading", 100],
      ["downloaded", 100],
    ],
  );
  assert.deepEqual(value.getStatus(), {
    status: "downloaded",
    currentVersion: "0.9.0",
    latestVersion: "0.10.0",
    architecture: "arm64",
    downloadPercent: 100,
    publishedAt: "2026-07-28T12:00:00.000Z",
  });
});

test("an available update downloads only after one coalesced user intent", async () => {
  const updater = new FakeUpdater();
  let finishDownload;
  updater.downloadResult = new Promise((resolve) => {
    finishDownload = resolve;
  });
  const { value } = controller({ updater });

  assert.equal((await value.downloadAvailableUpdate()).status, "idle");
  assert.equal(updater.downloadCount, 0);

  updater.emit("update-available", { version: "0.10.0" });
  const first = value.downloadAvailableUpdate();
  const second = value.downloadAvailableUpdate();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updater.downloadCount, 1);
  assert.deepEqual(updater.downloadTargets, ["0.10.0"]);
  assert.equal(value.getStatus().status, "downloading");
  updater.emit("update-downloaded", { version: "0.10.0" });
  finishDownload();
  assert.equal((await first).status, "downloaded");
  assert.equal((await second).status, "downloaded");
});

test("only a downloaded update may start installation", () => {
  const { updater, value } = controller();

  assert.equal(value.installDownloadedUpdate(), false);
  assert.equal(updater.installCount, 0);

  updater.emit("update-downloaded", { version: "0.10.0" });
  assert.equal(value.installDownloadedUpdate(), true);
  assert.equal(updater.installCount, 1);
  assert.equal(value.getStatus().status, "installing");
  assert.equal(value.installDownloadedUpdate(), false);
});

test("disabled environments never contact the release provider", async () => {
  const updater = new FakeUpdater();
  const value = createApplicationUpdateController({
    updater,
    currentVersion: "0.9.0",
    architecture: "arm64",
    enabled: false,
  });

  assert.equal((await value.checkForUpdates()).status, "unsupported");
  assert.equal((await value.downloadAvailableUpdate()).status, "unsupported");
  assert.equal(updater.checkCount, 0);
  assert.equal(updater.downloadCount, 0);
});

test("concurrent checks share one provider request and errors stay unavailable", async () => {
  const updater = new FakeUpdater();
  let rejectCheck;
  updater.checkResult = new Promise((_resolve, reject) => {
    rejectCheck = reject;
  });
  const warnings = [];
  const { value } = controller({
    updater,
    logger: { warn: (...args) => warnings.push(args) },
  });

  const first = value.checkForUpdates();
  const second = value.checkForUpdates();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.checkCount, 1);
  rejectCheck(new Error("provider details"));
  assert.equal((await first).status, "unavailable");
  assert.equal((await second).status, "unavailable");
  assert.equal(warnings.length, 1);
});

test("manual and scheduled checks share one provider request", async () => {
  const updater = new FakeUpdater();
  const checkResult = deferred();
  updater.checkResult = checkResult.promise;
  const timers = [];
  const cancelled = [];
  const { value } = controller({
    updater,
    scheduleTimer: (callback, delay) => {
      const timer = {
        callback,
        delay,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    cancelTimer: (timer) => cancelled.push(timer),
  });

  value.startAutomaticChecks();
  const manual = value.checkForUpdates();
  await flushMicrotasks();
  assert.equal(timers.length, 1);
  assert.equal(updater.checkCount, 1);

  const scheduled = timers[0].callback();
  await flushMicrotasks();
  assert.equal(updater.checkCount, 1);
  updater.emit("update-available", { version: "0.10.0" });
  checkResult.resolve();

  assert.equal((await manual).status, "available");
  await scheduled;
  assert.equal(value.getStatus().status, "available");
  assert.equal(updater.checkCount, 1);
  value.stopAutomaticChecks();
  assert.deepEqual(cancelled, [timers[1]]);
});

test("an available candidate can be refreshed from B to C without downloading", async () => {
  const updater = new FakeUpdater();
  const firstCheck = deferred();
  updater.checkResult = firstCheck.promise;
  const { value } = controller({ updater });

  const first = value.checkForUpdates();
  await flushMicrotasks();
  assert.equal(updater.checkCount, 1);
  updater.emit("update-available", { version: "0.10.0" });
  firstCheck.resolve();
  assert.equal((await first).latestVersion, "0.10.0");

  const secondCheck = deferred();
  updater.checkResult = secondCheck.promise;
  const second = value.checkForUpdates();
  await flushMicrotasks();
  assert.equal(updater.checkCount, 2);
  assert.equal(value.getStatus().status, "checking");
  assert.equal(value.getStatus().latestVersion, "0.10.0");
  updater.emit("update-available", { version: "0.11.0" });
  secondCheck.resolve();

  assert.deepEqual(await second, value.getStatus());
  assert.equal(value.getStatus().status, "available");
  assert.equal(value.getStatus().latestVersion, "0.11.0");
  assert.equal(updater.downloadCount, 0);
});

test("rechecking the same candidate does not trigger duplicate downloads or reminders", async () => {
  const updater = new FakeUpdater();
  const firstCheck = deferred();
  updater.checkResult = firstCheck.promise;
  const statuses = [];
  const { value } = controller({ updater, onStatus: (status) => statuses.push(status) });

  const first = value.checkForUpdates();
  await flushMicrotasks();
  updater.emit("update-available", { version: "0.10.0" });
  firstCheck.resolve();
  await first;

  const repeatedCheck = deferred();
  updater.checkResult = repeatedCheck.promise;
  const repeated = value.checkForUpdates();
  await flushMicrotasks();
  updater.emit("update-available", { version: "0.10.0" });
  repeatedCheck.resolve();
  await repeated;

  assert.deepEqual(
    statuses.map((status) => status.status),
    ["checking", "available", "checking", "available"],
  );
  assert.equal(updater.downloadCount, 0);
  assert.deepEqual(updater.downloadTargets, []);

  const downloadResult = deferred();
  updater.downloadResult = downloadResult.promise;
  const download = value.downloadAvailableUpdate();
  await flushMicrotasks();
  assert.equal(updater.downloadCount, 1);
  assert.deepEqual(updater.downloadTargets, ["0.10.0"]);
  updater.emit("update-downloaded", { version: "0.10.0" });
  downloadResult.resolve();
  await download;
  assert.equal(updater.downloadCount, 1);
});

test("a download click during a check waits for that round's confirmed candidate", async () => {
  const updater = new FakeUpdater();
  const downloadResult = deferred();
  updater.downloadResult = downloadResult.promise;
  const firstCheck = deferred();
  updater.checkResult = firstCheck.promise;
  const { value } = controller({ updater });

  const first = value.checkForUpdates();
  await flushMicrotasks();
  updater.emit("update-available", { version: "0.10.0" });
  firstCheck.resolve();
  await first;

  const secondCheck = deferred();
  updater.checkResult = secondCheck.promise;
  const second = value.checkForUpdates();
  await flushMicrotasks();
  const download = value.downloadAvailableUpdate();
  await flushMicrotasks();
  assert.equal(updater.downloadCount, 0);

  updater.emit("update-available", { version: "0.11.0" });
  secondCheck.resolve();
  await second;
  await flushMicrotasks();
  assert.equal(updater.downloadCount, 1);
  assert.deepEqual(updater.downloadTargets, ["0.11.0"]);
  assert.equal(value.getStatus().status, "downloading");
  assert.equal(value.getStatus().latestVersion, "0.11.0");

  updater.emit("update-downloaded", { version: "0.11.0" });
  downloadResult.resolve();
  assert.equal((await download).status, "downloaded");
  assert.equal(value.getStatus().latestVersion, "0.11.0");
});

test("an explicit no-update result retires the old downloadable candidate", async () => {
  const updater = new FakeUpdater();
  const firstCheck = deferred();
  updater.checkResult = firstCheck.promise;
  const { value } = controller({ updater });

  const first = value.checkForUpdates();
  await flushMicrotasks();
  updater.emit("update-available", { version: "0.10.0" });
  firstCheck.resolve();
  await first;

  const secondCheck = deferred();
  updater.checkResult = secondCheck.promise;
  const second = value.checkForUpdates();
  await flushMicrotasks();
  const download = value.downloadAvailableUpdate();
  updater.emit("update-not-available", { version: "0.9.0" });
  secondCheck.resolve();

  assert.equal((await second).status, "current");
  assert.equal(value.getStatus().latestVersion, null);
  assert.equal((await download).status, "current");
  assert.equal(updater.downloadCount, 0);
});

test("a no-update response with current version metadata does not become a candidate", async () => {
  const updater = new FakeUpdater();
  const { value } = controller({ updater });

  updater.checkResult = Promise.resolve({
    isUpdateAvailable: false,
    updateInfo: { version: "0.9.0" },
  });
  const result = await value.checkForUpdates();

  assert.equal(result.status, "current");
  assert.equal(result.latestVersion, null);
  assert.equal((await value.downloadAvailableUpdate()).status, "current");
  assert.equal(updater.downloadCount, 0);
});

test("a failed refresh is unavailable rather than claiming the old candidate is current", async () => {
  const updater = new FakeUpdater();
  const firstCheck = deferred();
  updater.checkResult = firstCheck.promise;
  const { value } = controller({ updater });

  const first = value.checkForUpdates();
  await flushMicrotasks();
  updater.emit("update-available", { version: "0.10.0" });
  firstCheck.resolve();
  await first;

  const failedCheck = deferred();
  updater.checkResult = failedCheck.promise;
  const second = value.checkForUpdates();
  await flushMicrotasks();
  failedCheck.reject(new Error("network down"));

  const result = await second;
  assert.equal(result.status, "unavailable");
  assert.notEqual(result.status, "current");
  assert.equal(updater.downloadCount, 0);
});

test("a failed check retires an event candidate before a waiting download can start", async () => {
  const updater = new FakeUpdater();
  const firstCheck = deferred();
  updater.checkResult = firstCheck.promise;
  const { value } = controller({ updater });

  const first = value.checkForUpdates();
  await flushMicrotasks();
  updater.emit("update-available", { version: "0.10.0" });
  firstCheck.resolve();
  await first;

  const failedCheck = deferred();
  updater.checkResult = failedCheck.promise;
  const second = value.checkForUpdates();
  await flushMicrotasks();
  const download = value.downloadAvailableUpdate();
  updater.emit("update-available", { version: "0.11.0" });
  failedCheck.reject(new Error("provider disconnected after response"));

  assert.equal((await second).status, "unavailable");
  assert.equal((await download).status, "unavailable");
  assert.equal(updater.downloadCount, 0);
  assert.deepEqual(updater.downloadTargets, []);
});

test("checks during download or after download do not replace the fixed artifact", async () => {
  const updater = new FakeUpdater();
  const downloadResult = deferred();
  updater.downloadResult = downloadResult.promise;
  const { value } = controller({ updater });

  updater.emit("update-available", { version: "0.10.0" });
  const download = value.downloadAvailableUpdate();
  assert.equal(value.getStatus().status, "downloading");
  assert.equal((await value.checkForUpdates()).status, "downloading");
  assert.equal(updater.checkCount, 0);
  await flushMicrotasks();
  assert.deepEqual(updater.downloadTargets, ["0.10.0"]);

  updater.emit("update-downloaded", { version: "0.10.0" });
  downloadResult.resolve();
  await download;
  assert.equal(value.getStatus().status, "downloaded");
  assert.equal((await value.checkForUpdates()).status, "downloaded");
  updater.emit("update-available", { version: "0.11.0" });
  assert.equal(value.getStatus().latestVersion, "0.10.0");
  assert.equal(value.getStatus().status, "downloaded");
});

test("late updater events and results cannot change a disposed controller", async () => {
  const updater = new FakeUpdater();
  const checkResult = deferred();
  updater.checkResult = checkResult.promise;
  const statuses = [];
  const { value } = controller({ updater, onStatus: (status) => statuses.push(status) });

  const check = value.checkForUpdates();
  await flushMicrotasks();
  const beforeDispose = value.getStatus();
  value.dispose();
  updater.emit("update-available", { version: "0.10.0" });
  updater.emit("update-not-available", { version: "0.9.0" });
  checkResult.resolve();

  assert.deepEqual(await check, beforeDispose);
  assert.deepEqual(value.getStatus(), beforeDispose);
  assert.deepEqual(statuses.at(-1), beforeDispose);
});

test("controller releases every updater listener", () => {
  const { updater, value } = controller();

  assert.ok(updater.eventNames().length > 0);
  value.dispose();
  assert.deepEqual(updater.eventNames(), []);
});

test("automatic checks run after startup and then every four hours", async () => {
  const timers = [];
  const cancelled = [];
  const scheduleTimer = (callback, delay) => {
    const timer = {
      callback,
      delay,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      },
    };
    timers.push(timer);
    return timer;
  };
  const { updater, value } = controller({
    scheduleTimer,
    cancelTimer: (timer) => cancelled.push(timer),
  });

  assert.equal(value.startAutomaticChecks(), true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, APPLICATION_UPDATE_INITIAL_DELAY_MS);
  assert.equal(timers[0].unrefCalled, true);

  await timers[0].callback();
  assert.equal(updater.checkCount, 1);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, APPLICATION_UPDATE_INTERVAL_MS);
  assert.equal(timers[1].unrefCalled, true);

  updater.emit("update-available", { version: "0.10.0" });
  await timers[1].callback();
  assert.equal(updater.checkCount, 2);
  assert.equal(timers.length, 3);
  assert.equal(timers[2].delay, APPLICATION_UPDATE_INTERVAL_MS);

  value.stopAutomaticChecks();
  assert.deepEqual(cancelled, [timers[2]]);
});

test("restarting or disposing automatic checks cancels the previous schedule", () => {
  const timers = [];
  const cancelled = [];
  const { value } = controller({
    scheduleTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    cancelTimer: (timer) => cancelled.push(timer),
  });

  value.startAutomaticChecks();
  value.startAutomaticChecks();
  assert.deepEqual(cancelled, [timers[0]]);
  value.dispose();
  assert.deepEqual(cancelled, [timers[0], timers[1]]);
});

test("unsupported builds never schedule automatic checks", () => {
  const timers = [];
  const updater = new FakeUpdater();
  const value = createApplicationUpdateController({
    updater,
    currentVersion: "0.9.0",
    architecture: "arm64",
    enabled: false,
    scheduleTimer: (...args) => timers.push(args),
    cancelTimer() {},
  });

  assert.equal(value.startAutomaticChecks(), false);
  assert.deepEqual(timers, []);
});
