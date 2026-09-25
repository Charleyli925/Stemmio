import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditRuntimeBootstrap,
} from "../desktop/edit-runtime-bootstrap.mjs";

test("disposable runtime bootstrap proves the parsed source set before author work", () => {
  const source = createEditRuntimeBootstrap({
    executionId: "a".repeat(24),
    sessionId: "b".repeat(32),
  });

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /claimedIds/u);
  assert.match(source, /openRegistration/u);
  assert.match(source, /sessionId: config\.sessionId/u);
  assert.match(source, /executionId: config\.executionId/u);
  assert.match(source, /frameToken: config\.frameToken/u);
  assert.match(source, /registerProved/u);
  assert.match(source, /registerRuntimeShadowHost/u);
  assert.match(source, /reportActivationOutcome/u);
  assert.match(source, /canAcceptFocus/u);
  assert.match(source, /installFocusGuard/u);
  assert.match(source, /guardedRuntimeFocus/u);
  assert.match(source, /HTMLElement\.prototype/u);
  assert.match(source, /SVGElement\.prototype/u);
  assert.match(source, /installFocusGuard\(window, "focus"\)/u);
  assert.match(source, /trackedRuntimeAttachShadow/u);
  assert.match(source, /proveParsedSource/u);
  assert.match(source, /activateAuthorScripts/u);
  assert.match(source, /DOMContentLoaded/u);
  assert.match(source, /readystatechange/u);
  assert.match(source, /holdDomContentLoaded/u);
  assert.match(source, /dispatchEvent\(new Event\("DOMContentLoaded"/u);
  assert.match(source, /placeholder\.replaceWith\(script\)/u);
  assert.match(source, /script\.addEventListener\("load"/u);
  assert.match(source, /script\.addEventListener\("error"/u);
  assert.match(source, /window\.addEventListener\("error"/u);
  assert.match(source, /window\.addEventListener\("unhandledrejection"/u);
  assert.match(source, /activation-resource-failed/u);
  assert.match(source, /activation-author-error/u);
  assert.match(source, /activation-ready/u);
  assert.match(source, /authorErrorCount/u);
  assert.match(source, /resourceFailureCount/u);
  assert.match(source, /attemptedScriptCount/u);
  assert.match(source, /elapsedMs/u);
  assert.match(source, /activationReported/u);
  assert.match(source, /activateAuthorScripts\(asyncSettlements\)/u);
  assert.ok(
    source.indexOf('dispatchEvent(new Event("DOMContentLoaded"')
      < source.indexOf("Promise.all(asyncSettlements)"),
    "async author scripts must not block deferred DOMContentLoaded",
  );
  assert.doesNotMatch(source, /MutationObserver/u);
  assert.match(source, /markerAttribute \+ "\],\[" \+ config\.stableIdAttribute/u);
  assert.match(source, /data-stemmio-edit-runtime-source/u);
  assert.match(source, /data-stemmio-id/u);
  assert.doesNotMatch(source, /data-html-ai-source-node-id/u);
  assert.doesNotMatch(source, /__stemmio_edit_source_/u);
  assert.match(source, /event\.preventDefault/u);
  assert.doesNotMatch(source, /setInterval|clearInterval|requestAnimationFrame/u);
  assert.doesNotMatch(source, /getAnimations|MessageChannel|postMessage|runtimeQuietFrames/u);
  assert.doesNotMatch(
    source,
    /querySelector(All)?\(["']canvas|getBoundingClientRect|offsetWidth|offsetHeight/u,
  );
  assert.doesNotMatch(source, /edit-runtime-frozen|edit-runtime-result/u);
  assert.doesNotMatch(source, /window\.fetch\s*=/u);
  assert.doesNotMatch(source, /window\.Worker\s*=/u);
  assert.doesNotMatch(source, /mutationRecordLimit/u);
  assert.doesNotMatch(source, /eval\s*\(/u);
});
