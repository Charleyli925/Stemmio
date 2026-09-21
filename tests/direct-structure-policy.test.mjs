import assert from "node:assert/strict";
import test from "node:test";

import {
  directCopyPolicyForElement,
  evaluateDirectStructurePolicy,
} from "../app/components/direct-structure-policy.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

const ids = {
  html: "sm1_00000000000040008000000000000001",
  head: "sm1_00000000000040008000000000000002",
  body: "sm1_00000000000040008000000000000003",
  section: "sm1_00000000000040008000000000000004",
  first: "sm1_00000000000040008000000000000005",
  second: "sm1_00000000000040008000000000000006",
  third: "sm1_00000000000040008000000000000007",
  aside: "sm1_00000000000040008000000000000008",
};

function documentHtml(bodyHtml) {
  let ordinal = 0x20;
  const completeBody = bodyHtml.replace(
    /<([a-z][\w:-]*)(\s[^<>]*?)?>/giu,
    (openingTag, tagName, rawAttributes = "") => {
      if (/\bdata-stemmio-id\s*=/iu.test(rawAttributes)) return openingTag;
      const suffix = `sm1_000000000000400080000000000000${(ordinal++).toString(16).padStart(2, "0")}`;
      return `<${tagName}${rawAttributes} data-stemmio-id="${suffix}">`;
    },
  );
  return `<!doctype html><html data-stemmio-id="${ids.html}"><head data-stemmio-id="${ids.head}"></head><body data-stemmio-id="${ids.body}">${completeBody}</body></html>`;
}

function fixture(bodyHtml = `<section data-stemmio-id="${ids.section}"><p data-stemmio-id="${ids.first}">One <strong>bold</strong><br>line</p><p data-stemmio-id="${ids.second}">Two</p><p data-stemmio-id="${ids.third}">Three</p></section>`) {
  const html = documentHtml(bodyHtml);
  return { html, sourceIndex: buildSourceIndex(html) };
}

function selection(elementId, sourceIndex, extra = {}) {
  const element = sourceIndex.byStemmioId.get(elementId);
  return {
    id: `target-${elementId}`,
    elementId,
    tagName: element?.tagName,
    level: "part",
    resolution: "exact",
    ...extra,
  };
}

test("copy admits only safe text roots and keeps ID allocation with the kernel", () => {
  const { sourceIndex } = fixture();
  const result = directCopyPolicyForElement({
    sourceIndex,
    selection: selection(ids.first, sourceIndex),
  });
  assert.equal(result.status, "supported");
  assert.equal(result.reason, "copy-supported");
  assert.equal(result.copyPolicy, "supported");
  assert.equal(sourceIndex.byStemmioId.get(ids.first).stemmioId, ids.first);
});

test("copy admits simple list items and directly inline blockquotes", () => {
  const html = documentHtml(
    `<ul data-stemmio-id="${ids.section}"><li data-stemmio-id="${ids.first}">Item <strong>bold</strong></li></ul><blockquote data-stemmio-id="${ids.second}">Quote <em>inline</em></blockquote>`,
  );
  const sourceIndex = buildSourceIndex(html);
  for (const elementId of [ids.first, ids.second]) {
    const result = evaluateDirectStructurePolicy({
      action: "copy",
      sourceIndex,
      elementId,
    });
    assert.equal(result.status, "supported", elementId);
    assert.equal(result.reason, "copy-supported", elementId);
  }
});

test("copy rejects complex roots and unsafe descendants", () => {
  const cases = [
    ["<div data-stemmio-id=\"sm1_00000000000040008000000000000010\"><span>text</span></div>", "copy-root-tag-unsupported"],
    ["<blockquote data-stemmio-id=\"sm1_00000000000040008000000000000010\"><div>nested</div></blockquote>", "copy-nested-block"],
    ["<blockquote data-stemmio-id=\"sm1_00000000000040008000000000000010\"><ul><li>nested</li></ul></blockquote>", "copy-nested-list"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><button>run</button></p>", "copy-control"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><img src=\"x.png\"></p>", "copy-media"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><svg></svg></p>", "copy-svg-math"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><template><span>x</span></template></p>", "copy-template"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><span-custom>x</span-custom></p>", "copy-custom-element"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><script>run()</script></p>", "copy-script"],
    ["<p data-stemmio-id=\"sm1_00000000000040008000000000000010\"><span style=\"background:url(x.png)\">x</span></p>", "copy-resource-attribute"],
  ];
  for (const [body, reason] of cases) {
    const html = documentHtml(body);
    const sourceIndex = buildSourceIndex(html);
    const target = sourceIndex.elements.find((element) => element.stemmioId === "sm1_00000000000040008000000000000010");
    const result = evaluateDirectStructurePolicy({
      action: "copy",
      sourceIndex,
      elementId: target?.stemmioId,
    });
    assert.equal(result.status, "unsupported", reason);
    assert.equal(result.reason, reason, reason);
  }
});

