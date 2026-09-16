const STATUS = new Set(["normal", "processing", "review-ready", "error", "opening"]);

function documentKey(projectId, documentId) {
  return `${projectId}\u0000${documentId}`;
}

function surfaceKey(kind, projectId, documentId) {
  return `${kind}\u0000${documentKey(projectId, documentId)}`;
}

function freezeTab(tab) {
  return Object.freeze({ ...tab });
}

function startTab(tabId = "start:1") {
  return freezeTab({
    tabId,
    kind: "start",
    title: "开始",
    status: "normal",
  });
}

function settingsTab(tabId = "settings:1") {
  return freezeTab({
    tabId,
    kind: "settings",
    title: "设置",
    status: "normal",
  });
}

function normalizedProjectTab(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind || "document");
  if (!["document", "project-rules", "history"].includes(kind)) return null;
  const projectId = String(value.projectId || "");
  const documentId = String(value.documentId || "");
  const tabId = String(value.tabId || "");
  const title = String(value.title || "").trim();
  if (
    !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
    || !/^[A-Za-z0-9:_-]{1,240}$/.test(tabId)
    || !title
    || title.length > 180
  ) return null;
  const versionId = kind === "history" ? String(value.versionId || "") : null;
  const versionOrdinal = kind === "history" ? Number(value.versionOrdinal) : null;
  if (kind === "history" && (!versionId || !Number.isInteger(versionOrdinal) || versionOrdinal < 1)) {
    return null;
  }
  return freezeTab({
    tabId,
    kind,
    projectId,
    documentId,
    title,
    status: STATUS.has(value.status) ? value.status : "normal",
    ...(kind === "history" ? {
      versionId,
      versionOrdinal,
      versionLabel: String(value.versionLabel || `V${versionOrdinal}`),
      displayFileName: String(value.displayFileName || ""),
    } : {}),
  });
}

function frozenSnapshot({
  revision,
  tabs,
  activeTabId,
  pendingTabId,
  mountedDocumentTabId,
  runtimeOwnerTabId,
}) {
  return Object.freeze({
    revision,
    tabs: Object.freeze(tabs.map(freezeTab)),
    activeTabId,
    pendingTabId,
    mountedDocumentTabId,
    runtimeOwnerTabId: runtimeOwnerTabId ?? null,
  });
}

export const INITIAL_WORKBENCH_TABS_SNAPSHOT = frozenSnapshot({
  revision: 0,
  tabs: [startTab()],
  activeTabId: "start:1",
  pendingTabId: null,
  mountedDocumentTabId: null,
  runtimeOwnerTabId: null,
});

export class WorkbenchTabsSession {
  #listeners = new Set();
  #pendingPriorStatus = null;
  #stagedStartReplacement = null;
  #restoredDocumentTabIds = new Set();
  #snapshot = INITIAL_WORKBENCH_TABS_SNAPSHOT;

  get snapshot() {
    return this.#snapshot;
  }

  captureAuthority() {
    return Object.freeze({
      snapshot: this.#snapshot,
      pendingPriorStatus: this.#pendingPriorStatus,
      stagedStartReplacement: this.#stagedStartReplacement,
      restoredDocumentTabIds: Object.freeze([...this.#restoredDocumentTabIds]),
    });
  }

  restoreAuthority(authority) {
    if (!authority?.snapshot || !Array.isArray(authority.snapshot.tabs)) return null;
    this.#pendingPriorStatus = authority.pendingPriorStatus || null;
    this.#stagedStartReplacement = authority.stagedStartReplacement || null;
    this.#restoredDocumentTabIds = new Set(authority.restoredDocumentTabIds || []);
    return this.#publish({ ...authority.snapshot });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("tabs listener is required");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(next) {
    this.#snapshot = frozenSnapshot({
      ...next,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation projection cannot interrupt tab authority.
      }
    }
    return this.#snapshot;
  }

