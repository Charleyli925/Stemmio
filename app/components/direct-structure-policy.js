import { normalizeSourceText } from "../lib/source-index.js";

/**
 * Source-only admission policy for the small set of structure operations that
 * can be projected without replacing the current Edit frame.
 *
 * This module deliberately has no DOM dependency.  It does not materialize a
 * fragment, remove Stable IDs, or produce an HTML patch.  The semantic kernel
 * remains the only owner of those operations and of fresh Stemmio ID
 * allocation.  The policy only answers whether a caller may attempt the
 * direct path.
 */

export const DIRECT_STRUCTURE_POLICY_STATUSES = Object.freeze([
  "supported",
  "unsupported",
  "temporarily-unavailable",
]);

export const DIRECT_STRUCTURE_ACTIONS = Object.freeze([
  "copy",
  "move",
  "delete",
  "insert",
]);

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const STEMMIO_ID_ATTRIBUTE = "data-stemmio-id";

const COPY_ROOT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
]);

// Keep this list intentionally narrower than INLINE_CONTENT_TAGS.  Inline
// controls and immutable atoms are not text-formatting children, even though
// they are technically inline HTML.
const SAFE_COPY_INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "ruby",
  "rp",
  "rt",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

const NESTED_LIST_TAGS = new Set(["ul", "ol", "menu", "dl", "dt", "dd"]);
const CONTROL_TAGS = new Set([
  "button",
  "datalist",
  "fieldset",
  "form",
  "input",
  "label",
  "legend",
  "meter",
  "optgroup",
  "option",
  "output",
  "progress",
  "select",
  "textarea",
]);
const MEDIA_TAGS = new Set([
  "area",
  "audio",
  "canvas",
  "embed",
  "img",
  "map",
  "object",
  "picture",
  "source",
  "track",
  "video",
]);
const SVG_MATH_TAGS = new Set(["svg", "math"]);
const TEMPLATE_TAGS = new Set(["template", "slot"]);
const SCRIPT_TAGS = new Set(["script", "noscript"]);
const RESOURCE_TAGS = new Set([
  "applet",
  "base",
  "frame",
  "frameset",
  "iframe",
  "link",
  "meta",
  "portal",
  "style",
]);

const ROOT_TAGS = new Set(["html", "head", "body"]);

// These are structures whose local meaning depends on more than the order of
// ordinary source children.  A delete of a normal block/list/inline node is
// allowed, but a delete inside or of one of these structures is conservative.
const SPECIAL_STRUCTURE_TAGS = new Set([
  ...ROOT_TAGS,
  ...NESTED_LIST_TAGS,
  ...CONTROL_TAGS,
  ...MEDIA_TAGS,
  ...SVG_MATH_TAGS,
  ...TEMPLATE_TAGS,
  ...SCRIPT_TAGS,
  ...RESOURCE_TAGS,
  "caption",
  "col",
  "colgroup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
]);

const MOVE_BLOCKED_PARENT_TAGS = new Set([
  // `body` is a valid ordinary container for adjacent source children.  The
  // target itself may not be a document root, but body-owned paragraphs and
  // headings remain eligible for same-parent reorder.
  "html",
  "head",
  "caption",
  "col",
  "colgroup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  ...CONTROL_TAGS,
  ...MEDIA_TAGS,
  ...SVG_MATH_TAGS,
  ...TEMPLATE_TAGS,
  ...SCRIPT_TAGS,
  ...RESOURCE_TAGS,
]);

const REFERENCE_ATTRIBUTE_NAMES = new Set([
  "anchor",
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "contextmenu",
  "for",
  "form",
  "headers",
  "itemref",
  "list",
  "popovertarget",
  "usemap",
]);

const RESOURCE_ATTRIBUTE_NAMES = new Set([
  "action",
  "background",
  "cite",
  "codebase",
  "data",
  "formaction",
  "poster",
  "ping",
  "src",
  "srcdoc",
  "srcset",
]);

const AUTHOR_PROGRAM_URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "formaction",
  "href",
  "src",
]);
const URL_PARSER_BASE = "https://stemmio.invalid/";

