import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_VIEW_CONTEXT_PROTOCOL,
  PAGE_VIEW_CONTEXT_VERSION,
  createPagePresentationAction,
  createPageViewContext,
  resolvePageViewContext,
} from "../app/lib/page-view-context.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { createTargetRef } from "../app/lib/target-resolver.js";
import { materializeSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";

const RAW_TAB_HTML = `<!doctype html>
<html>
<head>
  <style>
    .panel { display: none; }
    .panel.active { display: block; }
  </style>
</head>
<body>
  <nav>
    <button id="tab-one" class="tab active" aria-selected="true">第一页</button>
    <button id="tab-two" class="tab" aria-selected="false">第二页</button>
  </nav>
  <section id="panel-one" class="panel active"><p>第一页正文</p></section>
  <section id="panel-two" class="panel"><p>第二页正文</p></section>
  <details id="notes"><summary>说明</summary><p>静态详情</p></details>
</body>
</html>`;

const TAB_HTML = materializeSourceElementIdentity(RAW_TAB_HTML).html;

const RAW_PRESENTATION_HTML = `<!doctype html>
<html>
<body>
  <nav role="tablist" aria-label="报告页签">
    <button id="tab-one" role="tab" aria-controls="panel-one" aria-selected="true"><span>第一页</span></button>
    <button id="tab-two" role="tab" aria-controls="panel-two" aria-selected="false"><span id="tab-two-label">第二页</span></button>
  </nav>
  <section id="panel-one" role="tabpanel"><p>第一页正文</p></section>
  <section id="panel-two" role="tabpanel" hidden><p>第二页正文</p></section>
  <details id="notes"><summary id="notes-summary">查看说明</summary><p>静态详情</p></details>
  <section>
    <h2><button id="more-toggle" aria-expanded="false" aria-controls="more-content">更多内容</button></h2>
    <div id="more-content" role="region" aria-labelledby="more-toggle" hidden><p>补充正文</p></div>
  </section>
  <a id="outside-link" href="https://example.com/">外部链接</a>
</body>
</html>`;

const PRESENTATION_HTML = materializeSourceElementIdentity(RAW_PRESENTATION_HTML).html;

const RAW_DATA_LINKED_TAB_HTML = `<!doctype html>
<html>
<head>
  <style>
    .report-panel { display: none; }
    .report-panel.active { display: block; }
  </style>
</head>
<body>
  <nav class="report-tabs">
    <div id="legacy-tab-one" class="report-tab active" data-p="legacy-panel-one">第一页</div>
    <div id="legacy-tab-two" class="report-tab" data-p="legacy-panel-two"><span id="legacy-tab-two-label">第二页</span></div>
  </nav>
  <main>
    <section id="legacy-panel-one" class="report-panel active"><p>第一页正文</p></section>
    <section id="legacy-panel-two" class="report-panel"><p>第二页正文</p></section>
  </main>
  <script>
    document.querySelectorAll("[data-p]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.documentElement.dataset.authorAction = tab.dataset.p;
      });
    });
  </script>
</body>
</html>`;

const RAW_INDEXED_HANDLER_TAB_HTML = `<!doctype html>
<html>
<head>
  <style>
    .chart-panel { display: none; }
    .chart-panel.active { display: block; }
  </style>
</head>
<body>
  <section class="report-card">
    <div class="chart-tabs">
      <div id="indexed-tab-one" class="chart-tab active" onclick="switchChart(0)">第一页</div>
      <div id="indexed-tab-two" class="chart-tab" onclick="switchChart(1)"><span id="indexed-tab-two-label">第二页</span></div>
      <div id="indexed-tab-three" class="chart-tab" onclick="switchChart(2)">第三页</div>
    </div>
    <div id="indexed-panel-one" class="chart-panel active"><p>第一页正文</p></div>
    <div id="indexed-panel-two" class="chart-panel"><p>第二页正文</p></div>
    <div id="indexed-panel-three" class="chart-panel"><p>第三页正文</p></div>
  </section>
  <script>
    function switchChart(index) {
      document.querySelectorAll(".chart-tab").forEach((tab, tabIndex) => {
        tab.classList.toggle("active", tabIndex === index);
      });
      document.querySelectorAll(".chart-panel").forEach((panel, panelIndex) => {
        panel.classList.toggle("active", panelIndex === index);
      });
    }
  </script>
</body>
</html>`;

const DATA_LINKED_TAB_HTML = materializeSourceElementIdentity(RAW_DATA_LINKED_TAB_HTML).html;
const INDEXED_HANDLER_TAB_HTML = materializeSourceElementIdentity(RAW_INDEXED_HANDLER_TAB_HTML).html;

function sourceNodeId(index, id) {
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === id,
  );
  assert.ok(element, `missing synthetic source element #${id}`);
  return element.stemmioId || element.nodeId;
}

