import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";

const HOST_ID = "sm1_11111111111141118111111111111111";
const DETAILS_ID = "sm1_22222222222242229222222222222222";
const PROJECTION_LAYER_TEST_STYLE = `<style>
  [data-stemmio-review-projection-layer],
  [data-stemmio-review-mask-layer],
  [data-stemmio-review-text-marks],
  [data-stemmio-review-overlay-box] {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    pointer-events: none !important;
  }
</style>`;

async function observe(page, {
  body = `<main data-stemmio-id="${HOST_ID}">same</main>`,
  authoredScript = "",
  readySelector = "",
  present = true,
  side = "after",
} = {}) {
  const bootstrap = generatedReviewBootstrap([], side, [HOST_ID]);
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}</style><script>${bootstrap}</script></head><body>${body}<script>${authoredScript}</script></body></html>`, {
    waitUntil: "load",
  });
  if (readySelector) await page.locator(readySelector).waitFor({ state: "attached" });
  return page.evaluate(async ({ side, stableId, present }) => {
    let port = null;
    const receive = (event) => {
      if (event.data?.type === "review-visual-channel") port = event.ports?.[0] || null;
    };
    addEventListener("message", receive);
    try {
      postMessage({
        source: "stemmio-ai-review-parent",
        sessionId: "review-session",
        type: "request-review-visual-channel",
        challenge: "c".repeat(32),
      }, "*");
      const deadline = Date.now() + 3_000;
      while (!port && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!port) throw new Error("visual capability port did not arrive");
      return await new Promise((resolve) => {
        port.onmessage = (event) => resolve(event.data.observations[0]);
        port.postMessage({
          type: "observe",
          sessionId: "review-session",
          side,
          sourceHash: `sha256:${side}`,
          generation: 7,
          candidates: [{ stableId, present }],
        });
      });
    } finally {
      removeEventListener("message", receive);
    }
  }, { side, stableId: HOST_ID, present });
}

test("structured Review presentation reveals a panel and details before focus", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  const bootstrap = generatedReviewBootstrap([], "after", []);
  await page.setContent(`<!doctype html><html><head><script>${bootstrap}</script></head><body>
    <button aria-controls="hidden-panel" aria-selected="false"
      data-stemmio-review-panel-control="true"
      data-stemmio-review-panel-group="panel-group-1"
      data-stemmio-review-panel-key="panel-1">隐藏面板</button>
    <section id="hidden-panel" hidden aria-hidden="true"
      data-stemmio-review-panel-container="true"
      data-stemmio-review-panel-group="panel-group-1"
      data-stemmio-review-panel-key="panel-1">
      <details data-stemmio-id="${DETAILS_ID}"><summary>说明</summary><p>目标内容</p></details>
    </section>
  </body></html>`);

  const state = await page.evaluate(async ({ stableId }) => {
    const epoch = 7;
    const ready = new Promise((resolve) => {
      const receive = (event) => {
        if (event.data?.source !== "stemmio-ai-review"
          || event.data?.type !== "presentation-ready"
          || event.data?.presentationEpoch !== epoch) return;
        removeEventListener("message", receive);
        resolve(true);
      };
      addEventListener("message", receive);
    });
    postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "begin-presentation",
      presentationEpoch: epoch,
    }, "*");
    postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "activate-presentation",
      presentationEpoch: epoch,
      revealSteps: [
        { kind: "panel", key: "panel-1" },
        { kind: "details", stableId },
      ],
    }, "*");
    await ready;
    const panel = document.querySelector("#hidden-panel");
    const details = document.querySelector(`details[data-stemmio-id="${stableId}"]`);
    return {
      panelHidden: panel.hidden,
      panelAriaHidden: panel.getAttribute("aria-hidden"),
      detailsOpen: details.open,
    };
  }, { stableId: DETAILS_ID });

  expect(state).toEqual({
    panelHidden: false,
    panelAriaHidden: "false",
    detailsOpen: true,
  });
});

test("visual summaries ignore page position and class source noise but detect presentation", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  const baseline = await observe(page, {
    body: `<main style="margin-left:0"><p data-stemmio-id="${HOST_ID}" class="old">same</p></main>`,
  });
  const shifted = await observe(page, {
    body: `<main style="transform:translate(.5px,120px)"><p data-stemmio-id="${HOST_ID}" class="new">same</p></main>`,
  });
  expect(baseline.unverified).not.toBe(true);
  expect(shifted.unverified).not.toBe(true);
  expect(shifted.fingerprint).toBe(baseline.fingerprint);

  const recolored = await observe(page, {
    body: `<p data-stemmio-id="${HOST_ID}" style="color:rgb(200,0,0)">same</p>`,
  });
  expect(recolored.fingerprint).not.toBe(baseline.fingerprint);
});

test("visual summaries cover text, runtime DOM, SVG and Canvas drawing surfaces", async ({ page }) => {
  const text = await observe(page, { body: `<p data-stemmio-id="${HOST_ID}">changed</p>` });
  const contentsBefore = await observe(page, {
    body: `<p data-stemmio-id="${HOST_ID}">stable <span style="display:contents">old</span></p>`,
  });
  const contentsAfter = await observe(page, {
    body: `<p data-stemmio-id="${HOST_ID}">stable <span style="display:contents">new</span></p>`,
  });
  const runtime = await observe(page, {
    body: `<main data-stemmio-id="${HOST_ID}"></main>`,
    authoredScript: "document.querySelector('main').append(Object.assign(document.createElement('strong'), { textContent: 'runtime' }))",
  });
  const svg = await observe(page, {
    body: `<svg data-stemmio-id="${HOST_ID}" width="80" height="40"><path d="M0 0 L70 30" stroke="red"/></svg>`,
  });
  const canvas = await observe(page, {
    body: `<canvas data-stemmio-id="${HOST_ID}" width="80" height="40"></canvas>`,
    authoredScript: "const c=document.querySelector('canvas').getContext('2d');c.fillStyle='blue';c.fillRect(4,4,30,20);c.fillText('42',40,20)",
  });
  for (const result of [text, runtime, svg, canvas]) {
    expect(result.visible).toBe(true);
    expect(result.unverified).not.toBe(true);
    expect(result.fingerprint).toMatch(/^\d+:\d+$/u);
  }
  expect(new Set([text.fingerprint, runtime.fingerprint, svg.fingerprint, canvas.fingerprint]).size)
    .toBe(4);
  expect(contentsAfter.fingerprint).not.toBe(contentsBefore.fingerprint);
});

test("a forged replacement carrying the same Stable ID fails closed", async ({ page }) => {
  const replaced = await observe(page, {
    body: `<main data-stemmio-id="${HOST_ID}">source host</main>`,
    authoredScript: `
      const sourceHost = document.querySelector('[data-stemmio-id="${HOST_ID}"]');
      const replacement = document.createElement('main');
      replacement.setAttribute('data-stemmio-id', '${HOST_ID}');
      replacement.textContent = 'forged host';
      sourceHost.removeAttribute('data-stemmio-id');
      sourceHost.replaceWith(replacement);
    `,
  });
  expect(replaced).toMatchObject({
    unverified: true,
    failureReason: "missing-runtime-host",
  });
});

test("image content and visibility use rendered evidence rather than source URL alone", async ({ page }) => {
  const svgImage = (color, padding = "") => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">${padding}<rect width="8" height="8" fill="${color}"/></svg>`)}`;
  const red = await observe(page, {
    body: `<img data-stemmio-id="${HOST_ID}" src="${svgImage("red")}">`,
  });
  const sameRedDifferentBytes = await observe(page, {
    body: `<img data-stemmio-id="${HOST_ID}" src="${svgImage("red", " ")}">`,
  });
  const blue = await observe(page, {
    body: `<img data-stemmio-id="${HOST_ID}" src="${svgImage("blue")}">`,
  });
  const hidden = await observe(page, {
    body: `<p data-stemmio-id="${HOST_ID}" style="display:none">hidden</p>`,
  });
  expect(red.fingerprint).toBe(sameRedDifferentBytes.fingerprint);
  expect(blue.fingerprint).not.toBe(red.fingerprint);
  expect(hidden).toMatchObject({ visible: false });
  expect(hidden.unverified).not.toBe(true);
});

test("unsupported animated, media, WebGL and over-budget surfaces fail closed", async ({ page }) => {
  const animated = await observe(page, {
    body: `<style>@keyframes pulse{to{opacity:.4}}</style><main data-stemmio-id="${HOST_ID}" style="animation:pulse 1s infinite">moving</main>`,
  });
  const media = await observe(page, {
    body: `<main data-stemmio-id="${HOST_ID}"><video></video></main>`,
  });
  const webgl = await observe(page, {
    body: `<canvas data-stemmio-id="${HOST_ID}" width="20" height="20"></canvas>`,
    authoredScript: "document.querySelector('canvas').getContext('webgl')",
  });
  const overBudget = await observe(page, {
    body: `<canvas data-stemmio-id="${HOST_ID}" width="2100" height="2100"></canvas>`,
  });
  expect(animated).toMatchObject({ unverified: true, failureReason: "animation" });
  expect(media).toMatchObject({ unverified: true, failureReason: "live-media" });
  expect(webgl).toMatchObject({ unverified: true, failureReason: "webgl-or-unreadable-canvas" });
  expect(overBudget).toMatchObject({ unverified: true, failureReason: "global-pixel-budget" });
});

test("a delayed runtime mutation is never frozen into an unchanged verdict", async ({ page }) => {
  const delayed = await observe(page, {
    body: `<main data-stemmio-id="${HOST_ID}">initial</main>`,
    authoredScript: `setTimeout(() => {
      document.querySelector('main').textContent = 'final content';
    }, 500)`,
  });
  expect(delayed).toMatchObject({ unverified: true, failureReason: "unstable" });
});

test("the observation plan reports every candidate beyond 1000 without silent truncation", async ({ page }) => {
  test.setTimeout(30_000);
  const stableId = (index) => `sm1_${index.toString(16).padStart(12, "0")}40008${"0".repeat(15)}`;
  const stableIds = Array.from({ length: 1_001 }, (_, index) => stableId(index + 1));
  const bootstrap = generatedReviewBootstrap([], "after", stableIds);
  await page.setContent(`<!doctype html><script>${bootstrap}</script>${stableIds.map((id, index) => (
    `<span data-stemmio-id="${id}">${index}</span>`
  )).join("")}`);
  const observations = await page.evaluate(async ({ ids }) => {
    let port = null;
    addEventListener("message", (event) => {
      if (event.data?.type === "review-visual-channel") port = event.ports?.[0] || null;
    }, { once: true });
    postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "request-review-visual-channel",
      challenge: "e".repeat(32),
    }, "*");
    const deadline = Date.now() + 5_000;
    while (!port && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return await new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data.observations);
      port.postMessage({
        type: "observe",
        sessionId: "review-session",
        side: "after",
        sourceHash: "sha256:after",
        generation: 9,
        candidates: ids.map((id) => ({ stableId: id, present: true })),
      });
    });
  }, { ids: stableIds });
  expect(observations).toHaveLength(1_001);
  expect(observations.at(-1)?.stableId).toBe(stableIds.at(-1));
});

test("a genuinely tainted Canvas proves the unreadable branch", async ({ page }) => {
  const image = readFileSync(new URL("../../../public/favicon.png", import.meta.url));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(image);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await observe(page, {
      body: `<canvas data-stemmio-id="${HOST_ID}" width="64" height="64"></canvas>`,
      authoredScript: `
        const image = new Image();
        image.src = 'http://127.0.0.1:${address.port}/favicon.png';
        image.onload = () => {
          const canvas = document.querySelector('canvas');
          canvas.getContext('2d').drawImage(image,0,0,32,32);
          canvas.dataset.taintedReady = 'true';
        };
      `,
      readySelector: '[data-tainted-ready="true"]',
    });
    expect(result).toMatchObject({ unverified: true, failureReason: "tainted-canvas" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("source projection activates existing text UI without creating replacement changes", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  // Earlier cases install bootstrap listeners in the same Playwright page.
  // Navigate once so this stateful focus assertion owns a fresh Window realm.
  await page.goto("about:blank");
  const factValue = {
    id: "text-1",
    type: "text",
    semanticOwnerId: "semantic-owner-1",
    geometryOwnerId: "geometry-owner-1",
    scope: "text",
    tone: "added",
    textGroup: "text-group-1",
    displayGroupId: "display-text-1",
    displayOwnerId: "display-owner-1",
    displayScope: "paragraph",
    geometryMode: "text-content",
    operation: "insert",
    summary: "新增内容",
  };
  const atomKey = `change-1\u001e${[
    factValue.type,
    factValue.id,
    factValue.semanticOwnerId,
    factValue.geometryOwnerId,
  ].join("\u001f")}`;
  const focusGroupPlans = [{
    id: "focus-change-1-display-text-1",
    kind: "text",
    changeId: "change-1",
    changeIds: ["change-1"],
    displayGroupId: "display-text-1",
    displayScope: "paragraph",
    focusOutlinePolicy: "never",
    atomKeys: [atomKey],
    presentation: { before: [], after: [] },
    regions: {
      before: [],
      after: [{
        id: "region-after-text-1",
        side: "after",
        correlationKey: "locality-text-1",
        primaryChangeId: "change-1",
        changeIds: ["change-1"],
        geometryMode: "text-content",
        displayOwnerIds: ["display-owner-1"],
        atomKeys: [atomKey],
        presentation: [],
      }],
    },
    presence: { before: false, after: true },
  }];
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [HOST_ID],
    focusGroupPlans,
    [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script><p data-stemmio-id="${HOST_ID}" data-stemmio-review-geometry-owner="geometry-owner-1" data-stemmio-review-display-owner="display-owner-1"><span data-stemmio-review-text="added" data-stemmio-review-marker="change-1" data-stemmio-review-marker-types="text" data-stemmio-review-summary="新增内容" data-stemmio-review-projection-facts="${fact}">new</span></p>`);
  await expect(page.locator('[data-stemmio-review-overlay-box="change-1"]')).toHaveCount(0);
  await expect(page.locator('[data-stemmio-review-text-mark="added"]')).not.toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-mask-dim]")).toHaveCount(0);
  const activated = await page.evaluate(async ({ stableId }) => {
    let port = null;
    addEventListener("message", (event) => {
      if (event.data?.type === "review-visual-channel") port = event.ports?.[0] || null;
    }, { once: true });
    postMessage({ source: "stemmio-ai-review-parent", sessionId: "review-session", type: "request-review-visual-channel", challenge: "d".repeat(32) }, "*");
    const deadline = Date.now() + 3_000;
    while (!port && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    port.postMessage({
      type: "verdicts",
      sessionId: "review-session",
      side: "after",
      changed: [{ id: "change-1", stableId, types: ["text"] }],
    });
    window.__reviewTestVisualPort = port;
    port.postMessage({
      type: "comment-highlight",
      sessionId: "review-session",
      side: "after",
      active: true,
      stableIds: [stableId],
    });
    return Boolean(port);
  }, { stableId: HOST_ID });
  expect(activated).toBe(true);
  const focusGroupId = await page.locator("[data-stemmio-review-region-bar]")
    .first().getAttribute("data-stemmio-review-focus-group");
  expect(focusGroupId).toBeTruthy();
  await page.evaluate((activeFocusGroupId) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "state",
    state: {
      focus: "change-1",
      activeFocusGroupId,
      transparency: 25,
      scale: 1,
    },
  }, "*"), focusGroupId);
  await expect(page.locator("html"))
    .toHaveAttribute("data-stemmio-review-focus-group", "");
  await expect(page.locator('[data-stemmio-review-overlay-box="change-1"]')).toHaveCount(0);
  await expect(page.locator('[data-stemmio-review-text-mark="added"]')).not.toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-mask-dim]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-comment-mask-dim]"))
    .toHaveAttribute("fill-opacity", "0.85");
  await expect(page.locator("[data-stemmio-review-comment-highlight]")).toHaveCount(1);
  await page.evaluate(() => window.__reviewTestVisualPort.postMessage({
    type: "comment-highlight",
    sessionId: "review-session",
    side: "after",
    active: false,
    stableIds: [],
  }));
  await expect(page.locator("[data-stemmio-review-comment-highlight]")).toHaveCount(0);
  await expect(page.locator("html"))
    .toHaveAttribute("data-stemmio-review-focus-group", focusGroupId);
  await expect(page.locator("[data-stemmio-review-mask-dim]"))
    .toHaveAttribute("fill-opacity", "0.75");
  await expect(page.locator('[data-stemmio-review-overlay-box="change-1"]')).toHaveCount(0);
});

