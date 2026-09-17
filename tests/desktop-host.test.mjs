import assert from "node:assert/strict";
import test from "node:test";

import { assertDesktopHost } from "../app/application/desktop-host.js";

function desktopHost() {
  return {
    stemmioRuntime: {
      capabilities: {
        sourceEditing: "enabled",
        projectOpening: "desktop-dialog",
        attachmentPersistence: "bridge",
        closeCoordination: "electron-handshake",
        interactivePreview: "independent-url",
      },
    },
    stemmioProjects: { getActiveProject() {}, openHtml() {} },
    stemmioPreview: { createSession() {}, revokeSession() {} },
    stemmioIntegrations: {
      persistSessionCredential() {},
      clearSessionCredential() {},
      sessionCredentialStatus() {},
      restoreSessionCredential() {},
    },
    stemmioAppLifecycle: {
      onPrepareClose() {},
      onCloseAborted() {},
      reportReady() {},
      reportBlocked() {},
    },
  };
}

test("desktop host assertion accepts the complete preload contract", () => {
  assert.doesNotThrow(() => assertDesktopHost(desktopHost()));
});

test("desktop host assertion fails closed for a malformed manifest", () => {
  const host = desktopHost();
  host.stemmioRuntime.capabilities.projectOpening = "other";
  assert.throws(() => assertDesktopHost(host), /能力声明缺失或无效/u);
});

test("desktop host assertion reports missing required preload functions", () => {
  const host = desktopHost();
  delete host.stemmioPreview.createSession;
  assert.throws(() => assertDesktopHost(host), /stemmioPreview\.createSession/u);
});

test("desktop host assertion fails closed when credential ownership IPC is incomplete", () => {
  const host = desktopHost();
  delete host.stemmioIntegrations.sessionCredentialStatus;
  assert.throws(() => assertDesktopHost(host), /stemmioIntegrations\.sessionCredentialStatus/u);
});