function targetRef(index, id) {
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === id,
  );
  assert.ok(element, `missing synthetic source element #${id}`);
  return createTargetRef(index, element, { level: "subregion" });
}

function switchedSnapshot(html = TAB_HTML) {
  const index = buildSourceIndex(html);
  return {
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    sourceSha256: index.sourceSha256,
    truncated: false,
    entries: [
      {
        sourceNodeId: sourceNodeId(index, "tab-one"),
        className: "tab",
        hidden: false,
        open: false,
        ariaSelected: "false",
        ariaExpanded: null,
        display: "inline-block",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "tab-two"),
        className: "tab active",
        hidden: false,
        open: false,
        ariaSelected: "true",
        ariaExpanded: null,
        display: "inline-block",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "panel-one"),
        className: "panel",
        hidden: false,
        open: false,
        ariaSelected: null,
        ariaExpanded: null,
        display: "none",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "panel-two"),
        className: "panel active",
        hidden: false,
        open: false,
        ariaSelected: null,
        ariaExpanded: null,
        display: "block",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "notes"),
        className: "",
        hidden: false,
        open: true,
        ariaSelected: null,
        ariaExpanded: null,
        display: "block",
        visibility: "visible",
      },
      {
        sourceNodeId: "runtime-only-table-row",
        className: "active",
        hidden: false,
        open: false,
        ariaSelected: null,
        ariaExpanded: null,
        display: "table-row",
        visibility: "visible",
      },
    ],
  };
}

test("page view context carries only source-backed Tab and semantic display state", () => {
  const context = createPageViewContext({
    html: TAB_HTML,
    documentKey: "/tmp/report.html",
    generation: 7,
    snapshot: switchedSnapshot(),
  });

  assert.ok(context);
  assert.equal(context.documentKey, "/tmp/report.html");
  assert.equal(context.generation, 7);
  assert.equal(context.entries.length, 5);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.entries), true);

  const classAdds = context.entries.flatMap((entry) => entry.classAdd);
  const classRemoves = context.entries.flatMap((entry) => entry.classRemove);
  assert.deepEqual([...new Set(classAdds)], ["active"]);
  assert.deepEqual([...new Set(classRemoves)], ["active"]);
  assert.equal(
    context.entries.some((entry) => entry.open === true),
    true,
  );
  assert.equal(
    context.entries.some(
      (entry) => entry.targetRef.targetId === "runtime-only-table-row",
    ),
    false,
  );
  for (const entry of context.entries) {
    assert.equal(Object.hasOwn(entry, "textContent"), false);
    assert.equal(Object.hasOwn(entry, "innerHTML"), false);
    assert.equal(Object.hasOwn(entry, "style"), false);
  }
});

test("page view context rebinds to edited source without copying runtime DOM", () => {
  const context = createPageViewContext({
    html: TAB_HTML,
    documentKey: "/tmp/report.html",
    generation: 2,
    snapshot: switchedSnapshot(),
  });
  assert.ok(context);

  const editedHtml = TAB_HTML.replace(
    "第二页正文",
    "第二页正文，已经在源页中编辑",
  );
  const resolved = resolvePageViewContext(editedHtml, context);
  const resolvedIds = new Set(
    resolved.entries.map(({ sourceNodeId }) => (
      resolved.sourceIndex.byStemmioId.get(sourceNodeId)
        ?? resolved.sourceIndex.byNodeId.get(sourceNodeId)
    )?.stableAttributes.id),
  );
  assert.deepEqual(
    [...resolvedIds].sort(),
    ["notes", "panel-one", "panel-two", "tab-one", "tab-two"],
  );
  assert.equal(
    resolved.entries.every(({ resolution }) => (
      resolution === "exact" || resolution === "rebound"
    )),
    true,
  );
});

