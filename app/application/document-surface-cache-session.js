// Complete HTML stays byte-bounded. Per-tab reading state is kept separately
// so evicting a heavy source projection does not also erase scroll or mode.
const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_PRESENTATION_CONTEXT_CHARS = 64 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export function documentSurfaceCacheToken(value) {
  const tabId = String(value?.tabId || "");
  const sourceSha256 = String(value?.sourceSha256 || "");
  if (!tabId || !sourceSha256) return null;
  return Object.freeze({ tabId, sourceSha256 });
}

export function sameDocumentSurfaceCacheToken(left, right) {
  return Boolean(
    left
    && right
    && left.tabId === right.tabId
    && left.sourceSha256 === right.sourceSha256,
  );
}

export function documentSurfaceCacheEntryMatchesToken(entry, token) {
  return Boolean(
    entry
    && token
    && entry.tabId === token.tabId
    && entry.sourceSha256 === token.sourceSha256
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function presentationContext(value) {
  if (!value || typeof value !== "object") return { value: null, bytes: 0 };
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length > MAX_PRESENTATION_CONTEXT_CHARS) {
      return { value: null, bytes: 0 };
    }
    return { value: deepFreeze(JSON.parse(encoded)), bytes: 2 * encoded.length };
  } catch {
    return { value: null, bytes: 0 };
  }
}

function exactPresentation(presentation, identity) {
  return Boolean(
    presentation
    && presentation.projectId === identity.projectId
    && presentation.documentId === identity.documentId
    && presentation.sourceSha256 === identity.sourceSha256,
  );
}

function normalizedPresentation(identity, previous, value = {}) {
  const base = exactPresentation(previous, identity) ? previous : null;
  const owns = (key) => Object.prototype.hasOwnProperty.call(value, key);
  const context = owns("pageViewContext")
    ? presentationContext(value.pageViewContext)
    : {
        value: base?.pageViewContext || null,
        bytes: base?.byteLength || 0,
      };
  return {
    tabId: identity.tabId,
    projectId: identity.projectId,
    documentId: identity.documentId,
    sourceSha256: identity.sourceSha256,
    canvasMode: owns("canvasMode")
      ? (value.canvasMode === "preview" ? "preview" : "edit")
      : base?.canvasMode || "edit",
    pageViewContext: context.value,
    scrollTop: owns("scrollTop") && Number.isFinite(Number(value.scrollTop))
      ? Math.max(0, Number(value.scrollTop))
      : base?.scrollTop || 0,
    byteLength: context.bytes,
  };
}

function freezePresentation(presentation) {
  return Object.freeze({
    tabId: presentation.tabId,
    projectId: presentation.projectId,
    documentId: presentation.documentId,
    sourceSha256: presentation.sourceSha256,
    canvasMode: presentation.canvasMode,
    pageViewContext: presentation.pageViewContext,
    scrollTop: presentation.scrollTop,
    byteLength: presentation.byteLength,
  });
}

function freezeEntry(entry, presentation) {
  return Object.freeze({
    tabId: entry.tabId,
    projectId: entry.projectId,
    documentId: entry.documentId,
    sourcePath: entry.sourcePath,
    sourceSha256: entry.sourceSha256,
    html: entry.html,
    canvasMode: presentation?.canvasMode || "edit",
    pageViewContext: presentation?.pageViewContext || null,
    scrollTop: presentation?.scrollTop || 0,
    byteLength: entry.contentBytes,
  });
}

function frozenSnapshot(revision, entries, presentations, tabIds, totalBytes, limits) {
  const presentationByTabId = new Map(presentations.map((value) => [value.tabId, value]));
  const entryIds = new Set(entries.map((entry) => entry.tabId));
  return Object.freeze({
    revision,
    entries: Object.freeze(entries.map((entry) => {
      const presentation = presentationByTabId.get(entry.tabId);
      return freezeEntry(entry, exactPresentation(presentation, entry) ? presentation : null);
    })),
    presentations: Object.freeze(presentations.map(freezePresentation)),
    coldTabIds: Object.freeze(tabIds.filter((tabId) => !entryIds.has(tabId))),
    totalBytes,
    presentationBytes: presentations.reduce((total, value) => total + value.byteLength, 0),
    limits: Object.freeze({ ...limits }),
  });
}

export const INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT = frozenSnapshot(
  0,
  [],
  [],
  [],
  0,
  {
    maxEntries: DEFAULT_MAX_ENTRIES,
    maxBytes: DEFAULT_MAX_BYTES,
  },
);

/**
 * Owns disposable, read-only tab source projections and exact-version reading
 * state. Entries never authorize editing, persistence or source transitions;
 * every activation still reopens and validates through ProjectWorkflow.
 */