function exactTextFocusFixture() {
  const factValue = {
    id: "text-1",
    type: "text",
    semanticOwnerId: "semantic-owner-1",
    geometryOwnerId: "geometry-owner-1",
    scope: "text",
    tone: "added",
    textGroup: "text-group-1",
    displayGroupId: "display-text-1",
    displayOwnerId: "display-owner-1",
    displayScope: "paragraph",
    geometryMode: "text-content",
    operation: "insert",
    summary: "新增内容",
  };
  const atomKey = `change-1\u001e${[
    factValue.type,
    factValue.id,
    factValue.semanticOwnerId,
    factValue.geometryOwnerId,
  ].join("\u001f")}`;
  const region = {
    id: "region-after-text-1",
    side: "after",
    correlationKey: "locality-text-1",
    primaryChangeId: "change-1",
    changeIds: ["change-1"],
    geometryMode: "text-content",
    displayOwnerIds: ["display-owner-1"],
    atomKeys: [atomKey],
    presentation: [],
  };
  const plan = {
    id: "focus-change-1-display-text-1",
    kind: "text",
    changeId: "change-1",
    changeIds: ["change-1"],
    displayGroupId: "display-text-1",
    displayScope: "paragraph",
    focusOutlinePolicy: "never",
    atomKeys: [atomKey],
    presentation: { before: [], after: [] },
    regions: { before: [], after: [region] },
    presence: { before: false, after: true },
  };
  return { atomKey, factValue, plan };
}

