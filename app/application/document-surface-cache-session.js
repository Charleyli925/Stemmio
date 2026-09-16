// A live iframe is materially more expensive than its source string. Keep only
// the five most recent projections mounted, while retaining enough byte-bounded
// source projections for a realistic 20-tab workbench to avoid a cold flash.
const DEFAULT_MAX_HOT_ENTRIES = 5;
const DEFAULT_MAX_WARM_ENTRIES = 20;
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
    && entry.tier === "hot"
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

function freezeEntry(entry, hot) {
  return Object.freeze({
    tabId: entry.tabId,
    projectId: entry.projectId,
    documentId: entry.documentId,
    sourcePath: entry.sourcePath,
    sourceSha256: entry.sourceSha256,
    html: entry.html,
    canvasMode: entry.canvasMode,
    pageViewContext: entry.pageViewContext,
    scrollTop: entry.scrollTop,
    byteLength: entry.byteLength,
    tier: hot ? "hot" : "warm",
  });
}

function frozenSnapshot(revision, entries, hotIds, tabIds, totalBytes, limits) {
  const hot = new Set(hotIds);
  const entryIds = new Set(entries.map((entry) => entry.tabId));
  return Object.freeze({
    revision,
    entries: Object.freeze(entries.map((entry) => freezeEntry(entry, hot.has(entry.tabId)))),
    hotTabIds: Object.freeze([...hotIds]),
    warmTabIds: Object.freeze(entries
      .filter((entry) => !hot.has(entry.tabId))
      .map((entry) => entry.tabId)),
    coldTabIds: Object.freeze(tabIds.filter((tabId) => !entryIds.has(tabId))),
    totalBytes,
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
    maxHotEntries: DEFAULT_MAX_HOT_ENTRIES,
    maxEntries: DEFAULT_MAX_WARM_ENTRIES,
    maxBytes: DEFAULT_MAX_BYTES,
  },
);

/**
 * Owns disposable, read-only tab display projections. Entries never authorize
 * editing, persistence or source transitions; every activation still reopens
 * and validates the registered project through ProjectWorkflow.
 */
export class DocumentSurfaceCacheSession {
  #listeners = new Set();
  #entries = new Map();
  #hotIds = [];
  #tabIds = [];
  #totalBytes = 0;
  #revision = 0;
  #snapshot = INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT;
  #maxHotEntries;
  #maxWarmEntries;
  #maxBytes;

  constructor({
    maxHotEntries = DEFAULT_MAX_HOT_ENTRIES,
    maxWarmEntries = DEFAULT_MAX_WARM_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
  } = {}) {
    this.#maxHotEntries = Math.max(1, Math.round(Number(maxHotEntries)) || 1);
    this.#maxWarmEntries = Math.max(
      this.#maxHotEntries,
      Math.round(Number(maxWarmEntries)) || this.#maxHotEntries,
    );
    this.#maxBytes = Math.max(1, Math.round(Number(maxBytes)) || 1);
    this.#snapshot = frozenSnapshot(0, [], [], [], 0, {
      maxHotEntries: this.#maxHotEntries,
      maxEntries: this.#maxWarmEntries,
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

    const previous = this.#entries.get(tabId);
    const owns = (key) => Object.prototype.hasOwnProperty.call(presentation, key);
    const normalizedContext = owns("pageViewContext")
      ? presentationContext(presentation.pageViewContext)
      : {
          value: previous?.pageViewContext || null,
          bytes: previous
            ? Math.max(0, previous.byteLength - previous.contentBytes)
            : 0,
        };
    const contentBytes = Math.max(1, 2 * html.length + 2 * sourcePath.length + 512);
    const entry = {
      tabId,
      projectId,
      documentId,
      sourcePath,
      sourceSha256,
      html,
      canvasMode: owns("canvasMode")
        ? (presentation.canvasMode === "preview" ? "preview" : "edit")
        : previous?.canvasMode || "edit",
      pageViewContext: normalizedContext.value,
      scrollTop: owns("scrollTop") && Number.isFinite(Number(presentation.scrollTop))
        ? Math.max(0, Number(presentation.scrollTop))
        : previous?.scrollTop || 0,
      contentBytes,
      byteLength: contentBytes + normalizedContext.bytes,
    };
    if (previous) this.#totalBytes -= previous.byteLength;
    this.#entries.delete(tabId);
    this.#entries.set(tabId, entry);
    this.#totalBytes += entry.byteLength;
    this.#promote(tabId);
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
    this.#promote(id);
    this.#publish();
    return this.#snapshot.entries.find((candidate) => candidate.tabId === id) || null;
  }

  updatePresentation(tabId, presentation = {}) {
    const id = String(tabId || "");
    const entry = this.#entries.get(id);
    if (!entry) return null;
    const owns = (key) => Object.prototype.hasOwnProperty.call(presentation, key);
    const normalizedContext = owns("pageViewContext")
      ? presentationContext(presentation.pageViewContext)
      : {
          value: entry.pageViewContext,
          bytes: Math.max(0, entry.byteLength - entry.contentBytes),
        };
    const next = {
      ...entry,
      canvasMode: owns("canvasMode")
        ? (presentation.canvasMode === "preview" ? "preview" : "edit")
        : entry.canvasMode,
      pageViewContext: normalizedContext.value,
      scrollTop: owns("scrollTop") && Number.isFinite(Number(presentation.scrollTop))
        ? Math.max(0, Number(presentation.scrollTop))
        : entry.scrollTop,
      byteLength: entry.contentBytes + normalizedContext.bytes,
    };
    this.#totalBytes += next.byteLength - entry.byteLength;
    this.#entries.set(id, next);
    this.#evict();
    this.#publish();
    return this.#snapshot.entries.find((candidate) => candidate.tabId === id) || null;
  }

  remove(tabId) {
    const id = String(tabId || "");
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#entries.delete(id);
    this.#totalBytes -= entry.byteLength;
    this.#hotIds = this.#hotIds.filter((candidate) => candidate !== id);
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
      this.#totalBytes -= entry.byteLength;
      changed = true;
    }
    const hotIds = this.#hotIds.filter((tabId) => retained.has(tabId));
    if (hotIds.length !== this.#hotIds.length) {
      this.#hotIds = hotIds;
      changed = true;
    }
    if (changed) this.#publish();
    return this.#snapshot;
  }

  clear() {
    if (!this.#entries.size && !this.#hotIds.length && !this.#tabIds.length) return;
    this.#entries.clear();
    this.#hotIds = [];
    this.#tabIds = [];
    this.#totalBytes = 0;
    this.#publish();
  }

  dispose() {
    this.clear();
    this.#listeners.clear();
  }

  #promote(tabId) {
    this.#hotIds = [tabId, ...this.#hotIds.filter((candidate) => candidate !== tabId)]
      .slice(0, this.#maxHotEntries);
  }

  #evict() {
    while (
      this.#entries.size > this.#maxWarmEntries
      || this.#totalBytes > this.#maxBytes
    ) {
      const oldestId = this.#entries.keys().next().value;
      if (!oldestId) break;
      const oldest = this.#entries.get(oldestId);
      this.#entries.delete(oldestId);
      this.#totalBytes -= oldest?.byteLength || 0;
      this.#hotIds = this.#hotIds.filter((candidate) => candidate !== oldestId);
    }
  }

  #publish() {
    this.#revision += 1;
    this.#snapshot = frozenSnapshot(
      this.#revision,
      [...this.#entries.values()],
      this.#hotIds,
      this.#tabIds,
      this.#totalBytes,
      {
        maxHotEntries: this.#maxHotEntries,
        maxEntries: this.#maxWarmEntries,
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