const REASON_MESSAGES = Object.freeze({
  "source-index-unavailable": "The source index is not ready.",
  "source-index-invalid": "The source index is not a safe source proof.",
  "source-hash-stale": "The selection belongs to an older source revision.",
  "selection-unavailable": "The source selection is not ready.",
  "selection-unresolved": "The source selection cannot be resolved yet.",
  "selection-level-unsupported": "An insertion-point selection is not an element target.",
  "selection-identity-missing": "A Stable ID is required for a direct structure operation.",
  "selection-identity-mismatch": "The selection and requested Stable ID disagree.",
  "selection-runtime-generated": "Runtime-generated targets are not source structure targets.",
  "target-not-found": "The selected source element is no longer available.",
  "target-identity-invalid": "The selected source element has invalid identity evidence.",
  "target-kind-unsupported": "The selected source node is not an HTML source element.",
  "copy-root-tag-unsupported": "Only safe text blocks can be copied directly.",
  "copy-customized-built-in": "Customized built-in elements cannot be copied directly.",
  "copy-custom-element": "Custom elements cannot be copied directly.",
  "copy-namespace-unsupported": "Only ordinary HTML source elements can be copied directly.",
  "copy-nested-list": "Nested lists are not copied through the direct path.",
  "copy-control": "Controls and form content are not copied through the direct path.",
  "copy-media": "Media content is not copied through the direct path.",
  "copy-svg-math": "SVG and MathML content is not copied through the direct path.",
  "copy-template": "Template content is not copied through the direct path.",
  "copy-script": "Script content is not copied through the direct path.",
  "copy-resource": "Resource-bearing content is not copied through the direct path.",
  "copy-nested-block": "Copied descendants must be safe inline text formatting or line breaks.",
  "copy-comment": "Source comments make the copied boundary ambiguous.",
  "copy-author-identity": "Author id/name identity cannot be duplicated by a direct copy.",
  "copy-reference-rewrite": "Referenced ids would need rewriting before a direct copy.",
  "copy-event-handler": "Authored event handlers cannot be duplicated through the direct path.",
  "copy-div-author-program": "Static text containers cannot be copied when the document contains authored program behavior.",
  "copy-resource-attribute": "Resource attributes cannot be duplicated through the direct path.",
  "copy-parent-mixed-content": "Text or comments make the copy insertion boundary ambiguous.",
  "copy-invalid-source": "The copied source subtree has invalid source evidence.",
  "copy-parent-special-structure": "Special structure ancestors are not copied through the direct path.",
  "copy-supported": "The source subtree is eligible for direct copy.",
  "move-destination-unavailable": "A same-parent adjacent destination is not ready.",
  "move-destination-invalid": "The move destination is not a source child boundary.",
  "move-target-root": "Document roots and source containers cannot be moved directly.",
  "move-target-special": "Special structure cannot be reordered through the direct path.",
  "move-parent-unavailable": "The move parent is not a source element.",
  "move-parent-identity-missing": "The move parent must have a Stable ID.",
  "move-parent-special": "Special structure parents cannot be reordered directly.",
  "move-mixed-content": "Text or comments make the sibling boundary ambiguous.",
  "move-cross-parent": "Direct move only supports same-parent reorder.",
  "move-cycle": "A move destination cannot be inside the moving element.",
  "move-noop": "The move destination does not change sibling order.",
  "move-non-adjacent": "Direct move only supports one adjacent sibling step.",
  "move-anchor-unavailable": "The adjacent sibling boundary is not source-backed.",
  "move-anchor-invalid": "The move anchor is not a direct child of the source parent.",
  "move-supported": "The source element is eligible for adjacent same-parent reorder.",
  "delete-target-root": "Document roots and source containers cannot be deleted directly.",
  "delete-special-structure": "Special structure cannot be deleted through the direct path.",
  "delete-mixed-content": "Text or comments make the delete/undo boundary ambiguous.",
  "delete-supported": "The source element is eligible for direct deletion.",
  "direct-html-insert-unsupported": "Direct HTML insertion is not admitted by this policy.",
  "action-unsupported": "This structure action is not admitted by the direct policy.",
});

function normalizeAction(action) {
  const value = String(action ?? "").trim().toLowerCase();
  return DIRECT_STRUCTURE_ACTIONS.includes(value) ? value : null;
}