test("an invalid semantic plan preserves exact source evidence without a box or mask", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const oversizedPlans = Array.from({ length: 257 }, (_, index) => ({
    ...plan,
    id: `focus-change-1-display-text-${index + 1}`,
    displayGroupId: `display-text-${index + 1}`,
    regions: {
      before: [],
      after: [{
        ...plan.regions.after[0],
        id: `region-after-text-${index + 1}`,
        correlationKey: `locality-text-${index + 1}`,
      }],
    },
  }));
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    oversizedPlans,
    [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script><p data-stemmio-review-display-owner="display-owner-1"><span data-stemmio-review-text="added" data-stemmio-review-marker="change-1" data-stemmio-review-projection-facts="${fact}">new</span></p>`);
  await expect(page.locator('[data-stemmio-review-text-mark="added"]')).not.toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-region-bar]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-mask-dim]")).toHaveCount(0);
});

test("one exact text atom may span several markers but remains one borderless focus mask", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    [plan],
    [{ atomKey, count: 2 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script><p data-stemmio-review-display-owner="display-owner-1"><span data-stemmio-review-text="added" data-stemmio-review-marker="change-1" data-stemmio-review-projection-facts="${fact}">new</span> context <span data-stemmio-review-text="added" data-stemmio-review-marker="change-1" data-stemmio-review-projection-facts="${fact}">words</span></p>`);
  await expect(page.locator('[data-stemmio-review-text-mark="added"]')).toHaveCount(8);
  await page.evaluate(() => {
    Array.prototype.flatMap = () => [];
    Array.prototype.find = () => undefined;
    Array.prototype.some = () => false;
    Array.prototype.filter = () => [];
    Array.prototype.map = () => [];
    Array.prototype.forEach = () => {};
    Element.prototype.contains = () => false;
  });
  await page.evaluate((activeFocusGroupId) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "state",
    state: { focus: "change-1", activeFocusGroupId, transparency: 25, scale: 1 },
  }, "*"), plan.id);
  const box = page.locator('[data-stemmio-review-overlay-box="change-1"]');
  const hole = page.locator("[data-stemmio-review-mask-hole]");
  await expect(box).toHaveCount(0);
  await expect(hole).toHaveCount(1);
  expect(await hole.getAttribute("d")).toBeTruthy();
});

