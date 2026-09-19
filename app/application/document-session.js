import {
  createSourceReceipt,
  isSourceReceipt,
  sameSourceReceipt,
  sameSourceReceiptContext,
} from "./source-receipt.js";

export {
  isSourceReceipt,
  sameSourceReceipt,
  sameSourceReceiptContext,
};

/** @typedef {import("./document-session.d.ts").DocumentCanvasAuthority} DocumentCanvasAuthority */
/** @typedef {import("./document-session.d.ts").DocumentPersistState} DocumentPersistState */
/** @typedef {import("./document-session.d.ts").DocumentSessionSnapshot} DocumentSessionSnapshot */
/** @typedef {import("./document-session.d.ts").DocumentSessionOptions} DocumentSessionOptions */
/** @typedef {import("./document-session.d.ts").DocumentWrite} DocumentWrite */
/** @typedef {import("./document-session.d.ts").DocumentWriteConfirmation} DocumentWriteConfirmation */
/** @typedef {import("./document-session.d.ts").DocumentSession<DocumentWrite & Record<string, unknown>>} DocumentSessionDeclaration */
/** @typedef {import("./document-session.d.ts").PersistedBoundaryResult} PersistedBoundaryResult */
/** @typedef {import("./source-receipt-contract.d.ts").DocumentSourceReceipt} DocumentSourceReceipt */
/** @typedef {import("./project-session.js").ProjectContext} ProjectContext */

const PERSIST_STATES = new Set([
  "idle",
  "preview-dirty",
  "queued",
  "writing",
  "failed",
  "conflict",
]);

/** @param {unknown} value */
function revision(value) {
  const next = Number(value);
  return Number.isSafeInteger(next) && next >= 0 ? next : 0;
}

/** @param {unknown} value @returns {DocumentPersistState} */
function persistState(value) {
  return typeof value === "string" && PERSIST_STATES.has(value)
    ? /** @type {DocumentPersistState} */ (value)
    : "idle";
}

/** @param {unknown} value @returns {value is DocumentWrite} */
function isDocumentWrite(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = /** @type {Record<string, unknown>} */ (value);
  return Number.isSafeInteger(record.revision)
    && Number(record.revision) >= 0
    && typeof record.html === "string";
}

/** @param {unknown} left @param {unknown} right */
function sameWriteBytes(left, right) {
  return Boolean(
    isDocumentWrite(left)
    && isDocumentWrite(right)
    && revision(left.revision) === revision(right.revision)
    && String(left.html) === String(right.html)
  );
}

/** @param {DocumentWrite & Record<string, unknown>} write @param {ProjectContext | null | undefined} context */
function writeMatchesContext(write, context) {
  if (!context) return true;
  const contextRecord = /** @type {Record<string, unknown>} */ (context);
  const fields = ["epoch", "projectId", "documentId", "sourcePath"];
  for (const field of [
    "projectRootPath",
    "targetKind",
    "workingCopyId",
    "versionId",
    "exactSourcePath",
    "sourceSha256",
    "sessionEpoch",
  ]) {
    if (Object.hasOwn(contextRecord, field)) fields.push(field);
  }
  return fields.every((field) => (
    String(write[field] ?? "") === String(contextRecord[field] ?? "")
  ));
}

/**
 * @param {DocumentWrite & Record<string, unknown>} expectedWrite
 * @param {DocumentWrite & Record<string, unknown>} nextWrite
 * @param {ProjectContext | null | undefined} context
 */
function writeRebaseKeepsOwner(expectedWrite, nextWrite, context) {
  if (!sameWriteBytes(expectedWrite, nextWrite)) return false;
  const contextRecord = context
    ? /** @type {Record<string, unknown>} */ (context)
    : null;
  for (const field of ["projectId", "documentId"]) {
    const expected = String(expectedWrite?.[field] || "");
    const next = String(nextWrite?.[field] || "");
    const current = String(contextRecord?.[field] || "");
    if ((expected && expected !== next) || (current && current !== next)) return false;
  }
  return true;
}

const CANVAS_AUTHORITY_STATES = new Set([
  "idle",
  "pending",
  "verified",
  "failed",
]);

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

// A sequence is scoped to one DocumentSession.  Keep the session incarnation
// in a module-wide monotonic domain so a rebuilt controller cannot accidentally
// reuse a lower sequence in the same renderer process.
let sourceSessionIncarnationSequence = 0;