test("copy and delete reject ambiguous mixed-content parents", () => {
  const mixedHtml = documentHtml(
    `<section data-stemmio-id="${ids.section}">prefix <p data-stemmio-id="${ids.first}">One</p></section>`,
  );
  const mixedIndex = buildSourceIndex(mixedHtml);
  assert.equal(
    evaluateDirectStructurePolicy({
      action: "copy",
      sourceIndex: mixedIndex,
      elementId: ids.first,
    }).reason,
    "copy-parent-mixed-content",
  );
  assert.equal(
    evaluateDirectStructurePolicy({
      action: "delete",
      sourceIndex: mixedIndex,
      elementId: ids.first,
    }).reason,
    "delete-mixed-content",
  );
});

test("copy rejects duplicate author identity and references that would need rewriting", () => {
  const cases = [
    ["id=\"author-root\"", "copy-author-identity"],
    ["<span name=\"author-name\">x</span>", "copy-author-identity"],
    ["<a href=\"#other\">x</a>", "copy-reference-rewrite"],
    ["<span aria-labelledby=\"other\">x</span>", "copy-reference-rewrite"],
    ["<span aria-label=\"plain label\">x</span>", "copy-supported"],
    ["<span onclick=\"run()\">x</span>", "copy-event-handler"],
  ];
  for (const [fragment, expectedReason] of cases) {
    const body = fragment.startsWith("<span") || fragment.startsWith("<a")
      ? `<p data-stemmio-id=\"${ids.first}\">${fragment}</p>`
      : `<p data-stemmio-id=\"${ids.first}\" ${fragment}>x</p>`;
    const html = documentHtml(body);
    const sourceIndex = buildSourceIndex(html);
    const result = evaluateDirectStructurePolicy({
      action: "copy",
      sourceIndex,
      elementId: ids.first,
    });
    assert.equal(result.reason, expectedReason, fragment);
  }
});

test("move admits one adjacent same-parent step and rejects cross-parent/non-adjacent moves", () => {
  const { sourceIndex } = fixture();
  const up = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.second,
    destination: { parentElementId: ids.section, beforeElementId: ids.first },
  });
  assert.deepEqual(
    { status: up.status, reason: up.reason, direction: up.direction },
    { status: "supported", reason: "move-supported", direction: "up" },
  );

  const down = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.first,
    destination: { parentElementId: ids.section, beforeElementId: ids.third },
  });
  assert.equal(down.status, "supported");
  assert.equal(down.direction, "down");

  const crossParent = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.first,
    destination: { parentElementId: ids.body },
  });
  assert.equal(crossParent.status, "unsupported");
  assert.equal(crossParent.reason, "move-cross-parent");

  const staleDestination = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.first,
    destination: { parentElementId: "sm1_deadbeefdead4dead8deadbeefdeadbe" },
  });
  assert.equal(staleDestination.status, "temporarily-unavailable");
  assert.equal(staleDestination.reason, "move-destination-unavailable");

  const nonAdjacent = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.third,
    destination: { parentElementId: ids.section, beforeElementId: ids.first },
  });
  assert.equal(nonAdjacent.status, "unsupported");
  assert.equal(nonAdjacent.reason, "move-non-adjacent");

  const bodyChildren = fixture(
    `<p data-stemmio-id="${ids.first}">A</p><p data-stemmio-id="${ids.second}">B</p>`,
  );
  const bodyMove = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex: bodyChildren.sourceIndex,
    elementId: ids.first,
    destination: { parentElementId: ids.body, beforeElementId: null },
  });
  assert.equal(bodyMove.status, "supported");
  assert.equal(bodyMove.direction, "down");
});