test("review navigation acknowledges only locatable geometry and honors cancellation", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const bootstrap = generatedReviewBootstrap(
    [], "after", [], [plan], [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script>
    <p id="owner" style="display:none" data-stemmio-review-display-owner="display-owner-1">
      <span data-stemmio-review-text="added" data-stemmio-review-marker="change-1"
        data-stemmio-review-projection-facts="${fact}">new</span>
    </p>`);
  await page.evaluate(() => {
    window.__reviewNavigationResults = [];
    addEventListener("message", (event) => {
      if (event.data?.source === "stemmio-ai-review"
        && event.data?.type === "navigation-result") {
        window.__reviewNavigationResults.push(event.data);
      }
    });
  });
  const navigate = (commandId) => page.evaluate(({ commandId, plan }) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "navigate-change",
    commandId,
    changeId: plan.changeId,
    focusGroupId: plan.id,
    regionId: plan.regions.after[0].id,
    revealSteps: [],
    behavior: "auto",
  }, "*"), { commandId, plan });

  await navigate("initial-nav-hidden");
  await expect.poll(() => page.evaluate(() => window.__reviewNavigationResults))
    .toContainEqual(expect.objectContaining({ commandId: "initial-nav-hidden", located: false }));

  await page.locator("#owner").evaluate((element) => { element.style.display = "block"; });
  await navigate("initial-nav-visible");
  await expect.poll(() => page.evaluate(() => window.__reviewNavigationResults))
    .toContainEqual(expect.objectContaining({ commandId: "initial-nav-visible", located: true }));

  await page.evaluate((planValue) => {
    postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "navigate-change",
      commandId: "initial-nav-cancelled",
      changeId: planValue.changeId,
      focusGroupId: planValue.id,
      regionId: planValue.regions.after[0].id,
      revealSteps: [],
      behavior: "auto",
    }, "*");
    postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "cancel-navigation",
      commandId: "initial-nav-cancelled",
    }, "*");
  }, plan);
  await page.locator("html").evaluate(() => new Promise((resolve) => (
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )));
  expect(await page.evaluate(() => window.__reviewNavigationResults.some(
    (result) => result.commandId === "initial-nav-cancelled",
  ))).toBe(false);
});

test("Escape inside every valid contenteditable form stays with the editor", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    [plan],
    [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script>
    <p data-stemmio-review-display-owner="display-owner-1">
      <span data-stemmio-review-text="added" data-stemmio-review-marker="change-1"
        data-stemmio-review-projection-facts="${fact}">new</span>
    </p>
    <p id="bare-editable" contenteditable>bare editable</p>
    <p id="plaintext-editable" contenteditable="plaintext-only">plaintext editable</p>`);
  await page.evaluate((activeFocusGroupId) => {
    window.__reviewLeaveFocusMessages = 0;
    addEventListener("message", (event) => {
      if (event.data?.source === "stemmio-ai-review" && event.data?.type === "leave-focus") {
        window.__reviewLeaveFocusMessages += 1;
      }
    });
    postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "state",
      state: {
        focus: "change-1",
        activeFocusGroupId,
        transparency: 25,
        scale: 1,
      },
    }, "*");
  }, plan.id);
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-mask-dim]")).toHaveCount(1);
  for (const selector of ["#bare-editable", "#plaintext-editable"]) {
    await page.locator(selector).press("Escape");
    await expect(page.locator("[data-stemmio-review-mask-dim]")).toHaveCount(1);
  }
  await expect.poll(() => page.evaluate(() => window.__reviewLeaveFocusMessages)).toBe(0);
});

