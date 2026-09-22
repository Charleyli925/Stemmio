import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { parseHtmlSource } from "../../bridge/html-source-parser.mjs";
import {
  STEMMIO_ELEMENT_ID_ATTRIBUTE,
  STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
  isValidStemmioElementId,
} from "./stemmio-element-identity.js";
import { recordEditPipelineCount } from "./edit-pipeline-counters.js";

export const SOURCE_NODE_ATTRIBUTE = "data-html-ai-source-node-id";
// parseKey / nodeId is a single-parse handle inside SourceIndex. It must not
// leave source-index / source-patch, enter Runtime DOM, TargetRef, Selection,
// comments, Review or history, or authorize edits.

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const STABLE_ATTRIBUTE_NAMES = new Set([
  "id",
  "name",
  "role",
  "title",
  "href",
  "src",
  "alt",
  "type",
  "value",
  "for",
  // Source-authored geometry is the only stable identity available for many
  // anonymous SVG shapes. Patch transactions refresh these values when the
  // shape itself changes; unrelated edits can then rebind the same rect/path
  // without guessing between every element of the same tag.
  "x",
  "y",
  "width",
  "height",
  "rx",
  "ry",
  "cx",
  "cy",
  "r",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "viewbox",
  "preserveaspectratio",
]);

const HTML_WHITESPACE = /[\t\n\f\r ]/;

export class SourceIndexError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourceIndexError";
    this.code = code;
    this.details = details;
  }
}

const OWNED_SOURCE_INDEXES = new WeakSet();