test("move rejects special parents, roots and mixed-content sibling boundaries", () => {
  const tableHtml = documentHtml(`<table data-stemmio-id="${ids.section}"><tr data-stemmio-id="${ids.first}"><td>A</td></tr><tr data-stemmio-id="${ids.second}"><td>B</td></tr></table>`);
  const tableIndex = buildSourceIndex(tableHtml);
  const tableDecision = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex: tableIndex,
    elementId: ids.first,
    destination: { parentElementId: ids.section, beforeElementId: ids.second },
  });
  assert.equal(tableDecision.status, "unsupported");
  assert.equal(tableDecision.reason, "move-target-special");

  const { sourceIndex } = fixture(`<section data-stemmio-id="${ids.section}"><p data-stemmio-id="${ids.first}">A</p>text<p data-stemmio-id="${ids.second}">B</p></section>`);
  const mixed = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.second,
    destination: { parentElementId: ids.section, beforeElementId: ids.first },
  });
  assert.equal(mixed.status, "unsupported");
  assert.equal(mixed.reason, "move-mixed-content");

  const widgetId = "sm1_00000000000040008000000000000020";
  const innerId = "sm1_00000000000040008000000000000021";
  const nestedWidget = fixture(
    `<x-widget data-stemmio-id="${widgetId}"><div data-stemmio-id="${innerId}"><p data-stemmio-id="${ids.first}">A</p><p data-stemmio-id="${ids.second}">B</p></div></x-widget>`,
  );
  const nestedWidgetMove = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex: nestedWidget.sourceIndex,
    elementId: ids.second,
    destination: { parentElementId: innerId, beforeElementId: ids.first },
  });
  assert.equal(nestedWidgetMove.status, "unsupported");
  assert.equal(nestedWidgetMove.reason, "move-target-special");
});

test("delete uses one source landing rule and can clear selection when none exists", () => {
  const { sourceIndex } = fixture(`<section data-stemmio-id="${ids.section}"><div data-stemmio-id="${ids.first}"><p>nested block</p></div><p data-stemmio-id="${ids.second}">B</p></section>`);
  const result = evaluateDirectStructurePolicy({
    action: "delete",
    sourceIndex,
    elementId: ids.first,
  });
  assert.equal(result.status, "supported");
  assert.equal(result.reason, "delete-supported");
  assert.equal(result.landingElementId, ids.second);

  const root = evaluateDirectStructurePolicy({
    action: "delete",
    sourceIndex,
    elementId: ids.html,
  });
  assert.equal(root.status, "unsupported");
  assert.equal(root.reason, "delete-target-root");

  const noLanding = fixture(`<div data-stemmio-id="${ids.first}">only</div>`);
  const noLandingResult = evaluateDirectStructurePolicy({
    action: "delete",
    sourceIndex: noLanding.sourceIndex,
    elementId: ids.first,
  });
  assert.equal(noLandingResult.status, "supported");
  assert.equal(noLandingResult.reason, "delete-supported");
  assert.equal(noLandingResult.landingElementId, null);

  const controlNext = fixture(
    `<section data-stemmio-id="${ids.section}"><p data-stemmio-id="${ids.first}">remove</p><button data-stemmio-id="${ids.second}">action</button></section>`,
  );
  const controlNextResult = evaluateDirectStructurePolicy({
    action: "delete",
    sourceIndex: controlNext.sourceIndex,
    elementId: ids.first,
  });
  assert.equal(controlNextResult.status, "supported");
  assert.equal(controlNextResult.landingElementId, ids.section);
});

test("missing/stale source facts are temporary, while direct HTML insertion is always rejected", () => {
  assert.equal(
    evaluateDirectStructurePolicy({ action: "copy", sourceIndex: null, elementId: ids.first }).status,
    "temporarily-unavailable",
  );
  const { sourceIndex } = fixture();
  const stale = evaluateDirectStructurePolicy({
    action: "copy",
    sourceIndex,
    selection: selection(ids.first, sourceIndex, { expectedSourceSha256: "sha256:stale" }),
  });
  assert.equal(stale.status, "temporarily-unavailable");
  assert.equal(stale.reason, "source-hash-stale");

  const insertion = evaluateDirectStructurePolicy({
    action: "insert",
    sourceIndex,
    html: "<p>safe-looking but caller-provided</p>",
  });
  assert.equal(insertion.status, "unsupported");
  assert.equal(insertion.reason, "direct-html-insert-unsupported");
});