export class DocumentSurfaceCacheSession {
  #listeners = new Set();
  #entries = new Map();
  #presentations = new Map();
  #tabIds = [];
  #totalBytes = 0;
  #revision = 0;
  #snapshot = INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT;
  #maxEntries;
  #maxBytes;

  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
  } = {}) {
    this.#maxEntries = Math.max(1, Math.round(Number(maxEntries)) || 1);
    this.#maxBytes = Math.max(1, Math.round(Number(maxBytes)) || 1);
    this.#snapshot = frozenSnapshot(0, [], [], [], 0, {
      maxEntries: this.#maxEntries,
      maxBytes: this.#maxBytes,
    });
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("surface cache listener is required");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  capture({ tab, project, document, presentation = {} } = {}) {
    const tabId = String(tab?.tabId || "");
    const projectId = String(project?.projectId || "");
    const documentId = String(project?.documentId || "");
    const sourcePath = String(project?.sourcePath || "");
    const sourceSha256 = String(document?.persistedSourceSha256 || "");
    const html = typeof document?.html === "string" ? document.html : null;
    if (
      tab?.kind !== "document"
      || tab.projectId !== projectId
      || tab.documentId !== documentId
      || !tabId
      || !SHA256.test(sourceSha256)
      || html === null
      || Number(document?.editRevision) !== Number(document?.lastPersistedRevision)
      || document?.persistState !== "idle"
      || document?.hasPendingWrite === true
      || document?.isFlushing === true
      || document?.canvasAuthority?.status !== "verified"
      || document.canvasAuthority.renderedSha256 !== sourceSha256
    ) return null;

    if (!this.#tabIds.includes(tabId)) this.#tabIds = [...this.#tabIds, tabId];
    const identity = { tabId, projectId, documentId, sourceSha256 };
    this.#presentations.set(tabId, normalizedPresentation(
      identity,
      this.#presentations.get(tabId),
      presentation,
    ));

    const previous = this.#entries.get(tabId);
    if (previous) this.#totalBytes -= previous.contentBytes;
    this.#entries.delete(tabId);
    const contentBytes = Math.max(1, 2 * html.length + 2 * sourcePath.length + 512);
    this.#entries.set(tabId, {
      ...identity,
      sourcePath,
      html,
      contentBytes,
    });
    this.#totalBytes += contentBytes;
    this.#evict();
    this.#publish();
    return this.#snapshot.entries.find((candidate) => candidate.tabId === tabId) || null;
  }

  touch(tabId) {
    const id = String(tabId || "");
    const entry = this.#entries.get(id);
    if (!entry) return null;
    this.#entries.delete(id);
    this.#entries.set(id, entry);
    this.#publish();
    return this.#snapshot.entries.find((candidate) => candidate.tabId === id) || null;
  }

  updatePresentation(tabId, presentation = {}, identity = {}) {
    const id = String(tabId || "");
    const entry = this.#entries.get(id);
    const previous = this.#presentations.get(id);
    const requestedIdentity = {
      projectId: String(identity?.projectId || ""),
      documentId: String(identity?.documentId || ""),
      sourceSha256: String(identity?.sourceSha256 || ""),
    };
    const sourceIdentity = requestedIdentity.projectId
      && requestedIdentity.documentId
      && SHA256.test(requestedIdentity.sourceSha256)
      ? requestedIdentity
      : entry;
    const nextIdentity = {
      tabId: id,
      projectId: String(sourceIdentity?.projectId || ""),
      documentId: String(sourceIdentity?.documentId || ""),
      sourceSha256: String(sourceIdentity?.sourceSha256 || ""),
    };
    if (
      !id
      || !nextIdentity.projectId
      || !nextIdentity.documentId
      || !SHA256.test(nextIdentity.sourceSha256)
    ) return null;
    this.#presentations.set(
      id,
      normalizedPresentation(nextIdentity, previous, presentation),
    );
    this.#publish();
    return this.#snapshot.presentations.find((candidate) => candidate.tabId === id) || null;
  }

  updatePresentationForToken(token, presentation = {}) {
    const id = String(token?.tabId || "");
    const sourceSha256 = String(token?.sourceSha256 || "");
    const entry = this.#entries.get(id);
    if (!documentSurfaceCacheEntryMatchesToken(entry, { tabId: id, sourceSha256 })) {
      return null;
    }
    return this.updatePresentation(id, presentation, entry);
  }

  remove(tabId) {
    const id = String(tabId || "");
    const entry = this.#entries.get(id);
    const hadPresentation = this.#presentations.delete(id);
    if (!entry && !hadPresentation) return false;
    if (entry) {
      this.#entries.delete(id);
      this.#totalBytes -= entry.contentBytes;
    }
    this.#publish();
    return true;
  }

  reconcile(tabIds) {
    const normalizedTabIds = Array.isArray(tabIds) ? tabIds.map(String) : [];
    const retained = new Set(normalizedTabIds);
    let changed = normalizedTabIds.length !== this.#tabIds.length
      || normalizedTabIds.some((tabId, index) => this.#tabIds[index] !== tabId);
    this.#tabIds = normalizedTabIds;
    for (const [tabId, entry] of this.#entries) {
      if (retained.has(tabId)) continue;
      this.#entries.delete(tabId);
      this.#totalBytes -= entry.contentBytes;
      changed = true;
    }
    for (const tabId of this.#presentations.keys()) {
      if (retained.has(tabId)) continue;
      this.#presentations.delete(tabId);
      changed = true;
    }
    if (changed) this.#publish();
    return this.#snapshot;
  }

  clear() {
    if (!this.#entries.size && !this.#presentations.size && !this.#tabIds.length) return;
    this.#entries.clear();
    this.#presentations.clear();
    this.#tabIds = [];
    this.#totalBytes = 0;
    this.#publish();
  }

  dispose() {
    this.clear();
    this.#listeners.clear();
  }

  #evict() {
    while (
      this.#entries.size > this.#maxEntries
      || this.#totalBytes > this.#maxBytes
    ) {
      const oldestId = this.#entries.keys().next().value;
      if (!oldestId) break;
      const oldest = this.#entries.get(oldestId);
      this.#entries.delete(oldestId);
      this.#totalBytes -= oldest?.contentBytes || 0;
    }
  }

  #publish() {
    this.#revision += 1;
    this.#snapshot = frozenSnapshot(
      this.#revision,
      [...this.#entries.values()],
      [...this.#presentations.values()],
      this.#tabIds,
      this.#totalBytes,
      {
        maxEntries: this.#maxEntries,
        maxBytes: this.#maxBytes,
      },
    );
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // A presentation subscriber cannot affect cache ownership.
      }
    }
  }
}
