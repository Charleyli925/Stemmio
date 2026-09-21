export function registerUpdateIpc({
  ipcMain,
  trustedProject,
  UPDATE_CHANNELS,
  getLatestUpdateResult,
  checkForApplicationUpdates,
  downloadApplicationUpdate,
  ensureApplicationUpdateController,
  coordinateApplicationUpdateInstall,
  openLatestRelease,
  openPublicReleases,
}) {
  ipcMain.handle(
    UPDATE_CHANNELS.getStatus,
    trustedProject(() => getLatestUpdateResult(), "update_get_status"),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.checkNow,
    trustedProject(checkForApplicationUpdates),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.downloadAvailable,
    trustedProject(downloadApplicationUpdate),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.installDownloaded,
    trustedProject(async () => {
      if (
        ensureApplicationUpdateController().getStatus().status
        !== "downloaded"
      ) {
        return { installing: false, reason: "not-ready" };
      }
      const installing = await coordinateApplicationUpdateInstall(
        "update-install",
      );
      return {
        installing,
        reason: installing ? null : "close-blocked",
      };
    }, "update_install"),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.openLatestRelease,
    trustedProject(openLatestRelease),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.openPublicReleases,
    trustedProject(openPublicReleases),
  );
}

export function unregisterUpdateIpc({ ipcMain, UPDATE_CHANNELS }) {
  for (const channel of Object.values(UPDATE_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