function decision(status, reason, details = {}) {
  const message = REASON_MESSAGES[reason] || "The direct structure policy rejected this action.";
  return Object.freeze({
    status,
    reason,
    message,
    ...details,
  });
}

function supported(reason, details) {
  return decision("supported", reason, details);
}

function unsupported(reason, details) {
  return decision("unsupported", reason, details);
}

function temporarilyUnavailable(reason, details) {
  return decision("temporarily-unavailable", reason, details);
}

function mapLike(value) {
  return value && typeof value.get === "function" ? value : null;
}

function sourceIndexReady(sourceIndex) {
  return Boolean(
    sourceIndex
    && mapLike(sourceIndex.byStemmioId)
    && mapLike(sourceIndex.byNodeId)
    && Array.isArray(sourceIndex.elements)
    && typeof sourceIndex.sourceSha256 === "string"
  );
}

function sourceIndexIntegritySafe(sourceIndex) {
  if (!sourceIndexReady(sourceIndex)) return false;
  if (sourceIndex.integrity && sourceIndex.integrity.ok === false) return false;
  if (Array.isArray(sourceIndex.rangeErrors) && sourceIndex.rangeErrors.length > 0) return false;
  if (Array.isArray(sourceIndex.parseErrors) && sourceIndex.parseErrors.length > 0) return false;
  return sourceIndex.stemmioIdentity?.complete === true
    && sourceIndex.stemmioIdentity?.valid === true;
}

function normalizedTag(element) {
  return String(element?.tagName ?? "").trim().toLowerCase();
}

function isHtmlElement(element) {
  return !element?.namespaceURI
    || element.namespaceURI === HTML_NAMESPACE;
}

function attributesFor(element) {
  if (Array.isArray(element?.attributes)) return element.attributes;
  const map = element?.attributesByName;
  if (!map || typeof map.entries !== "function") return [];
  const attributes = [];
  for (const [name, values] of map.entries()) {
    for (const value of Array.isArray(values) ? values : [values]) {
      attributes.push({
        name,
        value: value?.value ?? value?.rawValue ?? value,
        rawValue: value?.rawValue ?? value?.value ?? value,
      });
    }
  }
  return attributes;
}

function attributeEntries(element) {
  return attributesFor(element).map((attribute) => ({
    name: String(attribute?.name ?? "").trim().toLowerCase(),
    value: String(attribute?.value ?? attribute?.rawValue ?? ""),
    rawValue: String(attribute?.rawValue ?? attribute?.value ?? ""),
  }));
}

function isAuthorProgramUrl(value) {
  try {
    const protocol = new URL(String(value ?? ""), URL_PARSER_BASE).protocol;
    return protocol === "javascript:" || protocol === "vbscript:";
  } catch {
    return false;
  }
}

function hasAuthorProgram(sourceIndex) {
  return sourceIndex.elements.some((element) => (
    normalizedTag(element) === "script"
    || attributeEntries(element).some(({ name, value }) => (
      name.startsWith("on")
      || (AUTHOR_PROGRAM_URL_ATTRIBUTE_NAMES.has(name) && isAuthorProgramUrl(value))
    ))
  ));
}

function hasAttribute(element, name) {
  const normalized = String(name ?? "").toLowerCase();
  return attributeEntries(element).some((attribute) => attribute.name === normalized);
}

function hasCustomizedBuiltIn(element) {
  return hasAttribute(element, "is");
}

function isCustomElement(element) {
  return normalizedTag(element).includes("-");
}

function childNodes(sourceIndex, element) {
  if (!Array.isArray(element?.childIds)) return null;
  const nodes = [];
  for (const childId of element.childIds) {
    const child = sourceIndex.byNodeId.get(childId);
    if (!child || typeof child !== "object") return null;
    nodes.push(child);
  }
  return nodes;
}

function childElements(sourceIndex, parent) {
  const nodes = childNodes(sourceIndex, parent);
  if (!nodes) return null;
  return nodes.filter((node) => node.type === "element");
}

function descendants(sourceIndex, root) {
  const result = [];
  const visit = (element) => {
    const children = childNodes(sourceIndex, element);
    if (!children) return false;
    for (const child of children) {
      if (child.type !== "element") continue;
      result.push(child);
      if (!visit(child)) return false;
    }
    return true;
  };
  return visit(root) ? result : null;
}