test("direct structure policy keeps its internal action and destination surface closed", () => {
  const { sourceIndex } = fixture();
  const aliasAction = evaluateDirectStructurePolicy({
    action: "duplicate",
    sourceIndex,
    elementId: ids.first,
  });
  assert.equal(aliasAction.status, "unsupported");
  assert.equal(aliasAction.reason, "action-unsupported");

  const aliasDestination = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.first,
    destination: {
      parentId: ids.section,
      beforeId: ids.second,
      index: 1,
    },
  });
  assert.equal(aliasDestination.status, "temporarily-unavailable");
  assert.equal(aliasDestination.reason, "move-destination-unavailable");

  const invalidDirection = evaluateDirectStructurePolicy({
    action: "move",
    sourceIndex,
    elementId: ids.first,
    destination: { parentElementId: ids.section, direction: "sideways" },
  });
  assert.equal(invalidDirection.status, "unsupported");
  assert.equal(invalidDirection.reason, "move-destination-invalid");
});

test("incomplete source identity fails closed before direct structure admission", () => {
  const { sourceIndex } = fixture();
  const incomplete = {
    ...sourceIndex,
    stemmioIdentity: {
      ...sourceIndex.stemmioIdentity,
      complete: false,
      valid: true,
    },
  };
  const result = evaluateDirectStructurePolicy({
    action: "copy",
    sourceIndex: incomplete,
    elementId: ids.first,
  });
  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "source-index-invalid");
});

test("copy admits only static text-only divs through the existing source policy", () => {
  const cases = [
    ['class="label"', "Text", "", "copy-supported"],
    ['id="author"', "Text", "", "copy-author-identity"],
    ['name="author"', "Text", "", "copy-author-identity"],
    ['aria-labelledby="title"', "Text", "", "copy-reference-rewrite"],
    ['onclick="run()"', "Text", "", "copy-div-author-program"],
    ['', "Text", '<script>run()</script>', "copy-div-author-program"],
    ['', "Text", '<p onmouseover="run()">Other</p>', "copy-div-author-program"],
    ['', "Text", '<a href="javascript:run()">Other</a>', "copy-div-author-program"],
    ['style="background:url(image.png)"', "Text", "", "copy-resource-attribute"],
    ['', "<img src='image.png'>", "", "copy-root-tag-unsupported"],
    ['', "<span>Text</span>", "", "copy-root-tag-unsupported"],
    ['', "<!--marker-->Text", "", "copy-root-tag-unsupported"],
    ['', " ", "", "copy-root-tag-unsupported"],
  ];
  for (const [attributes, content, extra, reason] of cases) {
    const { sourceIndex } = fixture(`<div data-stemmio-id="${ids.first}" ${attributes}>${content}</div>${extra}`);
    const result = evaluateDirectStructurePolicy({ action: "copy", sourceIndex, elementId: ids.first });
    assert.equal(result.reason, reason);
    assert.equal(result.status, reason === "copy-supported" ? "supported" : "unsupported");
    assert.equal(directCopyPolicyForElement({ sourceIndex, elementId: ids.first }).reason, reason);
  }
});

test("static text-only divs retain mixed-content and special-ancestor guards", () => {
  const tableHtml = documentHtml(
    `<table data-stemmio-id="${ids.section}"><tbody><tr><td><div data-stemmio-id="${ids.first}">Text</div></td></tr></tbody></table>`,
  );
  const tableIndex = buildSourceIndex(tableHtml);
  assert.equal(
    evaluateDirectStructurePolicy({ action: "copy", sourceIndex: tableIndex, elementId: ids.first }).reason,
    "copy-parent-special-structure",
  );

  const mixed = fixture(`<section data-stemmio-id="${ids.section}">prefix <div data-stemmio-id="${ids.first}">Text</div></section>`);
  assert.equal(
    evaluateDirectStructurePolicy({ action: "copy", sourceIndex: mixed.sourceIndex, elementId: ids.first }).reason,
    "copy-parent-mixed-content",
  );
});