test("text-content geometry stays inside one loose reading flow of a complex item", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const bootstrap = generatedReviewBootstrap(
    [], "after", [], [plan], [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html>${PROJECTION_LAYER_TEST_STYLE}<style>li{width:320px}#nested-block{margin:90px 0}</style>
    <script>${bootstrap}</script><ul><li data-stemmio-review-geometry-owner="geometry-owner-1"
      data-stemmio-review-display-owner="display-owner-1">
      prefix <span data-stemmio-review-text="added" data-stemmio-review-marker="change-1"
        data-stemmio-review-projection-facts="${fact}">new</span> context
      <p id="nested-block">unchanged nested paragraph</p>
      unchanged suffix
    </li></ul>`);
  await page.evaluate((activeFocusGroupId) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "state",
    state: { focus: "change-1", activeFocusGroupId, transparency: 25, scale: 1 },
  }, "*"), plan.id);
  const hole = page.locator("[data-stemmio-review-mask-hole]");
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
  await expect(hole).toHaveCount(1);
  const geometry = await page.evaluate(() => ({
    holeBottom: Number(document.querySelector("[data-stemmio-review-mask-hole]").dataset.top)
      + Number(document.querySelector("[data-stemmio-review-mask-hole]").dataset.height),
    nested: document.querySelector("#nested-block").getBoundingClientRect().toJSON(),
  }));
  expect(geometry.holeBottom).toBeLessThan(geometry.nested.top);
  expect(await hole.getAttribute("d")).toBeTruthy();
});

test("numbered-line geometry ignores br elements inside nested blocks", async ({ page }) => {
  await page.goto("about:blank");
  const fixture = exactTextFocusFixture();
  fixture.factValue.displayScope = "list-item";
  fixture.factValue.geometryMode = "numbered-line-range";
  fixture.plan.displayScope = "list-item";
  fixture.plan.regions.after[0].geometryMode = "numbered-line-range";
  const bootstrap = generatedReviewBootstrap(
    [], "after", [], [fixture.plan], [{ atomKey: fixture.atomKey, count: 1 }],
  );
  const fact = JSON.stringify([fixture.factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html>${PROJECTION_LAYER_TEST_STYLE}<script>${bootstrap}</script><ul><li
    data-stemmio-review-geometry-owner="geometry-owner-1"
    data-stemmio-review-display-owner="display-owner-1">
    <p id="nested-lines">nested one<br>nested two</p>
    <span id="numbered-first">1. first line</span><br>
    <span>2. </span><span data-stemmio-review-text="added"
      data-stemmio-review-marker="change-1"
      data-stemmio-review-projection-facts="${fact}">new line</span>
  </li></ul>`);
  await page.evaluate((activeFocusGroupId) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "state",
    state: { focus: "change-1", activeFocusGroupId, transparency: 25, scale: 1 },
  }, "*"), fixture.plan.id);
  const hole = page.locator("[data-stemmio-review-mask-hole]");
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
  await expect(hole).toHaveCount(1);
  const geometry = await page.evaluate(() => ({
    holeTop: Number(document.querySelector("[data-stemmio-review-mask-hole]").dataset.top),
    nested: document.querySelector("#nested-lines").getBoundingClientRect().toJSON(),
    first: document.querySelector("#numbered-first").getBoundingClientRect().toJSON(),
  }));
  expect(geometry.holeTop).toBeGreaterThanOrEqual(geometry.first.bottom - 3.5);
  expect(geometry.holeTop).toBeGreaterThan(geometry.nested.bottom);
});

