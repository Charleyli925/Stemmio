// Preserve the first error while retaining the source/Canvas timeline that a
// final accessibility snapshot cannot show. Never change product state.
export async function withRuntimeFailureEvidence(page, testInfo, run) {
  try {
    await page.evaluate(() => {
      const entries = [];
      let controller = null;
      let unsubscribe = () => {};
      let restoreRepair = () => {};
      let lastSnapshot = '';
      let lastDom = '';
      const record = (kind, data) => {
        entries.push({ time: performance.now(), kind, data });
        if (entries.length > 1000) entries.shift();
      };
      const identity = value => value ? Object.fromEntries([
        'epoch', 'sessionEpoch', 'sessionIncarnation', 'sequence', 'origin',
        'operationId', 'editRevision', 'canvasGeneration', 'sourceSha256',
        'projectId', 'documentId', 'targetKind', 'workingCopyId', 'versionId',
      ].map(key => [key, value[key]])) : null;
      const sampleController = snapshot => {
        const doc = snapshot.document;
        const runtime = snapshot.editRuntime;
        const data = {
          document: doc ? {
            receipt: identity(doc.sourceReceipt),
            context: identity(doc.sourceReceipt?.context),
            canvasAuthority: doc.canvasAuthority,
            canvasGeneration: doc.canvasGeneration,
            workingHtmlSha256: doc.workingHtmlSha256,
            persistedSourceSha256: doc.persistedSourceSha256,
            editRevision: doc.editRevision,
            lastPersistedRevision: doc.lastPersistedRevision,
            persistState: doc.persistState,
            hasPendingWrite: doc.hasPendingWrite,
            isFlushing: doc.isFlushing,
          } : null,
          runtime: runtime ? {
            phase: runtime.phase,
            lastOutcome: runtime.lastOutcome,
            canvasGeneration: runtime.canvasGeneration,
            sourceSha256: runtime.sourceSha256,
          } : null,
          context: identity(snapshot.projectSession),
          openTarget: identity(snapshot.projectSession?.openTarget),
        };
        const encoded = JSON.stringify(data);
        if (encoded !== lastSnapshot) { lastSnapshot = encoded; record('authority', data); }
      };
      const sample = () => {
        if (!controller) {
          const main = document.querySelector('main.workbench');
          let fiber = main?.[Object.keys(main).find(key => key.startsWith('__reactFiber$'))];
          while (fiber && !controller) {
            let hook = fiber.memoizedState;
            while (hook && !controller) {
              const value = hook.memoizedState;
              if (value && typeof value.repairDocumentCanvas === 'function') controller = value;
              hook = hook.next;
            }
            fiber = fiber.return;
          }
          if (controller) {
            unsubscribe = controller.subscribe(sampleController);
            const original = controller.repairDocumentCanvas;
            const owned = Object.hasOwn(controller, 'repairDocumentCanvas');
            const observedRepair = function (input) {
              record('repair-start', { context: identity(input?.context), receipt: identity(input?.expectedSourceReceipt) });
              // Observe the same Promise; do not delay or replace its result.
              const result = original.call(this, input);
              void result.then(outcome => record('repair-result', {
                status: outcome.status,
                code: outcome.code,
                page: outcome.value?.page?.status,
                receipt: identity(outcome.value?.source?.receipt),
                context: identity(outcome.value?.source?.receipt?.context),
              }), cause => record('repair-rejected', { code: cause?.code }));
              return result;
            };
            controller.repairDocumentCanvas = observedRepair;
            restoreRepair = () => {
              if (controller.repairDocumentCanvas !== observedRepair) return;
              if (owned) controller.repairDocumentCanvas = original;
              else delete controller.repairDocumentCanvas;
            };
          }
        }
        const attributes = node => node ? Object.fromEntries([...node.attributes]
          .filter(a => /^(data-(runtime|frame|render|edit)|aria-readonly)/u.test(a.name))
          .map(a => [a.name, a.value])) : null;
        const data = {
          notice: document.querySelector('.workbench-chrome-status')?.textContent || null,
          fallback: document.querySelector('[data-testid="edit-runtime-static-fallback"]')?.textContent || null,
          surface: attributes(document.querySelector('.canvas-edit-surface')),
          editor: attributes(document.querySelector('[data-testid="html-canvas-editor"]')),
          frames: [...document.querySelectorAll('iframe[data-runtime-slot]')].map(attributes),
          authorCount: window.__STEMMIO_RUNTIME_RETRY_COUNT__,
        };
        const encoded = JSON.stringify(data);
        if (encoded !== lastDom) { lastDom = encoded; record('presentation', data); }
      };
      const observer = new MutationObserver(sample);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__ = {
        read: () => { sample(); return { entries, authorEvents: window.__STEMMIO_RUNTIME_RETRY_EVENTS__ || [] }; },
        stop: () => { observer.disconnect(); unsubscribe(); restoreRepair(); },
      };
      sample();
    });
  } catch { /* Optional observation must not replace a product assertion. */ }
  try {
    return await run();
  } catch (cause) {
    try {
      const evidence = await page.evaluate(() => window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__?.read());
      await testInfo.attach('runtime-failure-evidence', {
        body: JSON.stringify(evidence ?? { unavailable: true }, null, 2),
        contentType: 'application/json',
      });
    } catch { /* Keep the first test failure even if its page already closed. */ }
    throw cause;
  } finally {
    try {
      await page.evaluate(() => {
        window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__?.stop();
        delete window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__;
      });
    } catch { /* Teardown does not replace the first test failure. */ }
  }
}