  hydrate(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const seenTabs = new Set();
    const seenSurfaces = new Set();
    const tabs = [];
    for (const candidate of Array.isArray(source.tabs) ? source.tabs : []) {
      const kind = ["document", "project-rules", "history"].includes(candidate?.kind)
        ? candidate.kind
        : "document";
      const tab = normalizedProjectTab({ ...candidate, kind, title: "HTML" });
      if (!tab || seenTabs.has(tab.tabId)) continue;
      const key = surfaceKey(tab.kind, tab.projectId, tab.documentId);
      if (seenSurfaces.has(key)) continue;
      seenTabs.add(tab.tabId);
      seenSurfaces.add(key);
      tabs.push(tab);
    }
    const start = startTab();
    tabs.unshift(start);
    this.#restoredDocumentTabIds = new Set(
      tabs
        .filter((tab) => ["document", "project-rules", "history"].includes(tab.kind))
        .map((tab) => tab.tabId),
    );
    const requestedActive = String(source.activeTabId || "");
    const pendingTabId = tabs.some(
      (tab) => ["document", "project-rules", "history"].includes(tab.kind)
        && tab.tabId === requestedActive,
    ) ? requestedActive : null;
    return this.#publish({
      tabs,
      activeTabId: start.tabId,
      pendingTabId,
      mountedDocumentTabId: null,
      runtimeOwnerTabId: null,
    });
  }

  createStart({ focus = true } = {}) {
    let sequence = 1;
    const ids = new Set(this.#snapshot.tabs.map((tab) => tab.tabId));
    while (ids.has(`start:${sequence}`)) sequence += 1;
    const tab = startTab(`start:${sequence}`);
    const tabs = [...this.#snapshot.tabs, tab];
    return this.#publish({
      tabs,
      activeTabId: focus ? tab.tabId : this.#snapshot.activeTabId,
      pendingTabId: null,
      mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  createSettings({ focus = true } = {}) {
    const existing = this.#snapshot.tabs.find((tab) => tab.kind === "settings");
    if (existing) {
      return this.#publish({
        ...this.#snapshot,
        activeTabId: focus ? existing.tabId : this.#snapshot.activeTabId,
        pendingTabId: null,
        mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
        runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
      });
    }
    let sequence = 1;
    const ids = new Set(this.#snapshot.tabs.map((tab) => tab.tabId));
    while (ids.has(`settings:${sequence}`)) sequence += 1;
    const tab = settingsTab(`settings:${sequence}`);
    return this.#publish({
      tabs: [...this.#snapshot.tabs, tab],
      activeTabId: focus ? tab.tabId : this.#snapshot.activeTabId,
      pendingTabId: null,
      mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  createProjectRules({ projectId, documentId, title, focus = true } = {}) {
    const tab = normalizedProjectTab({
      tabId: `project-rules:${projectId}:${documentId}`,
      kind: "project-rules",
      projectId,
      documentId,
      title,
      status: "normal",
    });
    if (!tab) throw new TypeError("valid project rules tab identity is required");
    const existing = this.#snapshot.tabs.find((item) => (
      item.kind === "project-rules"
      && item.projectId === projectId
      && item.documentId === documentId
    ));
    if (existing) {
      return this.#publish({
        ...this.#snapshot,
        activeTabId: focus ? existing.tabId : this.#snapshot.activeTabId,
        pendingTabId: null,
        mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
        runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
      });
    }
    return this.#publish({
      tabs: [...this.#snapshot.tabs, tab],
      activeTabId: focus ? tab.tabId : this.#snapshot.activeTabId,
      pendingTabId: null,
      mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  createHistory({
    projectId,
    documentId,
    title,
    versionId,
    versionOrdinal,
    versionLabel,
    displayFileName,
    focus = true,
  } = {}) {
    const tab = normalizedProjectTab({
      tabId: `history:${projectId}:${documentId}`,
      kind: "history",
      projectId,
      documentId,
      title,
      versionId,
      versionOrdinal,
      versionLabel,
      displayFileName,
      status: "normal",
    });
    if (!tab) throw new TypeError("valid project history tab identity is required");
    const existingIndex = this.#snapshot.tabs.findIndex((item) => (
      item.kind === "history"
      && item.projectId === projectId
      && item.documentId === documentId
    ));
    // The existing tab names the snapshot that is actually visible. Keep that
    // identity until WorkbenchNavigationWorkflow has loaded and verified the
    // requested replacement, then commit both facts together in commitHistory.
    if (existingIndex >= 0) return this.#snapshot;
    const tabs = [...this.#snapshot.tabs];
    tabs.push(tab);
    return this.#publish({
      ...this.#snapshot,
      tabs,
      activeTabId: focus ? tab.tabId : this.#snapshot.activeTabId,
      pendingTabId: null,
      mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  bindDocument({ projectId, documentId, title, status = "normal", focus = true }) {
    const tab = normalizedProjectTab({
      tabId: `document:${projectId}:${documentId}`,
      kind: "document",
      projectId,
      documentId,
      title,
      status,
    });
    if (!tab) throw new TypeError("valid project/document tab identity is required");
    if (
      this.#stagedStartReplacement
      && this.#stagedStartReplacement.projectId === tab.projectId
      && this.#stagedStartReplacement.documentId === tab.documentId
    ) {
      this.#stagedStartReplacement = tab;
      return this.#snapshot;
    }
    const existingIndex = this.#snapshot.tabs.findIndex((item) => (
      item.kind === "document"
      && item.projectId === tab.projectId
      && item.documentId === tab.documentId
    ));
    const tabs = [...this.#snapshot.tabs];
    const resolved = existingIndex >= 0
      ? freezeTab({ ...tabs[existingIndex], title: tab.title, status: tab.status })
      : tab;
    const activeStartIndex = focus
      ? tabs.findIndex((item) => (
        item.tabId === this.#snapshot.activeTabId && item.kind === "start"
      ))
      : -1;
    if (existingIndex >= 0 && activeStartIndex >= 0) {
      tabs[existingIndex] = resolved;
      tabs.splice(activeStartIndex, 1);
    } else if (existingIndex >= 0) {
      tabs[existingIndex] = resolved;
    } else if (activeStartIndex >= 0) {
      // Browser behavior: opening from the active blank page converts that
      // one tab into the document. Other explicitly-created Start tabs remain.
      tabs.splice(activeStartIndex, 1, resolved);
    } else tabs.push(resolved);
    this.#restoredDocumentTabIds.delete(resolved.tabId);
    const shouldFocus = focus;
    return this.#publish({
      tabs,
      activeTabId: shouldFocus ? resolved.tabId : this.#snapshot.activeTabId,
      pendingTabId: shouldFocus ? null : this.#snapshot.pendingTabId,
      mountedDocumentTabId: shouldFocus
        ? resolved.tabId
        : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: resolved.tabId,
    });
  }

  stageDocument({ projectId, documentId, title, status = "normal" }) {
    const tab = normalizedProjectTab({
      tabId: `document:${projectId}:${documentId}`,
      kind: "document",
      projectId,
      documentId,
      title,
      status,
    });
    if (!tab) throw new TypeError("valid project/document tab identity is required");
    const existing = this.#snapshot.tabs.find((item) => (
      item.kind === "document"
      && item.projectId === projectId
      && item.documentId === documentId
    ));
    const activeStart = this.#snapshot.tabs.find((item) => (
      item.tabId === this.#snapshot.activeTabId && item.kind === "start"
    ));
    if (existing && !activeStart) return existing;
    if (activeStart) {
      if (this.#stagedStartReplacement) return null;
      this.#stagedStartReplacement = existing || tab;
      return this.#stagedStartReplacement;
    }
    this.#publish({ ...this.#snapshot, tabs: [...this.#snapshot.tabs, tab] });
    return tab;
  }

  resolveTab(tabId) {
    return this.#snapshot.tabs.find((tab) => tab.tabId === tabId)
      || (this.#stagedStartReplacement?.tabId === tabId
        ? this.#stagedStartReplacement
        : null);
  }

  discardUnstartedDocument(tabId) {
    if (
      this.#stagedStartReplacement?.tabId === tabId
      && this.#snapshot.pendingTabId !== tabId
    ) {
      this.#stagedStartReplacement = null;
      return true;
    }
    return false;
  }

  beginSwitch(tabId, { force = false } = {}) {
    const target = this.resolveTab(tabId);
    if (!target) return null;
    if (
      target.kind === "start"
      || target.kind === "settings"
      || target.kind === "project-rules"
      || target.kind === "history"
    ) return this.#publish({
      ...this.#snapshot,
      pendingTabId: target.tabId,
    });
    if (target.tabId === this.#snapshot.activeTabId && !force) return this.#snapshot;
    this.#pendingPriorStatus = target.status;
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => (
        tab.tabId === target.tabId ? freezeTab({ ...tab, status: "opening" }) : tab
      )),
      pendingTabId: target.tabId,
    });
  }

  commitStart(tabId) {
    const target = this.#snapshot.tabs.find((tab) => tab.tabId === tabId && tab.kind === "start");
    if (!target || this.#snapshot.pendingTabId !== tabId) return null;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: null,
    });
  }

  commitSettings(tabId) {
    const target = this.#snapshot.tabs.find((tab) => tab.tabId === tabId && tab.kind === "settings");
    if (!target || this.#snapshot.pendingTabId !== tabId) return null;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: null,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  commitProjectRules(tabId) {
    const target = this.#snapshot.tabs.find(
      (tab) => tab.tabId === tabId && tab.kind === "project-rules",
    );
    if (!target || this.#snapshot.pendingTabId !== tabId) return null;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: null,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  commitHistory(tabId, version = null) {
    const target = this.#snapshot.tabs.find(
      (tab) => tab.tabId === tabId && tab.kind === "history",
    );
    if (!target || this.#snapshot.pendingTabId !== tabId) return null;
    const committedTarget = version
      ? normalizedProjectTab({
        ...target,
        versionId: version.versionId,
        versionOrdinal: version.versionOrdinal,
        versionLabel: version.versionLabel,
        displayFileName: version.displayFileName,
      })
      : target;
    if (
      !committedTarget
      || committedTarget.tabId !== target.tabId
      || committedTarget.projectId !== target.projectId
      || committedTarget.documentId !== target.documentId
    ) return null;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => (
        tab.tabId === tabId ? committedTarget : tab
      )),
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: null,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  commitDocument({ tabId, projectId, documentId, title }) {
    const target = this.resolveTab(tabId);
    if (
      !target || target.projectId !== projectId || target.documentId !== documentId
      || this.#snapshot.pendingTabId !== tabId
    ) return null;
    this.#restoredDocumentTabIds.delete(tabId);
    this.#pendingPriorStatus = null;
    if (this.#stagedStartReplacement?.tabId === tabId) {
      const activeStartIndex = this.#snapshot.tabs.findIndex((tab) => (
        tab.tabId === this.#snapshot.activeTabId && tab.kind === "start"
      ));
      if (activeStartIndex < 0) return null;
      const tabs = [...this.#snapshot.tabs];
      const existingTargetIndex = tabs.findIndex((tab) => tab.tabId === tabId);
      const committedTarget = freezeTab({
        ...target,
        title: String(title || target.title),
        status: "normal",
      });
      if (existingTargetIndex >= 0) {
        tabs[existingTargetIndex] = committedTarget;
        tabs.splice(activeStartIndex, 1);
      } else {
        tabs.splice(activeStartIndex, 1, committedTarget);
      }
      this.#stagedStartReplacement = null;
      return this.#publish({
        ...this.#snapshot,
        tabs,
        activeTabId: tabId,
        pendingTabId: null,
        mountedDocumentTabId: tabId,
        runtimeOwnerTabId: tabId,
      });
    }
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => tab.tabId === tabId
        ? freezeTab({ ...tab, title: String(title || tab.title), status: "normal" })
        : tab),
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: tabId,
      runtimeOwnerTabId: tabId,
    });
  }

  cancelSwitch(tabId) {
    if (this.#snapshot.pendingTabId !== tabId) return this.#snapshot;
    const priorStatus = this.#pendingPriorStatus;
    this.#pendingPriorStatus = null;
    if (this.#stagedStartReplacement?.tabId === tabId) {
      this.#stagedStartReplacement = null;
    }
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => (
        tab.tabId === tabId && tab.status === "opening"
          ? freezeTab({ ...tab, status: STATUS.has(priorStatus) ? priorStatus : "normal" })
          : tab
      )),
      pendingTabId: null,
    });
  }

  updateStatus(projectId, documentId, status) {
    if (!STATUS.has(status)) return this.#snapshot;
    let changed = false;
    const tabs = this.#snapshot.tabs.map((tab) => {
      if (
        !["document", "project-rules", "history"].includes(tab.kind)
        || tab.projectId !== projectId
        || tab.documentId !== documentId
        || tab.status === status
      ) return tab;
      changed = true;
      return freezeTab({ ...tab, status });
    });
    return changed ? this.#publish({ ...this.#snapshot, tabs }) : this.#snapshot;
  }

  updateTitle(projectId, documentId, title) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) return this.#snapshot;
    let changed = false;
    const tabs = this.#snapshot.tabs.map((tab) => {
      if (
        !["document", "project-rules", "history"].includes(tab.kind)
        || tab.projectId !== projectId
        || tab.documentId !== documentId
        || tab.title === normalizedTitle
      ) return tab;
      changed = true;
      return freezeTab({ ...tab, title: normalizedTitle });
    });
    return changed ? this.#publish({ ...this.#snapshot, tabs }) : this.#snapshot;
  }

  reconcileRegisteredProjects(projects) {
    const registry = new Map();
    for (const project of Array.isArray(projects) ? projects : []) {
      if (!project || typeof project !== "object") continue;
      const projectId = String(project.projectId || "");
      const documentId = String(project.documentId || "");
      if (!projectId || !documentId) continue;
      registry.set(documentKey(projectId, documentId), project);
    }
    const missing = [];
    let changed = false;
    const tabs = this.#snapshot.tabs.flatMap((tab) => {
      if (!["document", "project-rules", "history"].includes(tab.kind)
        || !this.#restoredDocumentTabIds.has(tab.tabId)) {
        return [tab];
      }
      const project = registry.get(documentKey(tab.projectId, tab.documentId));
      if (!project || project.availability !== "ready") {
        missing.push(tab);
        this.#restoredDocumentTabIds.delete(tab.tabId);
        changed = true;
        return [];
      }
      const title = String(project.projectName || "").trim();
      if (!title || title === tab.title) return [tab];
      changed = true;
      return [freezeTab({ ...tab, title })];
    });
    if (!changed) return Object.freeze({ snapshot: this.#snapshot, missing: Object.freeze([]) });
    if (!tabs.some((tab) => tab.kind === "start")) tabs.unshift(startTab());
    const activeStillExists = tabs.some((tab) => tab.tabId === this.#snapshot.activeTabId);
    const activeTabId = activeStillExists
      ? this.#snapshot.activeTabId
      : tabs.find((tab) => tab.kind === "start")?.tabId || tabs[0].tabId;
    const pendingTabId = tabs.some((tab) => tab.tabId === this.#snapshot.pendingTabId)
      ? this.#snapshot.pendingTabId
      : null;
    const snapshot = this.#publish({
      ...this.#snapshot,
      tabs,
      activeTabId,
      pendingTabId,
      mountedDocumentTabId: tabs.some((tab) => tab.tabId === this.#snapshot.mountedDocumentTabId)
        ? this.#snapshot.mountedDocumentTabId
        : null,
    });
    return Object.freeze({ snapshot, missing: Object.freeze(missing) });
  }

  close(tabId) {
    const index = this.#snapshot.tabs.findIndex((tab) => tab.tabId === tabId);
    if (index < 0) return Object.freeze({ snapshot: this.#snapshot, nextTabId: null });
    this.#restoredDocumentTabIds.delete(tabId);
    const tabs = this.#snapshot.tabs.filter((tab) => tab.tabId !== tabId);
    if (!tabs.length) tabs.push(startTab());
    const wasActive = this.#snapshot.activeTabId === tabId;
    const next = wasActive ? tabs[Math.min(index, tabs.length - 1)] : null;
    const snapshot = this.#publish({
      tabs,
      activeTabId: wasActive ? next.tabId : this.#snapshot.activeTabId,
      pendingTabId: this.#snapshot.pendingTabId === tabId ? null : this.#snapshot.pendingTabId,
      mountedDocumentTabId: wasActive
        ? (next.kind === "document" ? null : null)
        : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId === tabId
        ? null
        : this.#snapshot.runtimeOwnerTabId,
    });
    return Object.freeze({ snapshot, nextTabId: next?.tabId || null });
  }

  serialize() {
    return Object.freeze({
      version: 2,
      activeTabId: this.#snapshot.tabs.find((tab) => (
        tab.tabId === this.#snapshot.activeTabId
        && ["document", "project-rules", "history"].includes(tab.kind)
      )) ? this.#snapshot.activeTabId : null,
      tabs: Object.freeze(this.#snapshot.tabs
        .filter((tab) => ["document", "project-rules", "history"].includes(tab.kind))
        .map((tab) => Object.freeze({
          tabId: tab.tabId,
          kind: tab.kind,
          projectId: tab.projectId,
          documentId: tab.documentId,
          ...(tab.kind === "history" ? {
            versionId: tab.versionId,
            versionOrdinal: tab.versionOrdinal,
          } : {}),
        }))),
    });
  }

}

export function projectAppliedEventToWorkbenchTabs({ session, event, title }) {
  if (
    !session
    || !event
    || event.type !== "project-applied"
    || !event.project
  ) return null;
  const projectId = String(event.project.projectId || "");
  const documentId = String(event.project.documentId || "");
  const tabTitle = String(title || event.project.name || "").trim();
  if (
    !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
    || !tabTitle
  ) return null;
  const activeTab = session.resolveTab(session.snapshot.activeTabId);
  return session.bindDocument({
    projectId,
    documentId,
    title: tabTitle,
    status: event.activeLocked === true ? "processing" : "normal",
    // A pending registered-tab activation is committed only by
    // WorkbenchNavigationWorkflow after its Controller identity check. The event
    // still refreshes/stages that exact identity, but never impersonates the
    // workflow's commit.
    focus: !session.snapshot.pendingTabId
      && !["project-rules", "history"].includes(activeTab?.kind),
  });
}

export function reconcileWorkbenchTabsWhenReady({
  session,
  tabsPersistenceReady,
  registeredProjectsReady,
  registeredProjects,
}) {
  if (
    !session
    || !tabsPersistenceReady
    || !registeredProjectsReady
  ) return null;
  return session.reconcileRegisteredProjects(registeredProjects);
}