test("a style locality stays on one visible owner and never promotes to its parent container", async ({ page }) => {
  await page.goto("about:blank");
  const changeId = "change-1";
  const facts = Array.from({ length: 4 }, (_, index) => ({
    id: `style-${index + 1}`,
    type: "structure",
    semanticOwnerId: `semantic-${index + 1}`,
    geometryOwnerId: `geometry-${index + 1}`,
    structureChange: "style",
    displayGroupId: "display-css-shared",
    displayOwnerId: `owner-${index + 1}`,
    displayScope: "component",
    geometryMode: "element-box",
    summary: "样式调整",
  }));
  const atomKeys = facts.map((fact) => `${changeId}\u001e${[
    fact.type, fact.id, fact.semanticOwnerId, fact.geometryOwnerId,
  ].join("\u001f")}`);
  const plan = {
    id: "focus-display-css-shared",
    kind: "style",
    changeId,
    changeIds: [changeId],
    displayGroupId: "display-css-shared",
    displayScope: "component",
    focusOutlinePolicy: "visual-change",
    atomKeys,
    presentation: { before: [], after: [] },
    regions: {
      before: [],
      after: [{
        id: "region-after-shared",
        side: "after",
        correlationKey: "locality-shared",
        primaryChangeId: changeId,
        changeIds: [changeId],
        geometryMode: "container-box",
        displayOwnerIds: facts.map((fact) => fact.displayOwnerId),
        atomKeys,
        presentation: [],
      }],
    },
    presence: { before: false, after: true },
  };
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    [plan],
    atomKeys.map((atomKey) => ({ atomKey, count: 1 })),
  );
  const targets = facts.map((fact, index) => {
    const serialized = JSON.stringify([fact]).replaceAll('"', "&quot;");
    const hidden = index < 3 ? ' style="display:none"' : "";
    return `<div data-stemmio-review-display-owner="${fact.displayOwnerId}"${hidden}
      data-stemmio-review-marker="${changeId}"
      data-stemmio-review-projection-facts="${serialized}">changed ${index + 1}</div>`;
  }).join("");
  await page.setContent(`<!doctype html>${PROJECTION_LAYER_TEST_STYLE}<style>
    #grid{display:grid;grid-template-columns:repeat(5,120px);gap:8px}
  </style><script>${bootstrap}</script><div id="grid">${targets}
    <div>unchanged 1</div><div>unchanged 2</div><div>unchanged 3</div><div>unchanged 4</div>
  </div>`);
  await page.evaluate((activeFocusGroupId) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "state",
    state: { focus: "change-1", activeFocusGroupId, transparency: 25, scale: 1 },
  }, "*"), plan.id);
  const hole = page.locator("[data-stemmio-review-mask-hole]");
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
  await expect(hole).toHaveCount(1);
  const geometry = await page.evaluate(() => ({
    holeWidth: Number(document.querySelector("[data-stemmio-review-mask-hole]").dataset.width),
    gridWidth: document.querySelector("#grid").getBoundingClientRect().width,
  }));
  expect(geometry.holeWidth).toBeLessThan(geometry.gridWidth / 2);
});

