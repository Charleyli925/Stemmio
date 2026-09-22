// This function is deliberately self-contained: Playwright serializes the
// same narrow observer into the renderer and unit probes can call it directly.
export function installRuntimeFailureEvidence(caseId = null) {
  const MAX_ENTRIES = 256;
  const MAX_EVENTS = 128;
  const MAX_STEPS = 32;
  const identityKeys = [
    "epoch", "sessionEpoch", "sessionIncarnation", "sequence", "origin",
    "operationId", "editRevision", "canvasGeneration", "sourceSha256",
    "projectId", "documentId", "targetKind", "workingCopyId", "versionId",
  ];
  const attributeNames = [
    "data-edit-runtime-phase", "data-history-adopt-path", "data-render-verified",
    "data-runtime-candidate-generation",
    "data-runtime-candidate-id", "data-runtime-candidate-phase",
    "data-runtime-candidate-source-revision", "data-runtime-degradation",
    "data-runtime-handoff", "data-runtime-last-known-good-generation",
    "data-runtime-last-known-good-id", "data-runtime-last-known-good-source-revision",
    "data-runtime-refresh-decision", "data-runtime-refresh-reason", "data-runtime-slot",
    "data-runtime-slot-role", "data-frame-generation", "data-frame-role", "aria-readonly",
    "sandbox",
  ];
  const safeString = (value) => (
    typeof value === "string"
    && value.length <= 160
    && !/[<>\u0000-\u001f\u007f]/u.test(value)
      ? value
      : null
  );
  const token = (value) => {
    const string = safeString(value);
    return string && /^[A-Za-z0-9_.:/-]+$/u.test(string) ? string : null;
  };
  const numberValue = (value) => (
    typeof value === "number" && Number.isFinite(value) ? value : null
  );
  const integer = (value) => (
    typeof value === "number" && Number.isSafeInteger(value) ? value : null
  );
  const scalar = (value) => typeof value === "number" ? numberValue(value) : token(value);
  const attribute = (value) => (
    typeof value === "boolean" ? value
      : typeof value === "number" ? numberValue(value)
        : safeString(value)
  );
  const pick = (value, schema) => Object.fromEntries(Object.entries(schema).map(([key, read]) => [
    key,
    read(value?.[key]),
  ]));
  const identity = (value) => value && typeof value === "object"
    ? pick(value, Object.fromEntries(identityKeys.map((key) => [key, scalar])))
    : null;
  const attrs = (node) => node
    ? Object.fromEntries(attributeNames.map((name) => [name, attribute(node.getAttribute(name))]))
    : null;
  const bounded = (values, value, limit = MAX_EVENTS) => {
    values.push(value);
    if (values.length > limit) values.splice(0, values.length - limit);
  };
  const historyEvent = (event) => event && typeof event === "object" ? pick(event, {
    sequence: integer,
    documentId: token,
    at: numberValue,
    sourceRevision: token,
    frameToken: token,
    frameGeneration: token,
    frameRole: token,
    runtimeSlot: token,
    runtimeSlotRole: token,
    candidateId: token,
    candidatePhase: token,
    handoff: token,
  }) : null;
  const retryEvent = (event) => event && typeof event === "object" ? pick(event, {
    kind: token,
    executionId: token,
    time: numberValue,
    count: integer,
    generation: token,
    candidate: token,
  }) : null;
  const slotTransition = (event) => event && typeof event === "object" ? pick(event, {
    slot: token,
    attribute: token,
    previous: attribute,
    current: attribute,
    role: token,
    sandbox: safeString,
  }) : null;
  const historyStep = (step) => step && typeof step === "object" ? {
    step: token(step.step),
    at: numberValue(step.at),
    executions: Array.isArray(step.executions)
      ? step.executions.slice(-MAX_EVENTS).map(historyEvent).filter(Boolean)
      : [],
  } : null;
  const state = {
    armedAt: numberValue(performance.timeOrigin + performance.now()),
    caseId: token(caseId),
    entries: [],
    stopped: false,
  };
  let controller = null;
  let unsubscribe = () => {};
  let restoreRepair = () => {};
  let observer = null;
  let lastAuthority = "";
  let lastPresentation = "";
  const record = (kind, data) => bounded(state.entries, {
    time: numberValue(performance.timeOrigin + performance.now()),
    kind: token(kind),
    data,
  }, MAX_ENTRIES);
  const sampleController = (snapshot) => {
    const doc = snapshot?.document;
    const runtime = snapshot?.editRuntime;
    const data = {
      document: doc ? {
        receipt: identity(doc.sourceReceipt),
        context: identity(doc.sourceReceipt?.context),
        canvasAuthority: doc.canvasAuthority ? {
          status: token(doc.canvasAuthority.status),
          generation: integer(doc.canvasAuthority.generation),
          renderedSha256: token(doc.canvasAuthority.renderedSha256),
        } : null,
        canvasGeneration: numberValue(doc.canvasGeneration),
        workingHtmlSha256: token(doc.workingHtmlSha256),
        persistedSourceSha256: token(doc.persistedSourceSha256),
        editRevision: integer(doc.editRevision),
        lastPersistedRevision: integer(doc.lastPersistedRevision),
        persistState: token(doc.persistState),
        hasPendingWrite: Boolean(doc.hasPendingWrite),
        isFlushing: Boolean(doc.isFlushing),
      } : null,
      runtime: runtime ? {
        phase: token(runtime.phase),
        lastOutcome: token(runtime.lastOutcome),
        canvasGeneration: numberValue(runtime.canvasGeneration),
        sourceSha256: token(runtime.sourceSha256),
      } : null,
      context: identity(snapshot?.projectSession),
      openTarget: identity(snapshot?.projectSession?.openTarget),
    };
    const encoded = JSON.stringify(data);
    if (encoded !== lastAuthority) {
      lastAuthority = encoded;
      record("authority", data);
    }
  };
  const restore = () => {
    try { restoreRepair(); } catch { /* optional observer cleanup */ }
  };
  const installRepairObserver = () => {
    const main = document.querySelector("main.workbench");
    let fiber = main?.[Object.keys(main || {}).find((key) => key.startsWith("__reactFiber$"))];
    while (fiber && !controller) {
      let hook = fiber.memoizedState;
      while (hook && !controller) {
        const value = hook.memoizedState;
        if (value && typeof value.repairDocumentCanvas === "function") controller = value;
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    if (!controller) return;
    try {
      const receivedUnsubscribe = controller.subscribe(sampleController);
      unsubscribe = typeof receivedUnsubscribe === "function" ? receivedUnsubscribe : () => {};
    } catch { unsubscribe = () => {}; }
    const original = controller.repairDocumentCanvas;
    const owned = Object.hasOwn(controller, "repairDocumentCanvas");
    const observedRepair = function observedRepair(input) {
      record("repair-start", {
        context: identity(input?.context),
        receipt: identity(input?.expectedSourceReceipt),
      });
      let outcome;
      try {
        outcome = original.call(this, input);
      } catch (cause) {
        record("repair-result", { status: "threw", code: token(cause?.code) });
        throw cause;
      }
      try {
        if (outcome && typeof outcome.then === "function") {
          void outcome.then((value) => record("repair-result", {
            status: token(value?.status),
            code: token(value?.code),
            page: token(value?.value?.page?.status),
            receipt: identity(value?.value?.source?.receipt),
            context: identity(value?.value?.source?.receipt?.context),
          }), (cause) => record("repair-result", {
            status: "rejected",
            code: token(cause?.code),
          }));
        }
      } catch { /* observing a thenable is optional */ }
      return outcome;
    };
    try {
      controller.repairDocumentCanvas = observedRepair;
      restoreRepair = () => {
        if (controller.repairDocumentCanvas !== observedRepair) return;
        if (owned) controller.repairDocumentCanvas = original;
        else delete controller.repairDocumentCanvas;
      };
    } catch { restoreRepair = () => {}; }
  };
  const sample = () => {
    if (state.stopped) return;
    try {
      if (!controller) installRepairObserver();
      const data = {
        surface: attrs(document.querySelector(".canvas-edit-surface")),
        editor: attrs(document.querySelector('[data-testid="html-canvas-editor"]')),
        frames: [...document.querySelectorAll("iframe[data-runtime-slot]")].map(attrs),
        authorCounts: {
          retry: integer(window.__STEMMIO_RUNTIME_RETRY_COUNT__),
          history: integer(window.__STEMMIO_TEXT_HISTORY_RUNTIME_COUNT__),
          recovery: integer(window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__),
        },
      };
      const encoded = JSON.stringify(data);
      if (encoded !== lastPresentation) {
        lastPresentation = encoded;
        record("presentation", data);
      }
    } catch { /* optional observer sampling */ }
  };
  const stop = () => {
    if (state.stopped) return;
    state.stopped = true;
    try { observer?.disconnect(); } catch { /* optional observer cleanup */ }
    try { unsubscribe(); } catch { /* optional subscription cleanup */ }
    try { restore(); } catch { /* optional wrapper cleanup */ }
  };
  try {
    observer = new MutationObserver(() => {
      try { sample(); } catch { /* optional observer callback */ }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__ = {
      armedAt: state.armedAt,
      caseId: state.caseId,
      read: () => {
        try { sample(); } catch { /* optional final sample */ }
        const values = (name, map, limit = MAX_EVENTS) => (
          Array.isArray(window[name])
            ? window[name].slice(-limit).map(map).filter(Boolean)
            : []
        );
        return {
          armedAt: state.armedAt,
          caseId: state.caseId,
          entries: state.entries.slice(-MAX_ENTRIES),
          authorCounts: {
            retry: integer(window.__STEMMIO_RUNTIME_RETRY_COUNT__),
            history: integer(window.__STEMMIO_TEXT_HISTORY_RUNTIME_COUNT__),
            recovery: integer(window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__),
          },
          authorEvents: values("__STEMMIO_RUNTIME_RETRY_EVENTS__", retryEvent),
          recoveryEvents: values("__STEMMIO_RUNTIME_RECOVERY_EVENTS__", retryEvent),
          historyEvents: values("__STEMMIO_TEXT_HISTORY_RUNTIME_EVENTS__", historyEvent),
          historySteps: values("__STEMMIO_TEXT_HISTORY_RUNTIME_STEPS__", historyStep, MAX_STEPS),
          retrySlotTransitions: values(
            "__STEMMIO_RUNTIME_RETRY_SLOT_TRANSITIONS__",
            slotTransition,
          ),
        };
      },
      stop,
    };
    sample();
  } catch (cause) {
    try { observer?.disconnect(); } catch { /* optional partial observer cleanup */ }
    try { unsubscribe(); } catch { /* optional partial subscription cleanup */ }
    try { restore(); } catch { /* optional partial wrapper cleanup */ }
    throw cause;
  }
}

export async function withRuntimeFailureEvidence(page, testInfo, run, options = {}) {
  let primaryError = null;
  let hadFailure = false;
  let result;
  try {
    try {
      await page.evaluate(installRuntimeFailureEvidence, options.caseId || null);
    } catch { /* optional observation must not replace a product assertion */ }
    try {
      result = await run();
    } catch (cause) {
      hadFailure = true;
      primaryError = cause;
    }
    let evidence = null;
    try {
      evidence = await page.evaluate(() => window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__?.read());
    } catch { /* page may already be closed */ }
    try {
      await testInfo.attach("runtime-failure-evidence", {
        body: JSON.stringify(evidence ?? { unavailable: true }, null, 2),
        contentType: "application/json",
      });
    } catch { /* optional attachment must not alter the product result */ }
    if (hadFailure) throw primaryError;
    return result;
  } finally {
    try {
      await page.evaluate(() => {
        try { window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__?.stop(); } catch { /* optional stop */ }
        try { delete window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__; } catch { /* optional delete */ }
      });
    } catch { /* optional diagnostic teardown must not replace product result */ }
  }
}