test("arbitrary runtime classes, stale source, and truncated snapshots fail closed", () => {
  const html = `<!doctype html><main><section id="card" class="card">正文</section></main>`;
  const index = buildSourceIndex(html);
  const snapshot = {
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    sourceSha256: index.sourceSha256,
    truncated: false,
    entries: [{
      sourceNodeId: sourceNodeId(index, "card"),
      className: "card loading",
      hidden: false,
      open: false,
      ariaSelected: null,
      ariaExpanded: null,
      display: "block",
      visibility: "visible",
    }],
  };

  assert.equal(createPageViewContext({
    html,
    documentKey: "memory:1",
    generation: 1,
    snapshot,
  }), null);
  assert.equal(createPageViewContext({
    html,
    documentKey: "memory:1",
    generation: 1,
    snapshot: {
      ...snapshot,
      sourceSha256: "sha256:stale",
    },
  }), null);
  assert.equal(createPageViewContext({
    html,
    documentKey: "memory:1",
    generation: 1,
    snapshot: {
      ...snapshot,
      truncated: true,
    },
  }), null);
});

test("semantic Tab actions switch only disposable presentation context", () => {
  const html = PRESENTATION_HTML;
  const index = buildSourceIndex(html);
  const action = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/report.html",
    generation: 5,
    targetRef: targetRef(index, "tab-two-label"),
  });

  assert.ok(action);
  assert.equal(action.kind, "activate-tab");
  assert.equal(action.label, "切换到此页签");
  assert.equal(action.isCurrent, false);
  assert.ok(action.nextContext);
  assert.equal(action.nextContext.documentKey, "editing:/tmp/report.html");
  assert.equal(action.nextContext.generation, 5);
  assert.equal(index.source, html);

  const resolved = resolvePageViewContext(html, action.nextContext);
  const stateById = new Map(resolved.entries.map((item) => [
    (
      resolved.sourceIndex.byStemmioId.get(item.sourceNodeId)
        ?? resolved.sourceIndex.byNodeId.get(item.sourceNodeId)
    )?.stableAttributes.id,
    item.entry,
  ]));
  assert.equal(stateById.get("tab-one")?.ariaSelected, "false");
  assert.equal(stateById.get("tab-two")?.ariaSelected, "true");
  assert.equal(stateById.get("panel-one")?.hidden, true);
  assert.equal(stateById.get("panel-two")?.hidden, false);
  assert.equal(stateById.size, 4);

  const currentAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/report.html",
    generation: 99,
    currentContext: action.nextContext,
    targetRef: targetRef(index, "tab-two"),
  });
  assert.ok(currentAction);
  assert.equal(currentAction.label, "当前页签");
  assert.equal(currentAction.isCurrent, true);
  assert.deepEqual(currentAction.nextContext, action.nextContext);
});

test("explicit data-linked tabs switch only the bounded active-class context", () => {
  const html = DATA_LINKED_TAB_HTML;
  const index = buildSourceIndex(html);
  const action = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/legacy-report.html",
    generation: 4,
    targetRef: targetRef(index, "legacy-tab-two-label"),
  });

  assert.ok(action);
  assert.equal(action.kind, "activate-tab");
  assert.equal(action.label, "切换到此页签");
  assert.equal(action.isCurrent, false);
  assert.equal(index.source, html);

  const resolved = resolvePageViewContext(html, action.nextContext);
  const stateById = new Map(resolved.entries.map((item) => [
    (resolved.sourceIndex.byStemmioId.get(item.sourceNodeId) ?? resolved.sourceIndex.byNodeId.get(item.sourceNodeId))?.stableAttributes.id,
    item.entry,
  ]));
  assert.deepEqual(stateById.get("legacy-tab-one")?.classRemove, ["active"]);
  assert.deepEqual(stateById.get("legacy-tab-two")?.classAdd, ["active"]);
  assert.deepEqual(stateById.get("legacy-panel-one")?.classRemove, ["active"]);
  assert.deepEqual(stateById.get("legacy-panel-two")?.classAdd, ["active"]);
  assert.equal(stateById.size, 4);

  const currentAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/legacy-report.html",
    generation: 99,
    currentContext: action.nextContext,
    targetRef: targetRef(index, "legacy-tab-two"),
  });
  assert.ok(currentAction);
  assert.equal(currentAction.label, "当前页签");
  assert.equal(currentAction.isCurrent, true);
  assert.deepEqual(currentAction.nextContext, action.nextContext);
});