test("multi-screen table, list, and section owners keep navigation masks without giant outlines", async ({ page }) => {
  await page.goto("about:blank");
  const cases = ["table", "list", "section"].map((name, index) => {
    const changeId = `change-${index + 1}`;
    const ownerId = `owner-${name}`;
    const fact = {
      id: `structure-${name}`,
      type: "structure",
      semanticOwnerId: `semantic-${name}`,
      geometryOwnerId: `geometry-${name}`,
      structureChange: "reordered",
      displayGroupId: `display-${name}`,
      displayOwnerId: ownerId,
      displayScope: "container",
      geometryMode: "container-box",
      summary: "结构调整",
    };
    const atomKey = `${changeId}\u001e${[
      fact.type, fact.id, fact.semanticOwnerId, fact.geometryOwnerId,
    ].join("\u001f")}`;
    const regionId = `region-after-${name}`;
    return {
      name,
      changeId,
      ownerId,
      fact,
      atomKey,
      regionId,
      plan: {
        id: `focus-${name}`,
        kind: "structure",
        changeId,
        changeIds: [changeId],
        displayGroupId: `display-${name}`,
        displayScope: "container",
        focusOutlinePolicy: "source-change",
        atomKeys: [atomKey],
        presentation: { before: [], after: [] },
        regions: {
          before: [],
          after: [{
            id: regionId,
            side: "after",
            navigationClusterId: `reading-${name}`,
            contentCue: `${name} owner`,
            correlationKey: `locality-${name}`,
            primaryChangeId: changeId,
            changeIds: [changeId],
            geometryMode: "container-box",
            displayOwnerIds: [ownerId],
            visualEvidenceStableIds: [],
            atomKeys: [atomKey],
            presentation: [],
          }],
        },
        presence: { before: false, after: true },
      },
    };
  });
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    cases.map((entry) => entry.plan),
    cases.map((entry) => ({ atomKey: entry.atomKey, count: 1 })),
  );
  const attributes = (entry) => `data-stemmio-review-display-owner="${entry.ownerId}"
    data-stemmio-review-geometry-owner="geometry-${entry.name}"
    data-stemmio-review-marker="${entry.changeId}"
    data-stemmio-review-projection-facts="${JSON.stringify([entry.fact]).replaceAll('"', "&quot;")}"`;
  await page.setContent(`<!doctype html>${PROJECTION_LAYER_TEST_STYLE}<style>
    .multi-screen-owner { box-sizing:border-box; min-height:1300px; width:760px; }
  </style><script>${bootstrap}</script>
  <table><tbody class="multi-screen-owner" ${attributes(cases[0])}>
    <tr style="height:1300px"><td>long table body</td></tr>
  </tbody></table>
  <ul class="multi-screen-owner" ${attributes(cases[1])}><li>long list</li></ul>
  <section class="multi-screen-owner" ${attributes(cases[2])}>long section</section>`);
  for (const entry of cases) {
    await page.evaluate(({ changeId, focusGroupId, regionId }) => postMessage({
      source: "stemmio-ai-review-parent",
      sessionId: "review-session",
      type: "state",
      state: {
        focus: changeId,
        activeFocusGroupId: focusGroupId,
        activeFocusRegionId: regionId,
        paintPlan: {
          contextMask: { regionId },
          focusOutline: { regionId },
        },
        transparency: 25,
        scale: 1,
      },
    }, "*"), {
      changeId: entry.changeId,
      focusGroupId: entry.plan.id,
      regionId: entry.regionId,
    });
    const hole = page.locator(
      `[data-stemmio-review-mask-hole][data-stemmio-review-focus-group="${entry.plan.id}"]`,
    );
    await expect(hole).toHaveCount(1);
    await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
    expect(Number(await hole.getAttribute("data-height"))).toBeGreaterThan(
      await page.evaluate(() => innerHeight),
    );
  }
});

