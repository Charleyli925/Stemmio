const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
export const APPLICATION_UPDATE_INITIAL_DELAY_MS = 5_000;
export const APPLICATION_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1_000;

function publicVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return VERSION_PATTERN.test(normalized) ? normalized : null;
}

function publicPublishedAt(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function publicProgress(value) {
  const percent = Number(value?.percent);
  if (!Number.isFinite(percent)) return null;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

export function createApplicationUpdateController({
  updater,
  currentVersion,
  architecture,
  enabled,
  onStatus = () => {},
  logger = console,
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  if (
    !updater
    || typeof updater.on !== "function"
    || typeof updater.removeListener !== "function"
    || typeof updater.checkForUpdates !== "function"
    || typeof updater.downloadUpdate !== "function"
    || typeof updater.quitAndInstall !== "function"
  ) {
    throw new TypeError("A compatible electron-updater instance is required.");
  }

  const normalizedCurrentVersion = publicVersion(currentVersion);
  if (!normalizedCurrentVersion) {
    throw new TypeError("A semantic currentVersion is required.");
  }
  if (typeof architecture !== "string" || !architecture) {
    throw new TypeError("An architecture is required.");
  }
  if (typeof scheduleTimer !== "function" || typeof cancelTimer !== "function") {
    throw new TypeError("Compatible timer functions are required.");
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = false;

  let status = Object.freeze({
    status: enabled ? "idle" : "unsupported",
    currentVersion: normalizedCurrentVersion,
    latestVersion: null,
    architecture,
    downloadPercent: null,
    publishedAt: null,
  });
  let checkPromise = null;
  let activeCheck = null;
  let downloadPromise = null;
  let downloadTargetVersion = null;
  let automaticCheckTimer = null;
  let automaticCheckGeneration = 0;
  let disposed = false;

  const publish = (nextStatus, patch = {}) => {
    if (disposed) return status;
    status = Object.freeze({
      ...status,
      ...patch,
      status: nextStatus,
    });
    onStatus(status);
    return status;
  };

  const updateInfoPatch = (info, { preserve = false } = {}) => {
    const version = publicVersion(info?.version);
    const publishedAt = publicPublishedAt(info?.releaseDate);
    return {
      latestVersion: version || (preserve ? status.latestVersion : null),
      publishedAt: publishedAt || (preserve ? status.publishedAt : null),
    };
  };

  const isDownloadLocked = () => (
    status.status === "downloading"
    || status.status === "downloaded"
    || status.status === "installing"
  );

  const beginCheck = () => {
    const round = {
      outcome: "pending",
    };
    activeCheck = round;
    return round;
  };

  const markCheckOutcome = (outcome) => {
    if (!activeCheck) return;
    activeCheck.outcome = outcome;
  };

  const canDownloadCandidate = () => (
    status.status === "available"
    && Boolean(publicVersion(status.latestVersion))
  );

  const listeners = new Map([
    ["checking-for-update", () => {
      if (disposed || isDownloadLocked()) return;
      if (!activeCheck || !checkPromise) beginCheck();
      if (status.status === "checking") return;
      publish("checking", {
        downloadPercent: null,
      });
    }],
    ["update-available", (info) => {
      if (disposed || isDownloadLocked()) return;
      const version = publicVersion(info?.version);
      if (!version) {
        markCheckOutcome("unavailable");
        publish("unavailable", { downloadPercent: null });
        return;
      }
      markCheckOutcome("available");
      publish("available", {
        ...updateInfoPatch(info),
        downloadPercent: null,
      });
    }],
    ["download-progress", (progress) => {
      if (
        disposed
        || !["available", "downloading"].includes(status.status)
      ) return;
      publish("downloading", {
        downloadPercent: publicProgress(progress),
      });
    }],
    ["update-downloaded", (info) => {
      if (disposed || status.status === "checking" || status.status === "installing") return;
      const version = publicVersion(info?.version);
      if (
        downloadTargetVersion
        && version
        && version !== downloadTargetVersion
      ) return;
      downloadTargetVersion = version || downloadTargetVersion || status.latestVersion;
      publish("downloaded", {
        ...updateInfoPatch(info, { preserve: true }),
        downloadPercent: 100,
      });
    }],
    ["update-not-available", () => {
      if (disposed || isDownloadLocked()) return;
      markCheckOutcome("current");
      publish("current", {
        latestVersion: null,
        publishedAt: null,
        downloadPercent: null,
      });
    }],
    ["update-cancelled", () => {
      if (disposed || status.status === "downloaded" || status.status === "installing") return;
      markCheckOutcome("unavailable");
      downloadTargetVersion = null;
      publish("unavailable", { downloadPercent: null });
    }],
    ["error", (error) => {
      if (disposed || status.status === "downloaded") return;
      logger.warn(
        "[application-update:unavailable]",
        error instanceof Error ? error.message : String(error),
      );
      markCheckOutcome("unavailable");
      downloadTargetVersion = null;
      publish("unavailable", { downloadPercent: null });
    }],
  ]);

  for (const [eventName, listener] of listeners) {
    updater.on(eventName, listener);
  }

  async function checkForUpdates() {
    if (!enabled || disposed) return status;
    if (isDownloadLocked()) return status;
    if (checkPromise) return checkPromise;
    const round = beginCheck();
    const request = Promise.resolve()
      .then(() => {
        if (disposed) return null;
        return updater.checkForUpdates();
      })
      .then((result) => {
        if (disposed || activeCheck !== round || round.outcome !== "pending") {
          return status;
        }
        const updateInfo = result?.updateInfo;
        if (result?.isUpdateAvailable === false) {
          listeners.get("update-not-available")(updateInfo);
        } else if (publicVersion(updateInfo?.version)) {
          listeners.get("update-available")(updateInfo);
        } else {
          listeners.get("error")(
            new Error("The updater returned no usable update result."),
          );
        }
        return status;
      })
      .catch((error) => {
        if (
          !disposed
          && activeCheck === round
          && round.outcome !== "unavailable"
        ) {
          listeners.get("error")(error);
        }
        return status;
      })
      .finally(() => {
        if (checkPromise === request) checkPromise = null;
        if (activeCheck === round) activeCheck = null;
      });
    checkPromise = request;
    if (status.status !== "checking") {
      publish("checking", { downloadPercent: null });
    }
    return request;
  }

  async function downloadAvailableUpdate() {
    if (!enabled || disposed) return status;
    if (downloadPromise) return downloadPromise;
    const pendingCheck = checkPromise;
    const pendingRound = activeCheck;
    if (!pendingCheck && !canDownloadCandidate()) return status;
    if (!pendingCheck) {
      downloadTargetVersion = status.latestVersion;
      publish("downloading", { downloadPercent: 0 });
    }
    downloadPromise = Promise.resolve()
      .then(async () => {
        if (pendingCheck) {
          await pendingCheck;
          if (
            disposed
            || pendingRound?.outcome !== "available"
          ) return status;
          if (disposed || !canDownloadCandidate()) return status;
          downloadTargetVersion = status.latestVersion;
          publish("downloading", { downloadPercent: 0 });
        } else if (disposed || status.status !== "downloading") {
          return status;
        }
        await updater.downloadUpdate();
        return status;
      })
      .catch((error) => {
        if (!disposed && status.status !== "unavailable") {
          listeners.get("error")(error);
        }
        return status;
      })
      .finally(() => {
        if (downloadPromise) downloadPromise = null;
      });
    return downloadPromise;
  }

  function stopAutomaticChecks() {
    automaticCheckGeneration += 1;
    if (automaticCheckTimer) {
      cancelTimer(automaticCheckTimer);
      automaticCheckTimer = null;
    }
  }

  function startAutomaticChecks({
    initialDelayMs = APPLICATION_UPDATE_INITIAL_DELAY_MS,
    intervalMs = APPLICATION_UPDATE_INTERVAL_MS,
  } = {}) {
    if (
      !Number.isSafeInteger(initialDelayMs)
      || initialDelayMs < 0
      || !Number.isSafeInteger(intervalMs)
      || intervalMs <= 0
    ) {
      throw new TypeError("Automatic update delays must be safe positive integers.");
    }
    stopAutomaticChecks();
    if (!enabled || disposed) return false;
    const generation = automaticCheckGeneration;
    const scheduleNext = (delayMs) => {
      automaticCheckTimer = scheduleTimer(async () => {
        automaticCheckTimer = null;
        await checkForUpdates();
        if (automaticCheckGeneration !== generation) return;
        scheduleNext(intervalMs);
      }, delayMs);
      automaticCheckTimer?.unref?.();
    };
    scheduleNext(initialDelayMs);
    return true;
  }

  function installDownloadedUpdate() {
    if (disposed || status.status !== "downloaded") return false;
    const downloadedStatus = status;
    publish("installing", { downloadPercent: 100 });
    try {
      updater.quitAndInstall();
      return true;
    } catch (error) {
      if (disposed) return false;
      status = downloadedStatus;
      onStatus(status);
      throw error;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopAutomaticChecks();
    for (const [eventName, listener] of listeners) {
      updater.removeListener(eventName, listener);
    }
  }

  return Object.freeze({
    checkForUpdates,
    downloadAvailableUpdate,
    dispose,
    getStatus: () => status,
    installDownloadedUpdate,
    startAutomaticChecks,
    stopAutomaticChecks,
  });
}