test("constant-index handler tabs switch without evaluating authored code", () => {
  const html = INDEXED_HANDLER_TAB_HTML;
  const index = buildSourceIndex(html);
  const action = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/indexed-report.html",
    generation: 6,
    targetRef: targetRef(index, "indexed-tab-two-label"),
  });

  assert.ok(action);
  assert.equal(action.kind, "activate-tab");
  assert.equal(action.label, "切换到此页签");
  assert.equal(action.isCurrent, false);
  assert.equal(index.source, html);

  const resolved = resolvePageViewContext(html, action.nextContext);
  const stateById = new Map(resolved.entries.map((item) => [
    (resolved.sourceIndex.byStemmioId.get(item.sourceNodeId) ?? resolved.sourceIndex.byNodeId.get(item.sourceNodeId))?.stableAttributes.id,
    item.entry,
  ]));
  assert.deepEqual(stateById.get("indexed-tab-one")?.classRemove, ["active"]);
  assert.deepEqual(stateById.get("indexed-tab-two")?.classAdd, ["active"]);
  assert.deepEqual(stateById.get("indexed-panel-one")?.classRemove, ["active"]);
  assert.deepEqual(stateById.get("indexed-panel-two")?.classAdd, ["active"]);
  assert.equal(stateById.size, 4);

  const currentAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/indexed-report.html",
    currentContext: action.nextContext,
    targetRef: targetRef(index, "indexed-tab-two"),
  });
  assert.ok(currentAction);
  assert.equal(currentAction.label, "当前页签");
  assert.equal(currentAction.isCurrent, true);
  assert.deepEqual(currentAction.nextContext, action.nextContext);
});

test("ambiguous data-linked tabs fail closed", () => {
  const cases = [
    RAW_DATA_LINKED_TAB_HTML.replace(
      'data-p="legacy-panel-two"',
      'data-p="legacy-panel-one"',
    ),
    RAW_DATA_LINKED_TAB_HTML.replace(
      'class="report-tab" data-p="legacy-panel-two"',
      'class="report-tab" data-tab="legacy-panel-two"',
    ),
    RAW_DATA_LINKED_TAB_HTML.replace(
      'class="report-panel"><p>第二页正文',
      'class="report-panel active"><p>第二页正文',
    ),
    RAW_DATA_LINKED_TAB_HTML.replace(
      'class="report-tab" data-p="legacy-panel-two"',
      'class="other-tab" data-p="legacy-panel-two"',
    ),
  ];

  for (const rawHtml of cases) {
    const html = materializeSourceElementIdentity(rawHtml).html;
    const index = buildSourceIndex(html);
    assert.equal(createPagePresentationAction({
      html,
      sourceIndex: index,
      documentKey: "editing:ambiguous",
      targetRef: targetRef(index, "legacy-tab-two"),
    }), null);
  }

  const onclickOnly = materializeSourceElementIdentity(RAW_DATA_LINKED_TAB_HTML
    .replace(/ data-p="legacy-panel-one"/u, ' onclick="showOne()"')
    .replace(/ data-p="legacy-panel-two"/u, ' onclick="showTwo()"')).html;
  const onclickIndex = buildSourceIndex(onclickOnly);
  assert.equal(createPagePresentationAction({
    html: onclickOnly,
    sourceIndex: onclickIndex,
    documentKey: "editing:onclick-only",
    targetRef: targetRef(onclickIndex, "legacy-tab-two"),
  }), null);
});