test("moving exact atom attributes to a parser-time decoy fails closed", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    [plan],
    [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script><p data-stemmio-review-display-owner="display-owner-1"><span id="source" data-stemmio-review-text="added" data-stemmio-review-marker="change-1" data-stemmio-review-projection-facts="${fact}">new</span><span id="decoy">forged</span><script>for (const name of ["data-stemmio-review-text", "data-stemmio-review-marker", "data-stemmio-review-projection-facts"]) { const value = source.getAttribute(name); source.removeAttribute(name); decoy.setAttribute(name, value); } source.remove();</script></p>`);
  await expect(page.locator('[data-stemmio-review-text-mark="added"]')).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-region-bar]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
});

test("reparenting an exact atom outside its captured display owner fails closed", async ({ page }) => {
  await page.goto("about:blank");
  const { atomKey, factValue, plan } = exactTextFocusFixture();
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    [],
    [plan],
    [{ atomKey, count: 1 }],
  );
  const fact = JSON.stringify([factValue]).replaceAll('"', "&quot;");
  await page.setContent(`<!doctype html><script>${bootstrap}</script>
    <p data-stemmio-review-display-owner="display-owner-1">
      <span id="exact-marker" data-stemmio-review-text="added"
        data-stemmio-review-marker="change-1"
        data-stemmio-review-projection-facts="${fact}">new</span>
    </p>
    <div id="authored-destination" style="margin-top:200px"></div>
    <script>document.querySelector("#authored-destination").append(document.querySelector("#exact-marker"));</script>`);
  await expect(page.locator('[data-stemmio-review-text-mark="added"]')).toHaveCount(0);
  await page.evaluate((activeFocusGroupId) => postMessage({
    source: "stemmio-ai-review-parent",
    sessionId: "review-session",
    type: "state",
    state: {
      focus: "change-1",
      activeFocusGroupId,
      transparency: 25,
      scale: 1,
    },
  }, "*"), plan.id);
  await expect(page.locator("[data-stemmio-review-overlay-box]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-mask-hole]")).toHaveCount(0);
  await expect(page.locator("[data-stemmio-review-mask-dim]")).toHaveCount(0);
});