function hasSignificantMixedContent(sourceIndex, parent) {
  const nodes = childNodes(sourceIndex, parent);
  if (!nodes) return true;
  return nodes.some((node) => (
    node.type === "comment"
    || node.type === "text" && normalizeSourceText(node.value || "") !== ""
  ));
}

function sourceIdentityStatusInvalid(element) {
  return ["invalid", "duplicate"].includes(element?.stemmioIdentityStatus);
}

function selectionRuntimeGenerated(selection) {
  return Boolean(
    selection?.runtimeGenerated === true
    || selection?.visualHint?.runtimeGenerated === true
    || selection?.commentAnchor?.visualHint?.runtimeGenerated === true,
  );
}

function selectionHashIsStale(sourceIndex, selection) {
  const hashes = [
    selection?.expectedSourceSha256,
    selection?.sourceAnchor?.sourceSha256,
  ].filter((value) => value !== undefined && value !== null);
  return hashes.some((value) => String(value) !== sourceIndex.sourceSha256);
}

function resolveTarget(sourceIndex, input) {
  const selection = input.selection ?? null;
  if (!selection && input.elementId == null) {
    return temporarilyUnavailable("selection-unavailable");
  }
  if (selection?.level === "insertion") {
    return unsupported("selection-level-unsupported");
  }
  if (["ambiguous", "orphaned"].includes(selection?.resolution)) {
    return temporarilyUnavailable("selection-unresolved");
  }
  if (selectionRuntimeGenerated(selection)) {
    return unsupported("selection-runtime-generated");
  }
  if (selectionHashIsStale(sourceIndex, selection)) {
    return temporarilyUnavailable("source-hash-stale");
  }

  const suppliedId = input.elementId == null ? null : String(input.elementId);
  const selectionId = selection?.elementId == null ? null : String(selection.elementId);
  if (suppliedId && selectionId && suppliedId !== selectionId) {
    return unsupported("selection-identity-mismatch");
  }
  const elementId = suppliedId || selectionId;
  if (!elementId) return unsupported("selection-identity-missing");

  const target = sourceIndex.byStemmioId.get(elementId);
  if (!target) return temporarilyUnavailable("target-not-found");
  if (target.type !== "element") return unsupported("target-kind-unsupported");
  if (target.stemmioId !== elementId || sourceIdentityStatusInvalid(target)) {
    return unsupported("target-identity-invalid");
  }
  if (selection?.tagName && normalizedTag(selection) !== normalizedTag(target)) {
    return temporarilyUnavailable("selection-unresolved");
  }
  return { target, elementId };
}

function sourceElementById(sourceIndex, elementId) {
  if (!elementId) return null;
  const element = sourceIndex.byStemmioId.get(String(elementId));
  return element?.type === "element" ? element : null;
}

function specialReasonForCopy(element) {
  const tag = normalizedTag(element);
  if (hasCustomizedBuiltIn(element)) return "copy-customized-built-in";
  if (isCustomElement(element)) return "copy-custom-element";
  if (NESTED_LIST_TAGS.has(tag)) return "copy-nested-list";
  if (CONTROL_TAGS.has(tag)) return "copy-control";
  if (MEDIA_TAGS.has(tag)) return "copy-media";
  if (SVG_MATH_TAGS.has(tag)) {
    return "copy-svg-math";
  }
  if (!isHtmlElement(element)) return "copy-namespace-unsupported";
  if (TEMPLATE_TAGS.has(tag)) return "copy-template";
  if (SCRIPT_TAGS.has(tag)) return "copy-script";
  if (RESOURCE_TAGS.has(tag)) return "copy-resource";
  return null;
}