test("ambiguous constant-index handler tabs fail closed", () => {
  const cases = [
    RAW_INDEXED_HANDLER_TAB_HTML.replace(
      'onclick="switchChart(1)"',
      'onclick="switchChart(0)"',
    ),
    RAW_INDEXED_HANDLER_TAB_HTML.replace(
      'onclick="switchChart(1)"',
      'onclick="showChart(1)"',
    ),
    RAW_INDEXED_HANDLER_TAB_HTML.replace(
      'onclick="switchChart(1)"',
      'onclick="switchChart(1); reportClick()"',
    ),
    RAW_INDEXED_HANDLER_TAB_HTML.replace(
      'class="chart-tab" onclick="switchChart(1)"',
      'class="chart-tab active" onclick="switchChart(1)"',
    ),
    RAW_INDEXED_HANDLER_TAB_HTML.replace(
      'class="chart-panel"><p>第二页正文',
      'class="chart-panel active"><p>第二页正文',
    ),
    RAW_INDEXED_HANDLER_TAB_HTML.replace(
      "</section>",
      `<div class="alternate-panel active"><p>另一组第一页</p></div>
       <div class="alternate-panel"><p>另一组第二页</p></div>
       <div class="alternate-panel"><p>另一组第三页</p></div>
       </section>`,
    ),
  ];

  for (const rawHtml of cases) {
    const html = materializeSourceElementIdentity(rawHtml).html;
    const index = buildSourceIndex(html);
    assert.equal(createPagePresentationAction({
      html,
      sourceIndex: index,
      documentKey: "editing:indexed-ambiguous",
      targetRef: targetRef(index, "indexed-tab-two"),
    }), null);
  }
});

test("details and strict local disclosure actions preserve existing context", () => {
  const html = PRESENTATION_HTML;
  const index = buildSourceIndex(html);
  const tabAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    generation: 3,
    targetRef: targetRef(index, "tab-two"),
  });
  assert.ok(tabAction?.nextContext);

  const detailsAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    currentContext: tabAction.nextContext,
    targetRef: targetRef(index, "notes-summary"),
  });
  assert.ok(detailsAction);
  assert.equal(detailsAction.kind, "toggle-details");
  assert.equal(detailsAction.label, "展开内容");
  assert.equal(detailsAction.nextContext?.entries.length, 5);

  const disclosureAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    currentContext: detailsAction.nextContext,
    targetRef: targetRef(index, "more-toggle"),
  });
  assert.ok(disclosureAction);
  assert.equal(disclosureAction.kind, "toggle-disclosure");
  assert.equal(disclosureAction.label, "展开内容");
  assert.equal(disclosureAction.nextContext?.entries.length, 7);

  const resolved = resolvePageViewContext(html, disclosureAction.nextContext);
  const stateById = new Map(resolved.entries.map((item) => [
    (
      resolved.sourceIndex.byStemmioId.get(item.sourceNodeId)
        ?? resolved.sourceIndex.byNodeId.get(item.sourceNodeId)
    )?.stableAttributes.id,
    item.entry,
  ]));
  assert.equal(stateById.get("notes")?.open, true);
  assert.equal(stateById.get("more-toggle")?.ariaExpanded, "true");
  assert.equal(stateById.get("more-content")?.hidden, false);
  assert.equal(stateById.get("panel-two")?.hidden, false);
});

test("links, popups, grouped details, and ambiguous Tab markup remain inert", () => {
  const html = `${PRESENTATION_HTML}
<details id="grouped-details" name="exclusive"><summary id="grouped-summary">分组详情</summary><p>内容</p></details>
<section><button id="popup-toggle" aria-expanded="false" aria-controls="popup-content" aria-haspopup="dialog">弹窗</button><div id="popup-content" role="region" aria-labelledby="popup-toggle" hidden>内容</div></section>
<div role="tablist"><button id="bad-tab-one" role="tab" aria-selected="true">一</button><button role="tab" aria-selected="false">二</button></div>`;
  const index = buildSourceIndex(html);
  const resolve = (id) => createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    targetRef: targetRef(index, id),
  });

  assert.equal(resolve("outside-link"), null);
  assert.equal(resolve("grouped-summary"), null);
  assert.equal(resolve("popup-toggle"), null);
  assert.equal(resolve("bad-tab-one"), null);
  assert.equal(createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    currentContext: {
      protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
      version: PAGE_VIEW_CONTEXT_VERSION,
      documentKey: "editing:memory",
      generation: 0,
      sourceSha256: index.sourceSha256,
      entries: [{
        targetRef: targetRef(index, "tab-one"),
        classAdd: "not-an-array",
        classRemove: [],
      }],
    },
    targetRef: targetRef(index, "tab-two"),
  }), null);
});