function readOnlyMap(map) {
  return new Proxy(map, {
    get(target, property) {
      if (property === "set" || property === "delete" || property === "clear") {
        return () => {
          throw new TypeError("SourceIndex is read-only.");
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function freezeSourceIndexValue(value, seen, skip) {
  if (!value || typeof value !== "object" || seen.has(value) || skip.has(value)) {
    return;
  }
  seen.add(value);
  if (value instanceof Map) {
    for (const nested of value.values()) {
      freezeSourceIndexValue(nested, seen, skip);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      freezeSourceIndexValue(nested, seen, skip);
    }
    Object.freeze(value);
    return;
  }
  for (const nested of Object.values(value)) {
    freezeSourceIndexValue(nested, seen, skip);
  }
  Object.freeze(value);
}

function sealBuiltSourceIndex(index) {
  const skip = new Set();
  if (index.document) skip.add(index.document);
  index.byNodeId = readOnlyMap(index.byNodeId);
  index.byStemmioId = readOnlyMap(index.byStemmioId);
  index.elementsByTagName = readOnlyMap(index.elementsByTagName);
  for (const element of index.elements) {
    if (element.attributesByName instanceof Map) {
      element.attributesByName = readOnlyMap(element.attributesByName);
    }
  }
  freezeSourceIndexValue(index, new WeakSet(), skip);
  OWNED_SOURCE_INDEXES.add(index);
  return index;
}

export function isOwnedSourceIndex(index) {
  return Boolean(index) && OWNED_SOURCE_INDEXES.has(index);
}

// Reuse is correspondence, not a skip-validation flag. The candidate must have
// been produced by buildSourceIndex, its source string must be these exact
// bytes, and its Hash must match a freshly computed Hash of those bytes.
export function resolveOwnedSourceIndex(html, candidateIndex, options = {}) {
  const source = String(html ?? "");
  if (candidateIndex == null) {
    return buildSourceIndex(source, options);
  }
  if (!OWNED_SOURCE_INDEXES.has(candidateIndex)) {
    throw new SourceIndexError(
      "SOURCE_INDEX_NOT_OWNED",
      "Only a SourceIndex produced by buildSourceIndex can be reused.",
    );
  }
  if (candidateIndex.source !== source) {
    throw new SourceIndexError(
      "SOURCE_INDEX_HTML_MISMATCH",
      "The reused SourceIndex does not correspond to these source bytes.",
    );
  }
  const actualSourceSha256 = sourceSha256(source);
  if (candidateIndex.sourceSha256 !== actualSourceSha256) {
    throw new SourceIndexError(
      "SOURCE_INDEX_HASH_MISMATCH",
      "The reused SourceIndex Hash does not match the current source bytes.",
      {
        expectedSourceSha256: candidateIndex.sourceSha256,
        actualSourceSha256,
      },
    );
  }
  return candidateIndex;
}

function range(startOffset, endOffset) {
  return { startOffset, endOffset };
}

function isIntegerRange(value, sourceLength) {
  return Boolean(
    value
    && Number.isInteger(value.startOffset)
    && Number.isInteger(value.endOffset)
    && value.startOffset >= 0
    && value.endOffset >= value.startOffset
    && value.endOffset <= sourceLength,
  );
}

function locationRange(location) {
  if (
    !Number.isInteger(location?.startOffset)
    || !Number.isInteger(location?.endOffset)
  ) {
    return null;
  }
  return range(location.startOffset, location.endOffset);
}

function rawSlice(source, value) {
  return value ? source.slice(value.startOffset, value.endOffset) : "";
}

function closingDelimiterOffset(source, startTagRange) {
  let cursor = startTagRange.endOffset - 1;
  while (cursor > startTagRange.startOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor -= 1;
  }
  if (source[cursor] !== ">") return startTagRange.endOffset;
  cursor -= 1;
  while (cursor > startTagRange.startOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor -= 1;
  }
  return source[cursor] === "/" ? cursor : startTagRange.endOffset - 1;
}

/**
 * parse5 intentionally drops duplicate attributes. Source patching cannot do
 * that, so start tags are scanned again and every original attribute receives
 * exact UTF-16 ranges.
 */
export function scanStartTagAttributes(source, startTagRange) {
  if (!isIntegerRange(startTagRange, source.length)) return [];
  let cursor = startTagRange.startOffset + 1;
  while (cursor < startTagRange.endOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor += 1;
  }
  if (source[cursor] === "/") cursor += 1;
  while (
    cursor < startTagRange.endOffset
    && !HTML_WHITESPACE.test(source[cursor])
    && source[cursor] !== ">"
    && source[cursor] !== "/"
  ) {
    cursor += 1;
  }

  const attributes = [];
  while (cursor < startTagRange.endOffset) {
    while (cursor < startTagRange.endOffset && HTML_WHITESPACE.test(source[cursor])) {
      cursor += 1;
    }
    if (
      cursor >= startTagRange.endOffset
      || source[cursor] === ">"
      || (source[cursor] === "/" && source[cursor + 1] === ">")
    ) {
      break;
    }

    const attributeStart = cursor;
    while (
      cursor < startTagRange.endOffset
      && !HTML_WHITESPACE.test(source[cursor])
      && source[cursor] !== "="
      && source[cursor] !== ">"
      && source[cursor] !== "/"
    ) {
      cursor += 1;
    }
    const nameEnd = cursor;
    if (nameEnd === attributeStart) {
      cursor += 1;
      continue;
    }

    const rawName = source.slice(attributeStart, nameEnd);
    while (cursor < startTagRange.endOffset && HTML_WHITESPACE.test(source[cursor])) {
      cursor += 1;
    }

    let equalsOffset = null;
    let quote = null;
    let valueRange = null;
    if (source[cursor] === "=") {
      equalsOffset = cursor;
      cursor += 1;
      while (cursor < startTagRange.endOffset && HTML_WHITESPACE.test(source[cursor])) {
        cursor += 1;
      }
      if (source[cursor] === "\"" || source[cursor] === "'") {
        quote = source[cursor];
        cursor += 1;
        const valueStart = cursor;
        while (cursor < startTagRange.endOffset && source[cursor] !== quote) {
          cursor += 1;
        }
        valueRange = range(valueStart, cursor);
        if (source[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (
          cursor < startTagRange.endOffset
          && !HTML_WHITESPACE.test(source[cursor])
          && source[cursor] !== ">"
          && !(source[cursor] === "/" && source[cursor + 1] === ">")
        ) {
          cursor += 1;
        }
        valueRange = range(valueStart, cursor);
      }
    }

    const attributeEnd = cursor;
    attributes.push({
      name: rawName.toLowerCase(),
      rawName,
      raw: source.slice(attributeStart, attributeEnd),
      rawValue: valueRange ? rawSlice(source, valueRange) : null,
      quote,
      equalsOffset,
      range: range(attributeStart, attributeEnd),
      nameRange: range(attributeStart, nameEnd),
      valueRange,
      removalRange: range(attributeStart, attributeEnd),
    });
  }
  return attributes;
}

export function sourceSha256(source) {
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(String(source))))}`;
}

export function normalizeSourceText(value) {
  return String(value ?? "").replace(/[\t\n\f\r ]+/g, " ").trim();
}

function codePointPrefix(value, size = 48) {
  return Array.from(value).slice(0, size).join("");
}

function codePointSuffix(value, size = 48) {
  return Array.from(value).slice(-size).join("");
}

function cssEscape(value) {
  return String(value).replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match, digit) => {
    const codePoint = match.codePointAt(0).toString(16);
    return digit ? `\\${codePoint} ` : `\\${match}`;
  });
}

function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stableAttributesFor(attributes) {
  const grouped = new Map();
  for (const attribute of attributes) {
    const group = grouped.get(attribute.name) ?? [];
    group.push(attribute);
    grouped.set(attribute.name, group);
  }
  const result = {};
  for (const [name, group] of grouped) {
    if (group.length !== 1 || group[0].rawValue === null) continue;
    if (name === SOURCE_NODE_ATTRIBUTE) continue;
    if (
      STABLE_ATTRIBUTE_NAMES.has(name)
      || name.startsWith("data-")
      || name.startsWith("aria-")
    ) {
      result[name] = group[0].value ?? group[0].rawValue;
    }
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function elementSignature(element) {
  const attributes = Object.entries(element.stableAttributes)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(",");
  return attributes ? `${element.tagName}[${attributes}]` : element.tagName;
}

function selectorFor(element, index) {
  const id = element.stableAttributes.id;
  if (id) return `#${cssEscape(id)}`;
  const preferredAttribute = Object.entries(element.stableAttributes).find(
    ([name]) => name.startsWith("data-") || name === "name" || name === "aria-label",
  );
  if (preferredAttribute) {
    return `${element.tagName}[${preferredAttribute[0]}="${cssAttributeValue(preferredAttribute[1])}"]`;
  }
  const classAttribute = element.attributesByName.get("class")?.[0];
  const classes = String(classAttribute?.value ?? classAttribute?.rawValue ?? "")
    .split(/[\t\n\f\r ]+/)
    .filter(Boolean)
    .slice(0, 2);
  if (classes.length > 0) {
    return `${element.tagName}${classes.map((name) => `.${cssEscape(name)}`).join("")}`;
  }
  const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
  const sameTypeIndex = parent?.type === "element"
    ? parent.childElementIds
      .map((nodeId) => index.byNodeId.get(nodeId))
      .filter((sibling) => sibling?.type === "element" && sibling.tagName === element.tagName)
      .findIndex((sibling) => sibling.nodeId === element.nodeId)
    : index.elements
      .filter((candidate) => !candidate.parentId && candidate.tagName === element.tagName)
      .findIndex((candidate) => candidate.nodeId === element.nodeId);
  const base = `${element.tagName}:nth-of-type(${Math.max(0, sameTypeIndex) + 1})`;
  return parent?.selector ? `${parent.selector} > ${base}` : base;
}

function labelFor(element) {
  const stable = element.stableAttributes;
  return stable["aria-label"]
    || stable.title
    || stable.id
    || codePointPrefix(element.directText || element.textContent || "", 32)
    || `${element.tagName} #${element.siblingIndex + 1}`;
}

function childNodesFor(node) {
  if (node.tagName === "template" && node.content) {
    return node.content.childNodes ?? [];
  }
  return node.childNodes ?? [];
}

function errorCounts(errors) {
  const counts = new Map();
  for (const error of errors) {
    counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
  }
  return counts;
}

export function compareParseIntegrity(baseIndex, nextIndex) {
  const baseCounts = errorCounts(baseIndex.parseErrors);
  const nextCounts = errorCounts(nextIndex.parseErrors);
  const introducedParseErrors = [];
  for (const [code, count] of nextCounts) {
    const introduced = count - (baseCounts.get(code) ?? 0);
    if (introduced > 0) introducedParseErrors.push({ code, count: introduced });
  }
  return {
    ok: introducedParseErrors.length === 0 && nextIndex.rangeErrors.length === 0,
    introducedParseErrors,
    rangeErrors: nextIndex.rangeErrors,
  };
}

// options.scope/caller classify opt-in test counters only. They never skip
// validation or mark an index as already verified.
export function buildSourceIndex(html, options = {}) {
  const sourceText = String(html ?? "");
  recordEditPipelineCount("sourceIndexBuild", {
    scope: options.scope,
    caller: options.caller || "buildSourceIndex",
    codeUnitLength: sourceText.length,
  });
  const parsed = parseHtmlSource(html);
  const source = parsed.source;
  const index = {
    source,
    sourceSha256: sourceSha256(source),
    document: parsed.document,
    parseErrors: parsed.parseErrors,
    rangeErrors: [],
    nodes: [],
    elements: [],
    textNodes: [],
    comments: [],
    rootNodeIds: [],
    byNodeId: new Map(),
    byStemmioId: new Map(),
    elementsByTagName: new Map(),
    stemmioIdentity: null,
  };

  const attach = (record, parentId) => {
    record.parentId = parentId;
    index.nodes.push(record);
    index.byNodeId.set(record.nodeId, record);
    if (parentId) {
      index.byNodeId.get(parentId)?.childIds.push(record.nodeId);
    } else {
      index.rootNodeIds.push(record.nodeId);
    }
  };

  const visit = (node, parentId = null) => {
    if (typeof node.tagName === "string") {
      const elementRange = locationRange(node.sourceCodeLocation);
      const startTagRange = locationRange(node.sourceCodeLocation?.startTag);
      if (!elementRange || !startTagRange) {
        for (const child of childNodesFor(node)) visit(child, parentId);
        return;
      }

      const tagName = node.tagName.toLowerCase();
      const endTagRange = locationRange(node.sourceCodeLocation?.endTag);
      const attributes = scanStartTagAttributes(source, startTagRange);
      const decodedAttributes = new Map(
        (node.attrs ?? []).map((attribute) => [
          `${attribute.prefix ? `${attribute.prefix}:` : ""}${attribute.name}`.toLowerCase(),
          attribute.value,
        ]),
      );
      for (const attribute of attributes) {
        attribute.value = decodedAttributes.has(attribute.name)
          ? decodedAttributes.get(attribute.name)
          : attribute.rawValue;
      }
      const attributesByName = new Map();
      for (const attribute of attributes) {
        const group = attributesByName.get(attribute.name) ?? [];
        group.push(attribute);
        attributesByName.set(attribute.name, group);
      }

      const nodeId = `element:${startTagRange.startOffset}:${elementRange.endOffset}:${tagName}`;
      const element = {
        type: "element",
        nodeId,
        tagName,
        namespaceURI: node.namespaceURI ?? null,
        range: elementRange,
        startTagRange,
        endTagRange,
        contentRange: range(
          startTagRange.endOffset,
          endTagRange?.startOffset ?? elementRange.endOffset,
        ),
        closingDelimiterOffset: closingDelimiterOffset(source, startTagRange),
        raw: rawSlice(source, elementRange),
        startTagRaw: rawSlice(source, startTagRange),
        endTagRaw: rawSlice(source, endTagRange),
        attributes,
        attributesByName,
        stableAttributes: {},
        childIds: [],
        childElementIds: [],
        textNodeIds: [],
        previousSiblingId: null,
        nextSiblingId: null,
        previousElementSiblingId: null,
        nextElementSiblingId: null,
        sourceSiblingIndex: 0,
        siblingIndex: 0,
        directText: "",
        textContent: "",
        label: "",
        selector: "",
        fingerprint: null,
        declaredStemmioId: null,
        stemmioId: null,
        stemmioIdAttribute: null,
        stemmioIdentityStatus: "missing",
        explicitEndTag: Boolean(endTagRange),
        isVoid: VOID_ELEMENTS.has(tagName),
        boundarySafe: true,
      };
      attach(element, parentId);
      index.elements.push(element);
      const byTag = index.elementsByTagName.get(tagName) ?? [];
      byTag.push(element);
      index.elementsByTagName.set(tagName, byTag);
      for (const child of childNodesFor(node)) visit(child, nodeId);
      return;
    }

    let nodeRange = locationRange(node.sourceCodeLocation);
    if (node.nodeName === "#text" && nodeRange) {
      const parent = parentId ? index.byNodeId.get(parentId) : null;
      if (
        parent?.type === "element"
        && (
          nodeRange.startOffset < parent.contentRange.startOffset
          || nodeRange.endOffset > parent.contentRange.endOffset
        )
      ) {
        if (normalizeSourceText(node.value ?? "") !== "") return;
        nodeRange = range(
          Math.max(nodeRange.startOffset, parent.contentRange.startOffset),
          Math.min(nodeRange.endOffset, parent.contentRange.endOffset),
        );
        if (nodeRange.endOffset <= nodeRange.startOffset) return;
      }
      const text = {
        type: "text",
        nodeId: `text:${nodeRange.startOffset}:${nodeRange.endOffset}`,
        range: nodeRange,
        raw: rawSlice(source, nodeRange),
        value: node.value ?? "",
        whitespaceOnly: normalizeSourceText(node.value ?? "") === "",
        childIds: [],
        previousSiblingId: null,
        nextSiblingId: null,
        sourceSiblingIndex: 0,
      };
      attach(text, parentId);
      index.textNodes.push(text);
      return;
    }

    if (node.nodeName === "#comment" && nodeRange) {
      const comment = {
        type: "comment",
        nodeId: `comment:${nodeRange.startOffset}:${nodeRange.endOffset}`,
        range: nodeRange,
        raw: rawSlice(source, nodeRange),
        value: node.data ?? "",
        childIds: [],
        previousSiblingId: null,
        nextSiblingId: null,
        sourceSiblingIndex: 0,
      };
      attach(comment, parentId);
      index.comments.push(comment);
      return;
    }

    for (const child of node.childNodes ?? []) visit(child, parentId);
  };

  visit(parsed.document);

  for (const element of index.elements) {
    const children = element.childIds.map((nodeId) => index.byNodeId.get(nodeId));
    const elementChildren = children.filter((child) => child.type === "element");
    element.childElementIds = elementChildren.map((child) => child.nodeId);
    element.textNodeIds = children
      .filter((child) => child.type === "text")
      .map((child) => child.nodeId);
    for (let position = 0; position < children.length; position += 1) {
      const child = children[position];
      child.sourceSiblingIndex = position;
      child.previousSiblingId = children[position - 1]?.nodeId ?? null;
      child.nextSiblingId = children[position + 1]?.nodeId ?? null;
    }
    for (let position = 0; position < elementChildren.length; position += 1) {
      const child = elementChildren[position];
      child.siblingIndex = position;
      child.previousElementSiblingId = elementChildren[position - 1]?.nodeId ?? null;
      child.nextElementSiblingId = elementChildren[position + 1]?.nodeId ?? null;
    }
  }

  const descendantText = (element) => {
    const pieces = [];
    for (const childId of element.childIds) {
      const child = index.byNodeId.get(childId);
      if (child.type === "text") pieces.push(child.value);
      if (child.type === "element") pieces.push(descendantText(child));
    }
    return pieces.join("");
  };

  for (const element of index.elements) {
    element.directText = normalizeSourceText(
      element.textNodeIds.map((nodeId) => index.byNodeId.get(nodeId).value).join(" "),
    );
    element.textContent = normalizeSourceText(descendantText(element));
    element.stableAttributes = stableAttributesFor(element.attributes);
  }

  for (const element of index.elements) {
    const ancestors = [];
    let parentId = element.parentId;
    while (parentId && ancestors.length < 6) {
      const parent = index.byNodeId.get(parentId);
      if (!parent || parent.type !== "element") break;
      ancestors.push(elementSignature(parent));
      parentId = parent.parentId;
    }
    // Inline formatting wrappers must not change an element's identity. Using
    // only direct text drops every character moved below a <span>, which makes
    // repeated partial styling progressively erase the TargetRef fingerprint.
    const fingerprintText = element.textContent;
    element.fingerprint = {
      tagName: element.tagName,
      stableAttributes: { ...element.stableAttributes },
      ancestorFingerprint: ancestors,
      textPrefix: fingerprintText ? codePointPrefix(fingerprintText) : undefined,
      textSuffix: fingerprintText ? codePointSuffix(fingerprintText) : undefined,
    };
    element.label = labelFor(element);
    element.selector = selectorFor(element, index);
  }

  const stemmioIdentityIssues = [];
  const claimsByStemmioId = new Map();
  const claimStemmioId = (stemmioId, element, attribute) => {
    const claims = claimsByStemmioId.get(stemmioId) ?? [];
    claims.push({ element, attribute });
    claimsByStemmioId.set(stemmioId, claims);
  };
  for (const element of index.elements) {
    const attributes = element.attributesByName.get(STEMMIO_ELEMENT_ID_ATTRIBUTE) ?? [];
    if (attributes.length === 0) continue;
    element.stemmioIdAttribute = attributes[0];
    if (attributes.length !== 1) {
      for (const attribute of attributes) {
        if (isValidStemmioElementId(attribute.rawValue)) {
          claimStemmioId(attribute.rawValue, element, attribute);
        }
      }
      element.stemmioIdentityStatus = "invalid";
      stemmioIdentityIssues.push({
        code: "STEMMIO_ID_ATTRIBUTE_REPEATED",
        nodeId: element.nodeId,
        attributeRanges: attributes.map((attribute) => ({ ...attribute.range })),
      });
      continue;
    }
    const [attribute] = attributes;
    const value = attribute.rawValue;
    element.declaredStemmioId = value;
    if (!isValidStemmioElementId(value)) {
      element.stemmioIdentityStatus = "invalid";
      stemmioIdentityIssues.push({
        code: "STEMMIO_ID_INVALID_FORMAT",
        nodeId: element.nodeId,
        value,
        attributeRange: { ...attribute.range },
        valueRange: attribute.valueRange ? { ...attribute.valueRange } : null,
      });
      continue;
    }
    element.stemmioIdentityStatus = "candidate";
    claimStemmioId(value, element, attribute);
  }

  for (const [stemmioId, claims] of claimsByStemmioId) {
    const claimedElements = [...new Set(claims.map((claim) => claim.element))];
    if (
      claims.length === 1
      && claimedElements[0]?.stemmioIdentityStatus === "candidate"
    ) {
      const [element] = claimedElements;
      element.stemmioId = stemmioId;
      element.stemmioIdentityStatus = "valid";
      index.byStemmioId.set(stemmioId, element);
      continue;
    }
    if (claimedElements.length < 2) continue;
    for (const element of claimedElements) {
      if (element.stemmioIdentityStatus === "candidate") {
        element.stemmioIdentityStatus = "duplicate";
      }
    }
    stemmioIdentityIssues.push({
      code: "STEMMIO_ID_DUPLICATE_VALUE",
      stemmioId,
      nodeIds: claimedElements.map((element) => element.nodeId),
      elementRanges: claimedElements.map((element) => ({ ...element.range })),
      attributeRanges: claims.map((claim) => ({ ...claim.attribute.range })),
    });
  }

  const identifiedElementCount = index.byStemmioId.size;
  const invalidElementCount = index.elements.filter(
    (element) => element.stemmioIdentityStatus === "invalid"
      || element.stemmioIdentityStatus === "duplicate",
  ).length;
  const missingElementCount = index.elements.filter(
    (element) => element.stemmioIdentityStatus === "missing",
  ).length;
  index.stemmioIdentity = {
    schemaVersion: STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
    attributeName: STEMMIO_ELEMENT_ID_ATTRIBUTE,
    status: invalidElementCount > 0
      ? "invalid"
      : missingElementCount === 0
        ? "complete"
        : identifiedElementCount === 0
          ? "absent"
          : "partial",
    valid: stemmioIdentityIssues.length === 0,
    complete: invalidElementCount === 0 && missingElementCount === 0,
    totalElementCount: index.elements.length,
    identifiedElementCount,
    missingElementCount,
    invalidElementCount,
    issues: stemmioIdentityIssues,
  };

  for (const element of index.elements) {
    let previousEnd = element.contentRange.startOffset;
    for (const childId of element.childIds) {
      const child = index.byNodeId.get(childId);
      if (
        !isIntegerRange(child.range, source.length)
        || child.range.startOffset < element.contentRange.startOffset
        || child.range.endOffset > element.contentRange.endOffset
        || child.range.startOffset < previousEnd
      ) {
        element.boundarySafe = false;
        index.rangeErrors.push({
          code: "UNSAFE_CHILD_RANGE",
          elementId: element.nodeId,
          childId,
        });
      }
      previousEnd = Math.max(previousEnd, child.range.endOffset);
    }
  }

  index.integrity = {
    ok: index.rangeErrors.length === 0,
    parseErrorCount: index.parseErrors.length,
    rangeErrorCount: index.rangeErrors.length,
  };
  return sealBuiltSourceIndex(index);
}