function nextSourceSessionIncarnation() {
  sourceSessionIncarnationSequence += 1;
  if (!Number.isSafeInteger(sourceSessionIncarnationSequence)) {
    sourceSessionIncarnationSequence = 1;
  }
  return sourceSessionIncarnationSequence;
}

/**
 * @param {{
 *   status?: "idle" | "pending" | "verified" | "failed";
 *   generation?: number;
 *   renderedSha256?: string | null;
 *   error?: string | null;
 * }} [value]
 * @returns {DocumentCanvasAuthority}
 */
function canvasAuthority({
  status = "idle",
  generation = 0,
  renderedSha256 = null,
  error = null,
} = {}) {
  const normalizedStatus = CANVAS_AUTHORITY_STATES.has(status) ? status : "idle";
  const normalizedGeneration = revision(generation);
  if (normalizedStatus === "verified") {
    return Object.freeze({
      status: "verified",
      generation: normalizedGeneration,
      renderedSha256: String(renderedSha256 || ""),
      error: null,
    });
  }
  if (normalizedStatus === "failed") {
    return Object.freeze({
      status: "failed",
      generation: normalizedGeneration,
      renderedSha256: null,
      error: String(error || ""),
    });
  }
  return Object.freeze({
    status: normalizedStatus === "pending" ? "pending" : "idle",
    generation: normalizedGeneration,
    renderedSha256: null,
    error: null,
  });
}

/** @param {number} generation @returns {DocumentCanvasAuthority} */
function pendingCanvasAuthority(generation) {
  return canvasAuthority({
    status: "pending",
    generation,
  });
}

/** @param {Exclude<PersistedBoundaryResult, { ready: true }>["code"]} code @param {string} reason @param {boolean} [confirmed] */
function boundaryBlock(code, reason, confirmed = false) {
  return Object.freeze({
    ready: false,
    code,
    reason,
    confirmed,
  });
}

/** @param {DocumentSessionOptions} [options] @returns {DocumentSessionSnapshot} */
function initialSnapshot({
  html = "",
  persistedSourceSha256 = null,
  workingHtmlSha256 = persistedSourceSha256,
  editRevision = 0,
  lastPersistedRevision = editRevision,
  persistState: initialPersistState = "idle",
  persistError = "",
} = {}) {
  const persistedHash = persistedSourceSha256 ? String(persistedSourceSha256) : null;
  return Object.freeze({
    html: String(html),
    persistedSourceSha256: persistedHash,
    workingHtmlSha256: workingHtmlSha256 ? String(workingHtmlSha256) : null,
    canvasGeneration: 0,
    sourceReceipt: null,
    editRevision: revision(editRevision),
    lastPersistedRevision: revision(lastPersistedRevision),
    persistState: persistState(initialPersistState),
    persistError: String(persistError || ""),
    hasPendingWrite: false,
    isFlushing: false,
    canvasAuthority: canvasAuthority({ generation: 0 }),
  });
}

export class DocumentSession {
  /** @type {((snapshot: DocumentSessionSnapshot) => void) | null} */
  #observer = null;

  /** @type {DocumentSessionSnapshot} */
  #snapshot;

  /** @type {(DocumentWrite & Record<string, unknown>) | null} */
  #pendingWrite = null;

  /** @type {(DocumentWrite & Record<string, unknown>) | null} */
  #activeWrite = null;

  #authorityGeneration = 0;

  /** @type {WeakMap<DocumentWrite & Record<string, unknown>, number>} */
  #writeAuthorities = new WeakMap();

  /** @type {Promise<unknown> | null} */
  #flushPromise = null;

  #receiptSequence = 0;

  /** @type {number | null} */
  #confirmedReceiptSequence = null;

  #sessionIncarnation;