function copyAttributeReason(element) {
  for (const attribute of attributeEntries(element)) {
    const { name, value } = attribute;
    if (name === STEMMIO_ID_ATTRIBUTE) continue;
    if (name === "id" || name === "name") return "copy-author-identity";
    if (name === "is") return "copy-customized-built-in";
    if (name.startsWith("on")) return "copy-event-handler";
    if (REFERENCE_ATTRIBUTE_NAMES.has(name)) {
      if (value.trim() !== "") return "copy-reference-rewrite";
      continue;
    }
    if (name.startsWith("aria-") && value.trim() !== "") {
      // aria-label, aria-live and the other value-only ARIA attributes are
      // safe.  Only ARIA IDREF attributes are in REFERENCE_ATTRIBUTE_NAMES.
      if (name === "aria-label" || name === "aria-roledescription") continue;
      if (name.endsWith("label") || name.endsWith("describedby") || name.endsWith("controls")
        || name.endsWith("owns") || name.endsWith("flowto") || name.endsWith("details")
        || name.endsWith("errormessage") || name.endsWith("activedescendant")) {
        return "copy-reference-rewrite";
      }
    }
    if (RESOURCE_ATTRIBUTE_NAMES.has(name)) return "copy-resource-attribute";
    if (name === "href") {
      if (/^\s*#/u.test(value) || /^\s*(?:java|vb)script\s*:/iu.test(value)) {
        return /^\s*#/u.test(value) ? "copy-reference-rewrite" : "copy-event-handler";
      }
      if (/^\s*(?:data|blob):/iu.test(value)) return "copy-resource-attribute";
    }
    if (name === "style" && /url\s*\(/iu.test(value)) {
      return /url\s*\(\s*#/iu.test(value)
        ? "copy-reference-rewrite"
        : "copy-resource-attribute";
    }
  }
  return null;
}

function copySubtreeReason(sourceIndex, root) {
  const descendantsOfRoot = descendants(sourceIndex, root);
  if (!descendantsOfRoot) return "copy-invalid-source";
  const nodes = [root, ...descendantsOfRoot];
  for (const element of nodes) {
    if (sourceIdentityStatusInvalid(element)) return "copy-invalid-source";
    const specialReason = specialReasonForCopy(element);
    if (specialReason) return specialReason;
    if (element !== root && !SAFE_COPY_INLINE_TAGS.has(normalizedTag(element))) {
      return "copy-nested-block";
    }
    const attributesReason = copyAttributeReason(element);
    if (attributesReason) return attributesReason;
    const children = childNodes(sourceIndex, element);
    if (!children) return "copy-invalid-source";
    if (children.some((child) => child.type === "comment")) return "copy-comment";
  }
  return null;
}

function directCopyDecision(sourceIndex, target) {
  const rootTag = normalizedTag(target);
  if (rootTag === "div") {
    const children = childNodes(sourceIndex, target);
    if (!children || !children.length || children.some(child => child.type !== "text")
      || !target.textContent.trim()) return unsupported("copy-root-tag-unsupported");
    // This first container category is deliberately static and text-only.
    // Do not infer author-program dependencies from the current Runtime DOM.
    if (hasAuthorProgram(sourceIndex)) {
      return unsupported("copy-div-author-program");
    }
  } else if (!COPY_ROOT_TAGS.has(rootTag)) return unsupported("copy-root-tag-unsupported");
  const parentReason = unsupportedAncestorReason(sourceIndex, target, "copy");
  if (parentReason) return unsupported(parentReason);
  const parent = target.parentId ? sourceIndex.byNodeId.get(target.parentId) : null;
  if (parent?.type !== "element") return unsupported("copy-invalid-source");
  if (hasSignificantMixedContent(sourceIndex, parent)) {
    return unsupported("copy-parent-mixed-content");
  }
  const reason = copySubtreeReason(sourceIndex, target);
  if (reason) return unsupported(reason);
  if (!target.range || !target.boundarySafe || target.explicitEndTag === false) {
    return unsupported("copy-invalid-source");
  }
  // The kernel, not this policy, removes/reallocates inherited Stemmio IDs.
  // This function never materializes or writes a copy.
  return supported("copy-supported");
}

function unsupportedAncestorReason(sourceIndex, target, operation) {
  let parentId = target?.parentId ?? null;
  while (parentId) {
    const parent = sourceIndex.byNodeId.get(parentId);
    if (!parent || parent.type !== "element") {
      if (operation === "copy") return "copy-invalid-source";
      if (operation === "move") return "move-target-special";
      return "delete-special-structure";
    }
    const tag = normalizedTag(parent);
    const blocked = !isHtmlElement(parent)
      || hasCustomizedBuiltIn(parent)
      || isCustomElement(parent)
      || (SPECIAL_STRUCTURE_TAGS.has(tag)
        && !ROOT_TAGS.has(tag)
        && !NESTED_LIST_TAGS.has(tag));
    if (blocked) {
      if (operation === "copy") return "copy-parent-special-structure";
      if (operation === "move") return "move-target-special";
      return "delete-special-structure";
    }
    parentId = parent.parentId;
  }
  return null;
}

function canonicalElementId(element) {
  return element?.stemmioId ? String(element.stemmioId) : null;
}

function directMoveDestination(sourceIndex, target, destination) {
  if (!destination || typeof destination !== "object") {
    return { kind: "temporary", reason: "move-destination-unavailable" };
  }
  const sourceParent = target.parentId ? sourceIndex.byNodeId.get(target.parentId) : null;
  if (sourceParent?.type !== "element") {
    return { kind: "unsupported", reason: "move-parent-unavailable" };
  }
  const siblings = childElements(sourceIndex, sourceParent);
  if (!siblings) return { kind: "unsupported", reason: "move-destination-invalid" };
  const currentIndex = siblings.indexOf(target);
  if (currentIndex < 0) return { kind: "unsupported", reason: "move-destination-invalid" };

  let destinationParentId = destination.parentElementId;
  if (destinationParentId == null && destination.direction) {
    destinationParentId = canonicalElementId(sourceParent);
  }
  if (destinationParentId == null || String(destinationParentId) === "") {
    return { kind: "temporary", reason: "move-destination-unavailable" };
  }
  if (String(destinationParentId) !== canonicalElementId(sourceParent)) {
    const destinationParent = sourceElementById(sourceIndex, destinationParentId);
    if (!destinationParent) {
      return { kind: "temporary", reason: "move-destination-unavailable" };
    }
    if (destinationParent && isDescendant(sourceIndex, target, destinationParent)) {
      return { kind: "unsupported", reason: "move-cycle" };
    }
    return { kind: "unsupported", reason: "move-cross-parent" };
  }

  const direction = destination.direction;
  if (direction !== undefined && direction !== "up" && direction !== "down") {
    return { kind: "unsupported", reason: "move-destination-invalid" };
  }
  let beforeElementId = destination.beforeElementId;
  if (beforeElementId === undefined && !direction) {
    return { kind: "temporary", reason: "move-destination-unavailable" };
  }
  if (beforeElementId !== undefined && beforeElementId !== null) {
    beforeElementId = String(beforeElementId);
  } else if (beforeElementId === undefined && direction) {
    if (direction === "up") {
      beforeElementId = canonicalElementId(siblings[currentIndex - 1]);
    } else if (direction === "down") {
      beforeElementId = canonicalElementId(siblings[currentIndex + 2]) ?? null;
    } else {
      return { kind: "unsupported", reason: "move-destination-invalid" };
    }
  }

  if (beforeElementId !== null && beforeElementId !== undefined) {
    const before = sourceElementById(sourceIndex, beforeElementId);
    if (!before) return { kind: "temporary", reason: "move-anchor-unavailable" };
    if (before.parentId !== sourceParent.nodeId) {
      return { kind: "unsupported", reason: "move-anchor-invalid" };
    }
  }

  const previous = siblings[currentIndex - 1] ?? null;
  const next = siblings[currentIndex + 1] ?? null;
  const nextAfterNext = siblings[currentIndex + 2] ?? null;
  const previousId = canonicalElementId(previous);
  const nextAfterNextId = canonicalElementId(nextAfterNext);
  const beforeId = beforeElementId ?? null;
  if (beforeId === canonicalElementId(target)) {
    return { kind: "unsupported", reason: "move-noop" };
  }
  if (direction === "up" && !previous) {
    return { kind: "unsupported", reason: "move-anchor-unavailable" };
  }
  if (direction === "down" && !next) {
    return { kind: "unsupported", reason: "move-anchor-unavailable" };
  }
  const movingUp = beforeId !== null && previousId !== null && beforeId === previousId;
  const movingDown = beforeId === (nextAfterNextId ?? null) && Boolean(next);
  if (!movingUp && !movingDown) {
    if (beforeId === canonicalElementId(next)) return { kind: "unsupported", reason: "move-noop" };
    return { kind: "unsupported", reason: "move-non-adjacent" };
  }
  if (direction && ((direction === "up" && !movingUp) || (direction === "down" && !movingDown))) {
    return { kind: "unsupported", reason: "move-destination-invalid" };
  }
  if (movingUp && !previousId) return { kind: "unsupported", reason: "move-anchor-unavailable" };
  if (movingDown && next && !canonicalElementId(next) && nextAfterNext) {
    // When an explicit before anchor is needed, it must be a Stable-ID child.
    return { kind: "unsupported", reason: "move-anchor-unavailable" };
  }
  return {
    kind: "supported",
    beforeElementId: beforeId,
    direction: movingUp ? "up" : "down",
  };
}

function isDescendant(sourceIndex, ancestor, candidate) {
  if (!ancestor || !candidate) return false;
  let parentId = candidate.parentId;
  while (parentId) {
    if (parentId === ancestor.nodeId) return true;
    const parent = sourceIndex.byNodeId.get(parentId);
    if (parent?.type !== "element") break;
    parentId = parent.parentId;
  }
  return false;
}

function moveDecision(sourceIndex, target, destination) {
  const tag = normalizedTag(target);
  if (!target.parentId || ROOT_TAGS.has(tag)) return unsupported("move-target-root");
  const ancestorReason = unsupportedAncestorReason(sourceIndex, target, "move");
  if (ancestorReason) return unsupported(ancestorReason);
  if (!isHtmlElement(target) || hasCustomizedBuiltIn(target) || isCustomElement(target)
    || SPECIAL_STRUCTURE_TAGS.has(tag) || target.explicitEndTag === false) {
    return unsupported("move-target-special");
  }
  const descendantsOfTarget = descendants(sourceIndex, target);
  if (!descendantsOfTarget) return unsupported("move-target-special");
  if (descendantsOfTarget.some((element) => (
    !isHtmlElement(element)
    || hasCustomizedBuiltIn(element)
    || isCustomElement(element)
    || SPECIAL_STRUCTURE_TAGS.has(normalizedTag(element))
    || (!element.isVoid && element.explicitEndTag === false)
  ))) return unsupported("move-target-special");
  const parent = sourceIndex.byNodeId.get(target.parentId);
  if (parent?.type !== "element") return unsupported("move-parent-unavailable");
  if (!canonicalElementId(parent)) return unsupported("move-parent-identity-missing");
  const parentTag = normalizedTag(parent);
  if (!isHtmlElement(parent) || hasCustomizedBuiltIn(parent) || isCustomElement(parent)
    || MOVE_BLOCKED_PARENT_TAGS.has(parentTag)) {
    return unsupported("move-parent-special");
  }
  if (hasSignificantMixedContent(sourceIndex, parent)) return unsupported("move-mixed-content");
  const resolved = directMoveDestination(sourceIndex, target, destination);
  if (resolved.kind === "temporary") return temporarilyUnavailable(resolved.reason);
  if (resolved.kind === "unsupported") return unsupported(resolved.reason);
  return supported("move-supported", {
    beforeElementId: resolved.beforeElementId,
    direction: resolved.direction,
  });
}

function landingElement(sourceIndex, element) {
  const candidates = [
    {
      element: element.nextElementSiblingId
        ? sourceIndex.byNodeId.get(element.nextElementSiblingId)
        : null,
      role: "sibling",
    },
    {
      element: element.previousElementSiblingId
        ? sourceIndex.byNodeId.get(element.previousElementSiblingId)
        : null,
      role: "sibling",
    },
    {
      element: element.parentId ? sourceIndex.byNodeId.get(element.parentId) : null,
      role: "parent",
    },
  ];
  for (const { element: candidate, role } of candidates) {
    if (!candidate || candidate.type !== "element") continue;
    const tag = normalizedTag(candidate);
    if (!canonicalElementId(candidate) || ROOT_TAGS.has(tag)) continue;
    if (!isHtmlElement(candidate) || hasCustomizedBuiltIn(candidate) || isCustomElement(candidate)) continue;
    if (candidate.explicitEndTag === false || candidate.boundarySafe === false) continue;
    if (SPECIAL_STRUCTURE_TAGS.has(tag)
      && !(role === "parent" && NESTED_LIST_TAGS.has(tag))) continue;
    if (sourceIdentityStatusInvalid(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * Resolve the one source-backed element that should own selection after a
 * direct delete.  The structural projection and the admission policy both
 * consume this helper so a control/custom/special sibling cannot be admitted
 * by one path and selected by another.
 */
export function resolveDirectDeleteSelectionLanding(sourceIndex, removedRootElementId) {
  const target = sourceElementById(sourceIndex, removedRootElementId);
  return target ? canonicalElementId(landingElement(sourceIndex, target)) : null;
}

function deleteSubtreeIsSafe(sourceIndex, target) {
  const subtree = descendants(sourceIndex, target);
  if (!subtree) return false;
  for (const element of [target, ...subtree]) {
    const tag = normalizedTag(element);
    if (!isHtmlElement(element) || hasCustomizedBuiltIn(element) || isCustomElement(element)) return false;
    if (SPECIAL_STRUCTURE_TAGS.has(tag) || (!element.isVoid && element.explicitEndTag === false)) return false;
    if (sourceIdentityStatusInvalid(element)) return false;
  }
  return Boolean(target.range && target.boundarySafe && target.explicitEndTag !== false);
}

function deleteDecision(sourceIndex, target) {
  const tag = normalizedTag(target);
  if (!target.parentId || ROOT_TAGS.has(tag)) return unsupported("delete-target-root");
  if (unsupportedAncestorReason(sourceIndex, target, "delete")) {
    return unsupported("delete-special-structure");
  }
  const parent = sourceIndex.byNodeId.get(target.parentId);
  if (parent?.type !== "element") return unsupported("delete-special-structure");
  if (hasSignificantMixedContent(sourceIndex, parent)) {
    return unsupported("delete-mixed-content");
  }
  if (!deleteSubtreeIsSafe(sourceIndex, target)) return unsupported("delete-special-structure");
  return supported("delete-supported", {
    // A safe delete may legitimately leave no selectable source element.  The
    // command then clears selection; source/history safety is independent of
    // whether a post-delete landing exists.
    landingElementId: resolveDirectDeleteSelectionLanding(
      sourceIndex,
      canonicalElementId(target),
    ),
  });
}

function prepareSourceIndex(sourceIndex) {
  if (!sourceIndexReady(sourceIndex)) return temporarilyUnavailable("source-index-unavailable");
  if (!sourceIndexIntegritySafe(sourceIndex)) return unsupported("source-index-invalid");
  return null;
}

/**
 * Evaluate direct structure admission using only source facts.
 *
 * `html` is accepted for call-site uniformity.  It is intentionally never
 * parsed or written here: any action that would insert caller-provided HTML is
 * rejected and must use the shared semantic insert primitive instead.
 */
export function evaluateDirectStructurePolicy({
  action,
  sourceIndex,
  selection,
  elementId,
  destination,
  html,
} = {}) {
  const normalizedAction = normalizeAction(action);
  if (normalizedAction === "insert" || (!normalizedAction && typeof html === "string" && html.length > 0)) {
    return unsupported("direct-html-insert-unsupported");
  }
  if (!normalizedAction) return unsupported("action-unsupported");

  const indexCheck = prepareSourceIndex(sourceIndex);
  if (indexCheck) return indexCheck;
  const targetResult = resolveTarget(sourceIndex, { selection, elementId });
  if (targetResult?.status) return targetResult;

  const { target } = targetResult;
  if (normalizedAction === "copy") return directCopyDecision(sourceIndex, target);
  if (normalizedAction === "move") return moveDecision(sourceIndex, target, destination);
  if (normalizedAction === "delete") return deleteDecision(sourceIndex, target);
  return unsupported("action-unsupported");
}

/** Copy-only entry point for pointer/UI capability and command callers. */
export function directCopyPolicyForElement({
  sourceIndex,
  selection,
  elementId,
  html,
} = {}) {
  const result = evaluateDirectStructurePolicy({
    action: "copy",
    sourceIndex,
    selection,
    elementId,
    html,
  });
  return Object.freeze({
    ...result,
    copyPolicy: result.copyPolicy ?? result.status,
  });
}