  /** @param {DocumentSessionOptions} [options] */
  constructor(options = {}) {
    this.#sessionIncarnation = nextSourceSessionIncarnation();
    this.#snapshot = initialSnapshot(options);
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      sourceReceipt: this.#nextReceipt({
        origin: "authority",
        operationId: options.operationId || "document-session-initial-authority",
        editRevision: this.#snapshot.editRevision,
        canvasGeneration: this.#snapshot.canvasGeneration,
        sourceSha256: this.#snapshot.workingHtmlSha256
          || this.#snapshot.persistedSourceSha256,
        context: options.context || null,
      }),
    });
  }

  /** @param {((snapshot: DocumentSessionSnapshot) => void) | null} observer */
  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  /** @param {Omit<DocumentSessionSnapshot, "hasPendingWrite" | "isFlushing"> & Partial<Pick<DocumentSessionSnapshot, "hasPendingWrite" | "isFlushing">>} next */
  #emit(next) {
    const persistedSourceSha256 = next.persistedSourceSha256
      ? String(next.persistedSourceSha256)
      : null;
    this.#snapshot = Object.freeze({
      ...next,
      persistedSourceSha256,
      hasPendingWrite: Boolean(this.#pendingWrite),
      isFlushing: Boolean(this.#flushPromise),
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change source authority.
    }
  }

  /** @param {Parameters<DocumentSessionDeclaration["reset"]>[0]} value */
  reset({
    html,
    persistedSourceSha256 = null,
    workingHtmlSha256 = persistedSourceSha256,
    editRevision = 0,
    lastPersistedRevision = 0,
    context = null,
    operationId = "",
  }) {
    this.#pendingWrite = null;
    this.#activeWrite = null;
    this.#flushPromise = null;
    this.#authorityGeneration += 1;
    this.#confirmedReceiptSequence = null;
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const receipt = this.#nextReceipt({
      origin: "authority",
      operationId,
      editRevision,
      canvasGeneration,
      sourceSha256: workingHtmlSha256 || persistedSourceSha256,
      context,
    });
    this.#emit({
      html: String(html || ""),
      persistedSourceSha256: persistedSourceSha256
        ? String(persistedSourceSha256)
        : null,
      workingHtmlSha256: workingHtmlSha256 ? String(workingHtmlSha256) : null,
      canvasGeneration,
      sourceReceipt: receipt,
      editRevision: revision(editRevision),
      lastPersistedRevision: revision(lastPersistedRevision),
      persistState: "idle",
      persistError: "",
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    });
    return this.#snapshot;
  }

  /** @param {Parameters<DocumentSessionDeclaration["publishAuthority"]>[0]} value */
  publishAuthority({
    html,
    persistedSourceSha256 = null,
    workingHtmlSha256 = persistedSourceSha256,
    sourceSha256,
    editRevision,
    lastPersistedRevision,
    persistState: nextPersistState,
    persistError,
    pendingWrite,
    context = null,
    operationId = "",
  }) {
    if (pendingWrite !== undefined && pendingWrite !== null) {
      if (
        !isDocumentWrite(pendingWrite)
        || revision(pendingWrite.revision) !== revision(editRevision ?? this.#snapshot.editRevision)
        || String(pendingWrite.html) !== String(html)
      ) {
        throw new TypeError("Document authority pending write must match its accepted HTML and revision.");
      }
    }
    this.#authorityGeneration += 1;
    this.#confirmedReceiptSequence = null;
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const receipt = this.#nextReceipt({
      origin: "authority",
      operationId,
      editRevision: editRevision ?? this.#snapshot.editRevision,
      canvasGeneration,
      sourceSha256: sourceSha256 === undefined
        ? workingHtmlSha256 || persistedSourceSha256
        : sourceSha256,
      context,
    });
    const next = {
      ...this.#snapshot,
      html: String(html),
      persistedSourceSha256: persistedSourceSha256
        ? String(persistedSourceSha256)
        : null,
      workingHtmlSha256: workingHtmlSha256 ? String(workingHtmlSha256) : null,
      canvasGeneration,
      sourceReceipt: receipt,
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    };
    if (editRevision !== undefined) {
      next.editRevision = revision(editRevision);
    }
    if (lastPersistedRevision !== undefined) {
      next.lastPersistedRevision = revision(lastPersistedRevision);
    }
    if (nextPersistState !== undefined) {
      next.persistState = persistState(nextPersistState);
    }
    if (persistError !== undefined) {
      next.persistError = String(persistError || "");
    }
    if (pendingWrite !== undefined) {
      this.#pendingWrite = pendingWrite || null;
      if (this.#pendingWrite) {
        this.#writeAuthorities.set(this.#pendingWrite, this.#authorityGeneration);
      }
    }
    this.#emit(next);
    return this.#snapshot;
  }

  /** @param {Parameters<DocumentSessionDeclaration["reloadCanvas"]>[0]} [value] */
  reloadCanvas({ context = null, operationId = "" } = {}) {
    this.#confirmedReceiptSequence = null;
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const receipt = this.#nextReceipt({
      origin: "authority",
      operationId,
      editRevision: this.#snapshot.editRevision,
      canvasGeneration,
      sourceSha256: this.#snapshot.workingHtmlSha256
        || this.#snapshot.persistedSourceSha256,
      context,
    });
    this.#emit({
      ...this.#snapshot,
      canvasGeneration,
      sourceReceipt: receipt,
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    });
    return this.#snapshot;
  }

  /** @param {Partial<Parameters<DocumentSessionDeclaration["confirmWorkingHtml"]>[0]>} [value] */
  confirmWorkingHtml({ revision: expectedRevision, htmlSha256 } = {}) {
    const receivedRevision = revision(expectedRevision);
    const receivedHash = htmlSha256 ? String(htmlSha256) : "";
    if (
      receivedRevision !== this.#snapshot.editRevision
      || !/^sha256:[a-f0-9]{64}$/u.test(receivedHash)
    ) return false;
    this.#emit({
      ...this.#snapshot,
      workingHtmlSha256: receivedHash,
    });
    return true;
  }

  /** @param {Partial<Parameters<DocumentSessionDeclaration["confirmCanvas"]>[0]>} [value] */
  confirmCanvas({
    generation,
    renderedSha256,
    workingHtmlSha256,
    renderedHtml,
    receipt,
  } = {}) {
    const expectedGeneration = revision(generation);
    const renderedHash = renderedSha256 ? String(renderedSha256) : "";
    const workingHash = String(this.#snapshot.workingHtmlSha256 || "");
    const reportedWorkingHash = workingHtmlSha256
      ? String(workingHtmlSha256)
      : workingHash;
    const currentReceipt = this.#snapshot.sourceReceipt;
    const receivedReceipt = receipt && typeof receipt === "object"
      ? receipt
      : currentReceipt?.context == null
        ? currentReceipt
        : null;
    if (
      expectedGeneration !== this.#snapshot.canvasGeneration
      || !SHA256.test(renderedHash)
      || !SHA256.test(workingHash)
      || !isSourceReceipt(receivedReceipt)
      || !SHA256.test(String(receivedReceipt.sourceSha256 || ""))
      || receivedReceipt.sourceSha256 !== renderedHash
      || reportedWorkingHash !== workingHash
      || renderedHash !== workingHash
      || !isSourceReceipt(currentReceipt)
      || !sameSourceReceipt(receivedReceipt, currentReceipt)
      || receivedReceipt.canvasGeneration !== expectedGeneration
      || (currentReceipt.context != null && typeof renderedHtml !== "string")
      || (renderedHtml !== undefined && String(renderedHtml) !== this.#snapshot.html)
      || this.#snapshot.canvasAuthority.status === "failed"
      || this.#snapshot.canvasAuthority.status === "verified"
      || this.#confirmedReceiptSequence === receivedReceipt.sequence
    ) {
      return false;
    }
    this.#confirmedReceiptSequence = receivedReceipt.sequence;
    this.#emit({
      ...this.#snapshot,
      canvasAuthority: canvasAuthority({
        status: "verified",
        generation: expectedGeneration,
        renderedSha256: renderedHash,
      }),
    });
    return true;
  }

  /** @param {Partial<Parameters<DocumentSessionDeclaration["failCanvas"]>[0]>} [value] */
  failCanvas({ generation, error, receipt } = {}) {
    const expectedGeneration = revision(generation);
    const currentReceipt = this.#snapshot.sourceReceipt;
    const receivedReceipt = receipt && typeof receipt === "object"
      ? receipt
      : currentReceipt?.context == null
        ? currentReceipt
        : null;
    if (
      expectedGeneration !== this.#snapshot.canvasGeneration
      || !isSourceReceipt(receivedReceipt)
      || !isSourceReceipt(currentReceipt)
      || !sameSourceReceipt(receivedReceipt, currentReceipt)
      || receivedReceipt.canvasGeneration !== expectedGeneration
      || this.#snapshot.canvasAuthority.status === "failed"
      || this.#snapshot.canvasAuthority.status === "verified"
      || this.#confirmedReceiptSequence === receivedReceipt.sequence
    ) return false;
    this.#emit({
      ...this.#snapshot,
      canvasAuthority: canvasAuthority({
        status: "failed",
        generation: expectedGeneration,
        error: error || "画布没有在时限内确认载入目标 HTML。",
      }),
    });
    return true;
  }

  /**
   * @param {Partial<Parameters<DocumentSessionDeclaration["acceptEdit"]>[0]>} [value]
   * @returns {import("./document-session.d.ts").DocumentEditAcceptance<DocumentWrite & Record<string, unknown>>}
   */
  acceptEdit({
    html,
    origin = "local-edit",
    operationId = "",
    sourceSha256 = "",
    context = null,
    write: writeDetails = null,
  } = {}) {
    if (this.#snapshot.persistState === "conflict") {
      return Object.freeze({
        accepted: false,
        revision: this.#snapshot.editRevision,
        write: null,
      });
    }
    this.#confirmedReceiptSequence = null;
    const nextRevision = this.#snapshot.editRevision + 1;
    const nextHtml = String(html);
    const nextWorkingHash = SHA256.test(String(sourceSha256 || ""))
      ? String(sourceSha256)
      : null;
    const receipt = this.#nextReceipt({
      origin,
      operationId,
      editRevision: nextRevision,
      canvasGeneration: this.#snapshot.canvasGeneration,
      sourceSha256: nextWorkingHash || "",
      context,
    });
    const write = writeDetails === null || writeDetails === undefined
      ? null
      : {
        ...writeDetails,
        html: nextHtml,
        revision: nextRevision,
      };
    if (write && (
      !isDocumentWrite(write)
      || !writeMatchesContext(write, receipt.context)
    )) {
      throw new TypeError("Document accepted edit write must match its document owner.");
    }
    this.#pendingWrite = write;
    if (write) this.#writeAuthorities.set(write, this.#authorityGeneration);
    this.#emit({
      ...this.#snapshot,
      html: nextHtml,
      editRevision: nextRevision,
      sourceReceipt: receipt,
      persistState: write ? "queued" : "preview-dirty",
      persistError: "",
      workingHtmlSha256: nextWorkingHash,
      canvasAuthority: pendingCanvasAuthority(this.#snapshot.canvasGeneration),
    });
    return Object.freeze({
      accepted: true,
      revision: nextRevision,
      write,
    });
  }

  /** @param {DocumentWrite & Record<string, unknown>} write */
  restorePendingWrite(write) {
    if (!isDocumentWrite(write)) {
      throw new TypeError("Document restored pending write requires exact HTML and a non-negative revision.");
    }
    if (
      revision(write.revision) !== this.#snapshot.editRevision
      || String(write.html) !== this.#snapshot.html
      || !writeMatchesContext(write, this.#snapshot.sourceReceipt?.context)
    ) {
      throw new TypeError("Document restored pending write must match the currently accepted document state.");
    }
    if (this.#pendingWrite || this.#activeWrite) {
      throw new TypeError("Document restored pending write cannot replace owned write work.");
    }
    this.#pendingWrite = write;
    this.#writeAuthorities.set(write, this.#authorityGeneration);
    this.#emit({
      ...this.#snapshot,
      persistState: "queued",
      persistError: "",
    });
    return write;
  }

  beginWrite() {
    if (this.#activeWrite) return null;
    const write = this.#pendingWrite;
    if (!write) return null;
    if (this.#writeAuthorities.get(write) !== this.#authorityGeneration) return null;
    this.#pendingWrite = null;
    this.#activeWrite = write;
    this.#emit({
      ...this.#snapshot,
      persistState: "writing",
      persistError: "",
    });
    return write;
  }

  /**
   * @param {DocumentWrite & Record<string, unknown>} write
   * @param {{ nextWrite?: DocumentWrite & Record<string, unknown>; replacePending?: boolean }} [value]
   */
  restoreWrite(write, { nextWrite = write, replacePending = false } = {}) {
    if (!isDocumentWrite(write) || !isDocumentWrite(nextWrite)) {
      throw new TypeError("Document restored write requires exact HTML and a non-negative revision.");
    }
    if (this.#activeWrite !== write) return false;
    const pending = this.#pendingWrite;
    this.#activeWrite = null;
    if (!replacePending && pending) {
      this.#emit({
        ...this.#snapshot,
        persistState: "queued",
        persistError: "",
      });
      return pending;
    }
    if (
      revision(nextWrite.revision) !== this.#snapshot.editRevision
      || String(nextWrite.html) !== this.#snapshot.html
      || !writeMatchesContext(nextWrite, this.#snapshot.sourceReceipt?.context)
    ) {
      throw new TypeError("Document restored write must match the currently accepted document state.");
    }
    this.#pendingWrite = nextWrite;
    this.#writeAuthorities.set(nextWrite, this.#authorityGeneration);
    this.#emit({
      ...this.#snapshot,
      persistState: "queued",
      persistError: "",
    });
    return nextWrite;
  }

  /** @param {Partial<Parameters<DocumentSessionDeclaration["rebaseQueuedWrite"]>[0]>} [value] */
  rebaseQueuedWrite({ expectedWrite, nextWrite } = {}) {
    if (!expectedWrite || !nextWrite || this.#pendingWrite !== expectedWrite) return false;
    if (
      this.#writeAuthorities.get(expectedWrite) !== this.#authorityGeneration
      || !writeRebaseKeepsOwner(
        expectedWrite,
        nextWrite,
        this.#snapshot.sourceReceipt?.context,
      )
    ) {
      throw new TypeError("Document rebased write must keep its accepted bytes and document owner.");
    }
    this.#pendingWrite = nextWrite;
    this.#writeAuthorities.set(nextWrite, this.#authorityGeneration);
    this.#emit(this.#snapshot);
    return true;
  }

  /** @param {Partial<Parameters<DocumentSessionDeclaration["rebaseActiveWrite"]>[0]>} [value] */
  rebaseActiveWrite({ expectedWrite, nextWrite } = {}) {
    if (!expectedWrite || !nextWrite || this.#activeWrite !== expectedWrite) return false;
    if (
      this.#writeAuthorities.get(expectedWrite) !== this.#authorityGeneration
      || !writeRebaseKeepsOwner(
        expectedWrite,
        nextWrite,
        this.#snapshot.sourceReceipt?.context,
      )
    ) {
      throw new TypeError("Document active write rebase must keep its accepted bytes and document owner.");
    }
    this.#activeWrite = nextWrite;
    this.#writeAuthorities.set(nextWrite, this.#authorityGeneration);
    return true;
  }

  /** @param {DocumentWrite & Record<string, unknown>} write */
  finishWrite(write) {
    if (this.#activeWrite !== write) return false;
    this.#activeWrite = null;
    return true;
  }

  /**
   * @param {Partial<Parameters<DocumentSessionDeclaration["acceptWriteConfirmation"]>[0]>} [value]
   * @returns {DocumentWriteConfirmation}
   */
  acceptWriteConfirmation({
    write,
    html,
    sourceSha256,
    persistedRevision,
    context = null,
    routingChanged = false,
    operationId = "",
    nextWrite = undefined,
  } = {}) {
    const writeRevision = revision(write?.revision);
    const confirmedRevision = revision(persistedRevision);
    const confirmedHash = String(sourceSha256 || "");
    if (
      !isDocumentWrite(write)
      || this.#activeWrite !== write
      || this.#writeAuthorities.get(write) !== this.#authorityGeneration
      || !SHA256.test(confirmedHash)
      || confirmedRevision < writeRevision
      || String(html ?? "") !== String(write.html)
    ) return Object.freeze({
      accepted: false,
      completesCurrentDocument: false,
      authorityChanged: false,
    });
    const currentReceipt = this.#snapshot.sourceReceipt;
    const acknowledgedContext = context || currentReceipt?.context || null;
    const pending = this.#pendingWrite;
    const confirmedPending = nextWrite === undefined ? pending : nextWrite;
    if (
      (nextWrite !== undefined && (
        !pending
        || !isDocumentWrite(nextWrite)
        || !writeRebaseKeepsOwner(pending, nextWrite, acknowledgedContext)
        || !writeMatchesContext(nextWrite, acknowledgedContext)
      ))
      || (routingChanged && confirmedPending && !writeMatchesContext(
        confirmedPending,
        acknowledgedContext,
      ))
    ) return Object.freeze({
      accepted: false,
      completesCurrentDocument: false,
      authorityChanged: false,
    });
    this.#activeWrite = null;
    const completesCurrentDocument = Boolean(
      this.#snapshot.editRevision === writeRevision
      && !confirmedPending
      && this.#snapshot.html === String(html ?? "")
      && String(write.html ?? "") === String(html ?? "")
    );
    const receiptNeedsHashRepair = Boolean(
      completesCurrentDocument
      && (!currentReceipt
        || !SHA256.test(String(currentReceipt.sourceSha256 || ""))
        || currentReceipt.sourceSha256 !== confirmedHash),
    );
    const authorityChanged = Boolean(routingChanged || receiptNeedsHashRepair);
    const next = {
      ...this.#snapshot,
      persistedSourceSha256: confirmedHash,
      lastPersistedRevision: Math.max(
        this.#snapshot.lastPersistedRevision,
        confirmedRevision,
      ),
    };
    this.#pendingWrite = confirmedPending;
    if (confirmedPending) {
      this.#writeAuthorities.set(confirmedPending, this.#authorityGeneration);
    }
    if (completesCurrentDocument) {
      next.html = String(html);
      next.workingHtmlSha256 = confirmedHash;
    }
    if (this.#pendingWrite) {
      next.persistState = "queued";
      next.persistError = "";
    } else if (completesCurrentDocument) {
      next.persistState = "idle";
      next.persistError = "";
    }
    if (authorityChanged) {
      this.#authorityGeneration += 1;
      this.#confirmedReceiptSequence = null;
      const canvasGeneration = this.#snapshot.canvasGeneration + 1;
      next.canvasGeneration = canvasGeneration;
      next.sourceReceipt = this.#nextReceipt({
        origin: "authority",
        operationId,
        editRevision: this.#snapshot.editRevision,
        canvasGeneration,
        sourceSha256: completesCurrentDocument
          ? confirmedHash
          : this.#snapshot.workingHtmlSha256 || confirmedHash,
        context: acknowledgedContext,
      });
      next.canvasAuthority = pendingCanvasAuthority(canvasGeneration);
      if (confirmedPending) {
        this.#writeAuthorities.set(confirmedPending, this.#authorityGeneration);
      }
    }
    this.#emit(next);
    return Object.freeze({
      accepted: true,
      completesCurrentDocument,
      authorityChanged,
    });
  }

  /** @param {unknown} value */
  reconcileRecoveredRevision(value) {
    const reconciledRevision = revision(value);
    this.#pendingWrite = null;
    this.#activeWrite = null;
    this.#emit({
      ...this.#snapshot,
      editRevision: reconciledRevision,
      lastPersistedRevision: reconciledRevision,
      persistState: "idle",
      persistError: "",
    });
    return this.#snapshot;
  }

  markPersistenceIdle() {
    if (
      this.#pendingWrite
      || this.#activeWrite
      || this.#snapshot.lastPersistedRevision < this.#snapshot.editRevision
      || this.#snapshot.persistState === "failed"
      || this.#snapshot.persistState === "conflict"
      || (
        this.#snapshot.workingHtmlSha256
        && this.#snapshot.workingHtmlSha256 !== this.#snapshot.persistedSourceSha256
      )
    ) return false;
    this.#emit({
      ...this.#snapshot,
      persistState: "idle",
      persistError: "",
    });
    return true;
  }

  /** @param {Partial<Parameters<DocumentSessionDeclaration["recordPersistenceFailure"]>[0]>} [value] */
  recordPersistenceFailure({ error, conflict = false, write = null, receipt = null } = {}) {
    if (
      (write && (
        (this.#activeWrite !== write && this.#pendingWrite !== write)
        || this.#writeAuthorities.get(write) !== this.#authorityGeneration
      ))
      || (receipt && !sameSourceReceipt(receipt, this.#snapshot.sourceReceipt))
    ) return false;
    this.#emit({
      ...this.#snapshot,
      persistState: conflict ? "conflict" : "failed",
      persistError: String(error || ""),
    });
    return this.#snapshot;
  }

  /** @template {Promise<unknown>} T @param {T} promise @returns {T | false} */
  beginFlush(promise) {
    if (typeof promise?.then !== "function") {
      throw new TypeError("Document flush authority must be a Promise.");
    }
    if (this.#flushPromise && this.#flushPromise !== promise) return false;
    this.#flushPromise = promise;
    this.#emit(this.#snapshot);
    return promise;
  }

  /** @param {Promise<unknown>} promise */
  finishFlush(promise) {
    if (this.#flushPromise !== promise) return false;
    this.#flushPromise = null;
    this.#emit(this.#snapshot);
    return true;
  }

  /**
   * @param {Parameters<DocumentSessionDeclaration["reconcilePersistedBoundary"]>[0]} value
   * @returns {Promise<PersistedBoundaryResult>}
   */
  async reconcilePersistedBoundary({
    frozenHtml,
    reportedSourceSha256 = null,
    cutoffRevision,
    hashHtml,
    readSource,
    isCurrent,
    acceptsSource,
  }) {
    if (
      typeof hashHtml !== "function"
      || typeof readSource !== "function"
      || typeof isCurrent !== "function"
      || typeof acceptsSource !== "function"
    ) {
      throw new TypeError("Document boundary reconciliation is not configured.");
    }

    const html = String(frozenHtml);
    const cutoff = revision(cutoffRevision);
    const stillCurrent = () => Boolean(
      isCurrent()
      && this.#snapshot.editRevision === cutoff
      && this.#snapshot.html === html
      && !this.#pendingWrite
      && !this.#flushPromise
    );

    let frozenSha256;
    try {
      frozenSha256 = String(await hashHtml(html));
    } catch {
      return boundaryBlock(
        "frozen-integrity-unavailable",
        "当前页面暂时无法完成内容校验，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(frozenSha256)) {
      return boundaryBlock(
        "frozen-integrity-unavailable",
        "当前页面暂时无法完成内容校验，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (!stillCurrent()) {
      return boundaryBlock(
        "session-changed",
        "关闭核对期间当前页面发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }

    const metadataRepaired = Boolean(
      reportedSourceSha256
      && String(reportedSourceSha256) !== frozenSha256
    );
    if (
      this.#snapshot.persistState === "idle"
      && this.#snapshot.persistedSourceSha256 === frozenSha256
      && this.#snapshot.workingHtmlSha256 === frozenSha256
      && this.#snapshot.lastPersistedRevision >= cutoff
    ) {
      return Object.freeze({
        ready: true,
        repaired: metadataRepaired,
        sourceSha256: frozenSha256,
        lastModifiedAt: "",
      });
    }

    let source;
    try {
      source = await readSource();
    } catch {
      return boundaryBlock(
        "source-unavailable",
        "源文件暂时无法完成最终核对，当前页面仍保留；再次关闭时会自动继续。",
      );
    }
    let sourceAccepted = false;
    try {
      sourceAccepted = Boolean(
        source
        && typeof source === "object"
        && !Array.isArray(source)
        && acceptsSource(source)
      );
    } catch {
      sourceAccepted = false;
    }
    if (!stillCurrent() || !sourceAccepted) {
      return boundaryBlock(
        "source-identity-changed",
        "核对期间当前文件身份发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }

    const content = typeof source?.content === "string" ? source.content : null;
    const declaredSha256 = String(source?.sha256 || "");
    let actualSha256 = "";
    if (content !== null) {
      try {
        actualSha256 = String(await hashHtml(content));
      } catch {
        actualSha256 = "";
      }
    }
    if (
      content === null
      || !/^sha256:[a-f0-9]{64}$/u.test(declaredSha256)
      || actualSha256 !== declaredSha256
    ) {
      return boundaryBlock(
        "source-integrity-failed",
        "源文件的内容校验没有通过。当前页面没有覆盖文件；请先导出当前 HTML，再重新读取源文件。",
        true,
      );
    }
    if (!stillCurrent()) {
      return boundaryBlock(
        "session-changed",
        "核对期间当前页面发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (content !== html || declaredSha256 !== frozenSha256) {
      const reason = "磁盘中的 HTML 已被其他操作修改。当前页面没有覆盖任何一份；请先导出当前 HTML，或重新载入磁盘文件。";
      this.recordPersistenceFailure({ conflict: true, error: reason });
      return boundaryBlock("source-diverged", reason, true);
    }

    this.#emit({
      ...this.#snapshot,
      persistedSourceSha256: frozenSha256,
      workingHtmlSha256: frozenSha256,
      lastPersistedRevision: Math.max(this.#snapshot.lastPersistedRevision, cutoff),
      persistState: "idle",
      persistError: "",
    });
    return Object.freeze({
      ready: true,
      repaired: true,
      sourceSha256: frozenSha256,
      lastModifiedAt: String(source?.lastModifiedAt || ""),
    });
  }

  get html() {
    return this.#snapshot.html;
  }

  /** @param {import("./source-receipt-contract.d.ts").SourceReceiptInput} input */
  #nextReceipt(input) {
    this.#receiptSequence += 1;
    return createSourceReceipt({
      ...input,
      sequence: this.#receiptSequence,
      sessionIncarnation: this.#sessionIncarnation,
    });
  }

  get sourceReceipt() {
    return this.#snapshot.sourceReceipt;
  }

  get persistedSourceSha256() {
    return this.#snapshot.persistedSourceSha256;
  }

  get workingHtmlSha256() {
    return this.#snapshot.workingHtmlSha256;
  }

  get canvasGeneration() {
    return this.#snapshot.canvasGeneration;
  }

  get canvasAuthority() {
    return this.#snapshot.canvasAuthority;
  }

  get editRevision() {
    return this.#snapshot.editRevision;
  }

  get lastPersistedRevision() {
    return this.#snapshot.lastPersistedRevision;
  }

  get persistState() {
    return this.#snapshot.persistState;
  }

  get persistError() {
    return this.#snapshot.persistError;
  }

  get pendingWrite() {
    return this.#pendingWrite;
  }

  get flushPromise() {
    return this.#flushPromise;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
