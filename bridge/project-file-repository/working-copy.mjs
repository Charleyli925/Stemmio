// Working Copy layout, state validation and same-directory CAS replacement.
import { randomUUID } from "node:crypto";
import {
  link,
  unlink,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  sha256,
  syncDirectory,
} from "../lifecycle-core.mjs";
import {
  parseHtmlSource,
  rawStartTagAttributes,
} from "../html-source-parser.mjs";
import {
  STEMMIO_ELEMENT_ID_ATTRIBUTE,
  STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
  generateStemmioElementId,
  isValidStemmioElementId,
} from "../../shared/stemmio-element-identity.mjs";
import {
  validateSourceHistoryOperationBytes,
} from "../../shared/source-history.mjs";
import {
  createSemanticIdentitySnapshot,
  verifySemanticIdentityTransition,
} from "../../shared/semantic-identity-delta.mjs";
import { nonReplaceTemporaryName } from "../../shared/project-storage-contract.mjs";

import {
  PROJECT_FILE_SCHEMA_VERSION,
  MAX_HTML_BYTES,
  SAFE_OPERATION_ID,
  SAVE_RECOVERY_ID,
  SHA256,
  SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID,
  WORKING_COPY_ID,
  WORKING_COPY_SAVE_STATES,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  topLevelHtmlRelativePath,
} from "./identity.mjs";
import {
  assertId,
  copyFileIdentity,
  readHtmlFile,
  regularInformation,
  sameFileIdentity,
  assertRealPathInsideProject,
  ensureRelativePath,
  isObject,
  pathInside,
  resolveRelative,
  validStateTimestamp,
} from "./path-safety.mjs";
import {
  assertKernelTextMaterialization,
} from "./semantic-text-materialization.mjs";
import {
  assertKernelStructurePatchMaterialization,
} from "./semantic-structure-materialization.mjs";

const HTML_WHITESPACE = /[\t\n\f\r ]/u;
const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

export const SOURCE_ELEMENT_IDENTITY_MIGRATION_TRANSACTION_SCHEMA_VERSION = "1.0.0";

function startTagClosingDelimiterOffset(source, startTag) {
  let cursor = startTag.endOffset - 1;
  while (cursor > startTag.startOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor -= 1;
  }
  if (source[cursor] !== ">") return null;
  cursor -= 1;
  while (cursor > startTag.startOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor -= 1;
  }
  return source[cursor] === "/" ? cursor : startTag.endOffset - 1;
}

export function inspectSourceElementIdentity(html) {
  const source = String(html);
  const parsed = parseHtmlSource(source);
  const inspectedElements = parsed.elements.flatMap((token) => {
    const startTag = token.node?.sourceCodeLocation?.startTag;
    if (
      !Number.isInteger(startTag?.startOffset)
      || !Number.isInteger(startTag?.endOffset)
      || startTag.startOffset < 0
      || startTag.endOffset <= startTag.startOffset
      || startTag.endOffset > source.length
    ) {
      return [];
    }
    const closingDelimiterOffset = startTagClosingDelimiterOffset(source, startTag);
    if (!Number.isInteger(closingDelimiterOffset)) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_RANGE_INVALID",
        "A source element start tag cannot be safely identified.",
        { tagName: token.name, startOffset: startTag.startOffset },
      );
    }
    const identityAttributes = rawStartTagAttributes(source, startTag).filter(
      (attribute) => attribute.name === STEMMIO_ELEMENT_ID_ATTRIBUTE,
    );
    const endTag = token.node?.sourceCodeLocation?.endTag;
    const explicitEndTag = Number.isInteger(endTag?.startOffset)
      && Number.isInteger(endTag?.endOffset);
    const isVoid = HTML_VOID_ELEMENTS.has(token.name);
    const startTagRaw = source.slice(startTag.startOffset, startTag.endOffset);
    const sourceEndOffset = Number.isInteger(token.node?.sourceCodeLocation?.endOffset)
      ? token.node.sourceCodeLocation.endOffset
      : startTag.endOffset;
    const contentEndOffset = explicitEndTag
      ? endTag.startOffset
      : isVoid
        ? startTag.endOffset
        : sourceEndOffset;
    let boundarySafe = true;
    let previousChildEndOffset = startTag.endOffset;
    const authoredChildren = token.node?.nodeName === "template" && token.node.content
      ? token.node.content.childNodes ?? []
      : token.node?.childNodes ?? [];
    for (const child of authoredChildren) {
      const location = child?.sourceCodeLocation;
      if (!Number.isInteger(location?.startOffset) || !Number.isInteger(location?.endOffset)) {
        continue;
      }
      if (
        location.startOffset < startTag.endOffset
        || location.endOffset > contentEndOffset
        || location.startOffset < previousChildEndOffset
      ) {
        boundarySafe = false;
        break;
      }
      previousChildEndOffset = Math.max(previousChildEndOffset, location.endOffset);
    }
    return [{
      node: token.node,
      tagName: token.name,
      startOffset: startTag.startOffset,
      endOffset: startTag.endOffset,
      sourceEndOffset,
      contentStartOffset: startTag.endOffset,
      contentEndOffset,
      explicitEndTag,
      isVoid,
      selfClosing: startTag.endOffset === sourceEndOffset
        && /\/\s*>$/u.test(startTagRaw),
      boundarySafe,
      closingDelimiterOffset,
      identityAttributes,
      stemmioId: identityAttributes.length === 1
        ? identityAttributes[0].rawValue
        : null,
    }];
  });
  const elementIndexByNode = new Map(
    inspectedElements.map((element, index) => [element.node, index]),
  );
  const parentElementByNode = new Map();
  const visitAuthoredChildren = (node, authoredParent = null) => {
    for (const child of node?.childNodes ?? []) {
      const explicitElement = elementIndexByNode.has(child);
      if (explicitElement) parentElementByNode.set(child, authoredParent);
      visitAuthoredChildren(child, explicitElement ? child : authoredParent);
    }
    if (node?.content) {
      visitAuthoredChildren(
        node.content,
        elementIndexByNode.has(node) ? node : authoredParent,
      );
    }
  };
  visitAuthoredChildren(parsed.document);
  const elements = inspectedElements.map(({ node, ...element }, sourceOrder) => ({
    ...element,
    sourceOrder,
    parentElementIndex: elementIndexByNode.get(parentElementByNode.get(node)) ?? null,
  }));

  const issues = [];
  const claims = new Map();
  const missing = [];
  for (const element of elements) {
    if (element.identityAttributes.length === 0) {
      missing.push(element);
      continue;
    }
    if (element.identityAttributes.length !== 1) {
      issues.push({
        code: "STEMMIO_ID_ATTRIBUTE_REPEATED",
        tagName: element.tagName,
        startOffset: element.startOffset,
      });
      continue;
    }
    if (!isValidStemmioElementId(element.stemmioId)) {
      issues.push({
        code: "STEMMIO_ID_INVALID_FORMAT",
        tagName: element.tagName,
        startOffset: element.startOffset,
        value: element.stemmioId,
      });
      continue;
    }
    const matching = claims.get(element.stemmioId) ?? [];
    matching.push(element);
    claims.set(element.stemmioId, matching);
  }
  for (const [stemmioId, matching] of claims) {
    if (matching.length < 2) continue;
    issues.push({
      code: "STEMMIO_ID_DUPLICATE_VALUE",
      stemmioId,
      tagNames: matching.map((element) => element.tagName),
      startOffsets: matching.map((element) => element.startOffset),
    });
  }
  return {
    schemaVersion: STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
    attributeName: STEMMIO_ELEMENT_ID_ATTRIBUTE,
    valid: issues.length === 0,
    complete: issues.length === 0 && missing.length === 0,
    status: issues.length > 0
      ? "invalid"
      : missing.length === 0
        ? "complete"
        : claims.size === 0
          ? "absent"
          : "partial",
    totalElementCount: elements.length,
    identifiedElementCount: elements.length - missing.length,
    missingElementCount: missing.length,
    elements,
    missing,
    claimedIds: new Set(claims.keys()),
    issues,
    parseErrors: parsed.parseErrors,
  };
}

function identityElementMap(inspection) {
  return new Map(
    inspection.elements
      .filter((element) => isValidStemmioElementId(element.stemmioId))
      .map((element) => [element.stemmioId, element]),
  );
}

export function sourceElementIdentityBindingSha256(htmlOrInspection) {
  const inspection = typeof htmlOrInspection === "string"
    ? inspectSourceElementIdentity(htmlOrInspection)
    : htmlOrInspection;
  if (!inspection?.complete) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_INVALID",
      "A complete source identity set is required to seal its bindings.",
      { issues: inspection?.issues ?? [] },
    );
  }
  const elements = inspection.elements.map((element) => {
    const parent = Number.isInteger(element.parentElementIndex)
      ? inspection.elements[element.parentElementIndex]
      : null;
    return [element.stemmioId, element.tagName, parent?.stemmioId ?? null];
  });
  return sha256(Buffer.from(JSON.stringify({
    schemaVersion: STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
    elements,
  }), "utf8"));
}

function nearestRetainedAncestorId(inspection, element, retainedIds) {
  let parentIndex = element.parentElementIndex;
  while (Number.isInteger(parentIndex)) {
    const parent = inspection.elements[parentIndex];
    if (!parent) return null;
    if (retainedIds.has(parent.stemmioId)) return parent.stemmioId;
    parentIndex = parent.parentElementIndex;
  }
  return null;
}

function identityBindingIssues(currentIdentity, nextIdentity) {
  const retainedIds = currentIdentity.claimedIds;
  const currentById = identityElementMap(currentIdentity);
  const nextById = identityElementMap(nextIdentity);
  const issues = [];
  for (const stemmioId of retainedIds) {
    const current = currentById.get(stemmioId);
    const next = nextById.get(stemmioId);
    if (!current || !next) continue;
    if (current.tagName !== next.tagName) {
      issues.push({
        code: "STEMMIO_ID_TAG_CHANGED",
        stemmioId,
        currentTagName: current.tagName,
        nextTagName: next.tagName,
      });
    }
    const currentParentId = nearestRetainedAncestorId(
      currentIdentity,
      current,
      retainedIds,
    );
    const nextParentId = nearestRetainedAncestorId(nextIdentity, next, retainedIds);
    if (currentParentId !== nextParentId) {
      issues.push({
        code: "STEMMIO_ID_PARENT_CHANGED",
        stemmioId,
        currentParentId,
        nextParentId,
      });
    }
  }
  const currentOrder = currentIdentity.elements.map((element) => element.stemmioId);
  const nextOrder = nextIdentity.elements
    .map((element) => element.stemmioId)
    .filter((stemmioId) => retainedIds.has(stemmioId));
  for (let index = 0; index < currentOrder.length; index += 1) {
    if (currentOrder[index] === nextOrder[index]) continue;
    issues.push({
      code: "STEMMIO_ID_SOURCE_ORDER_CHANGED",
      sourceOrder: index,
      currentStemmioId: currentOrder[index] ?? null,
      nextStemmioId: nextOrder[index] ?? null,
    });
  }
  return issues;
}

function semanticIdentitySnapshot(html, inspection) {
  return createSemanticIdentitySnapshot({
    sourceSha256: sha256(Buffer.from(html, "utf8")),
    elements: inspection.elements.map((element) => {
      const parent = Number.isInteger(element.parentElementIndex)
        ? inspection.elements[element.parentElementIndex]
        : null;
      return {
        elementId: element.stemmioId,
        tagName: element.tagName,
        parentElementId: parent?.stemmioId ?? null,
        outerHtmlSha256: sha256(Buffer.from(
          html.slice(element.startOffset, element.sourceEndOffset),
          "utf8",
        )),
      };
    }),
  });
}

function semanticAuthorizationError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SemanticIdentityAuthorizationError";
  error.code = code;
  error.details = details;
  return error;
}

function kernelIdentityFreeSubtreeHtml(
  html,
  inspection,
  rootElementId,
  expectedElementIds,
  operationHtml,
) {
  const byId = identityElementMap(inspection);
  const root = byId.get(rootElementId);
  if (!root) {
    throw semanticAuthorizationError(
      "SEMANTIC_IDENTITY_MATERIALIZATION_ROOT_MISSING",
      "The kernel-materialized structural root is absent from semantic result HTML.",
      { rootElementId },
    );
  }
  const subtree = inspection.elements.filter((element) => (
    element.startOffset >= root.startOffset
    && element.sourceEndOffset <= root.sourceEndOffset
  ));
  const actualElementIds = new Set(subtree.map((element) => element.stemmioId));
  if (
    actualElementIds.size !== expectedElementIds.size
    || [...actualElementIds].some((elementId) => !expectedElementIds.has(elementId))
  ) {
    throw semanticAuthorizationError(
      "SEMANTIC_IDENTITY_MATERIALIZATION_SET_MISMATCH",
      "The materialized structural subtree does not contain the kernel allocation set.",
      {
        rootElementId,
        actualElementIds: [...actualElementIds],
        expectedElementIds: [...expectedElementIds],
      },
    );
  }
  const leadingWhitespace = operationHtml.match(/^\s*/u)?.[0] ?? "";
  const trailingWhitespace = operationHtml.match(/\s*$/u)?.[0] ?? "";
  const fragmentStartOffset = root.startOffset - leadingWhitespace.length;
  const fragmentEndOffset = root.sourceEndOffset + trailingWhitespace.length;
  if (
    fragmentStartOffset < 0
    || fragmentEndOffset > html.length
    || html.slice(fragmentStartOffset, root.startOffset) !== leadingWhitespace
    || html.slice(root.sourceEndOffset, fragmentEndOffset) !== trailingWhitespace
  ) {
    throw semanticAuthorizationError(
      "SEMANTIC_IDENTITY_MATERIALIZATION_WHITESPACE_MISMATCH",
      "The materialized structural subtree does not preserve allowed operation.html outer whitespace.",
      { rootElementId },
    );
  }
  const removals = subtree.map((element) => {
    const injected = ` ${STEMMIO_ELEMENT_ID_ATTRIBUTE}="${element.stemmioId}"`;
    const endOffset = element.closingDelimiterOffset;
    const startOffset = endOffset - injected.length;
    if (
      startOffset < element.startOffset
      || html.slice(startOffset, endOffset) !== injected
    ) {
      throw semanticAuthorizationError(
        "SEMANTIC_IDENTITY_MATERIALIZATION_ATTRIBUTE_MISMATCH",
        "A structural identity was not materialized in the kernel-owned form.",
        { elementId: element.stemmioId },
      );
    }
    return { startOffset, endOffset };
  }).sort((left, right) => right.startOffset - left.startOffset);
  const materializedHtml = html.slice(fragmentStartOffset, fragmentEndOffset);
  let identityFreeHtml = materializedHtml;
  for (const removal of removals) {
    const startOffset = removal.startOffset - fragmentStartOffset;
    const endOffset = removal.endOffset - fragmentStartOffset;
    identityFreeHtml = `${identityFreeHtml.slice(0, startOffset)}${identityFreeHtml.slice(endOffset)}`;
  }
  return { identityFreeHtml, materializedHtml };
}

function assertKernelStructuralMaterialization({
  beforeIdentity,
  afterIdentity,
  beforeHtml,
  afterHtml,
  operation,
  direction,
}) {
  if (!["insertElement", "replaceSubtree"].includes(operation.type)) return null;
  const forwardBeforeIdentity = direction === "undo" ? afterIdentity : beforeIdentity;
  const forwardAfterIdentity = direction === "undo" ? beforeIdentity : afterIdentity;
  const forwardAfterHtml = direction === "undo" ? beforeHtml : afterHtml;
  const forwardAddedIds = new Set(
    [...forwardAfterIdentity.claimedIds].filter(
      (elementId) => !forwardBeforeIdentity.claimedIds.has(elementId),
    ),
  );
  const forwardAfterById = identityElementMap(forwardAfterIdentity);
  let rootElementId;
  let expectedElementIds;
  if (operation.type === "insertElement") {
    const roots = [...forwardAddedIds].filter((elementId) => {
      const element = forwardAfterById.get(elementId);
      const parent = Number.isInteger(element?.parentElementIndex)
        ? forwardAfterIdentity.elements[element.parentElementIndex]
        : null;
      return !forwardAddedIds.has(parent?.stemmioId);
    });
    if (roots.length !== 1) {
      throw semanticAuthorizationError(
        "SEMANTIC_IDENTITY_MATERIALIZATION_ROOT_MISMATCH",
        "insertElement does not have one kernel-materialized added root.",
        { roots },
      );
    }
    [rootElementId] = roots;
    expectedElementIds = forwardAddedIds;
  } else {
    rootElementId = operation.target.elementId;
    expectedElementIds = new Set([rootElementId, ...forwardAddedIds]);
  }
  const materialization = kernelIdentityFreeSubtreeHtml(
    forwardAfterHtml,
    forwardAfterIdentity,
    rootElementId,
    expectedElementIds,
    operation.html,
  );
  if (materialization.identityFreeHtml !== operation.html) {
    throw semanticAuthorizationError(
      "SEMANTIC_IDENTITY_MATERIALIZATION_MISMATCH",
      "The saved structural subtree is not the kernel materialization of operation.html.",
      {
        operationType: operation.type,
        rootElementId,
        operationHtmlSha256: sha256(Buffer.from(operation.html, "utf8")),
        materializedIdentityFreeSha256: sha256(Buffer.from(
          materialization.identityFreeHtml,
          "utf8",
        )),
      },
    );
  }
  return materialization.materializedHtml;
}

function identityTransitionFacts(beforeIdentity, afterIdentity) {
  const lostIds = [...beforeIdentity.claimedIds].filter(
    (stemmioId) => !afterIdentity.claimedIds.has(stemmioId),
  );
  const addedIds = [...afterIdentity.claimedIds].filter(
    (stemmioId) => !beforeIdentity.claimedIds.has(stemmioId),
  );
  const bindingIssues = identityBindingIssues(beforeIdentity, afterIdentity);
  return {
    lostIds,
    addedIds,
    bindingIssues,
    changed: lostIds.length > 0 || addedIds.length > 0 || bindingIssues.length > 0,
  };
}

function assertBindingChangesAreAuthorized(currentHtml, nextHtml, sourceHistoryOperations) {
  let steps;
  try {
    steps = validateSourceHistoryOperationBytes(
      sourceHistoryOperations,
      currentHtml,
      nextHtml,
      (value) => sha256(Buffer.from(value, "utf8")),
    );
  } catch (cause) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save's source operation evidence does not reproduce its HTML.",
      { sourceHistoryError: cause?.code || "SOURCE_HISTORY_INVALID" },
    );
  }
  for (const step of steps) {
    const beforeIdentity = inspectSourceElementIdentity(step.beforeHtml);
    const afterIdentity = inspectSourceElementIdentity(step.afterHtml);
    if (!beforeIdentity.complete || !afterIdentity.complete) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "A source operation would create an incomplete identity set.",
        {
          operationId: step.operation.operationId,
          beforeStatus: beforeIdentity.status,
          afterStatus: afterIdentity.status,
        },
      );
    }
    const transition = identityTransitionFacts(beforeIdentity, afterIdentity);
    const semanticOperation = step.operation.semanticOperation;
    const identityDelta = step.operation.identityDelta;
    const semanticDirection = String(step.operation.semanticDirection || "");
    if (!semanticOperation || !identityDelta || !["forward", "undo", "redo"].includes(semanticDirection)) {
      if (!transition.changed) continue;
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "The save changes persistent identity without semantic operation evidence.",
        { operationId: step.operation.operationId, ...transition },
      );
    }
    try {
      verifySemanticIdentityTransition({
        beforeSnapshot: semanticIdentitySnapshot(step.beforeHtml, beforeIdentity),
        afterSnapshot: semanticIdentitySnapshot(step.afterHtml, afterIdentity),
        operation: semanticOperation,
        direction: semanticDirection,
        identityDelta,
      });
      const materializedFragmentHtml = assertKernelStructuralMaterialization({
        beforeIdentity,
        afterIdentity,
        beforeHtml: step.beforeHtml,
        afterHtml: step.afterHtml,
        operation: semanticOperation,
        direction: semanticDirection,
      });
      assertKernelStructurePatchMaterialization({
        step,
        beforeIdentity,
        afterIdentity,
        operation: semanticOperation,
        direction: semanticDirection,
        materializedFragmentHtml,
      });
      assertKernelTextMaterialization({
        step,
        beforeIdentity,
        afterIdentity,
        operation: semanticOperation,
        direction: semanticDirection,
      });
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "Semantic operation evidence does not authorize the exact identity transition.",
        {
          operationId: step.operation.operationId,
          semanticIdentityError: cause?.code || "SEMANTIC_IDENTITY_INVALID",
          semanticIdentityDetails: cause?.details || {},
          ...transition,
        },
      );
    }
  }
}

function assertMaterializedHtmlWithinLimit(buffer) {
  if (buffer.byteLength > MAX_HTML_BYTES) {
    throw new ProjectFileRepositoryError(
      "SOURCE_TOO_LARGE",
      "The identity-materialized Working Copy is too large.",
      {
        byteLength: buffer.byteLength,
        maxByteLength: MAX_HTML_BYTES,
      },
    );
  }
  return buffer;
}

export function materializeSourceElementIdentity(html, {
  randomUUIDFactory = randomUUID,
} = {}) {
  const source = String(html);
  const inspection = inspectSourceElementIdentity(source);
  if (!inspection.valid) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_INVALID",
      "The Working Copy contains malformed or duplicated Stemmio element identities.",
      { issues: inspection.issues },
    );
  }
  if (inspection.complete) {
    const buffer = assertMaterializedHtmlWithinLimit(Buffer.from(source, "utf8"));
    return {
      html: source,
      buffer,
      changed: false,
      addedElementCount: 0,
      identity: inspection,
    };
  }

  const allocated = new Set(inspection.claimedIds);
  const insertions = inspection.missing.map((element) => {
    let stemmioId = null;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = generateStemmioElementId(randomUUIDFactory);
      if (!allocated.has(candidate)) {
        stemmioId = candidate;
        allocated.add(candidate);
        break;
      }
    }
    if (!stemmioId) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_ALLOCATION_FAILED",
        "A unique Stemmio element identity could not be allocated.",
      );
    }
    return {
      offset: element.closingDelimiterOffset,
      value: ` ${STEMMIO_ELEMENT_ID_ATTRIBUTE}="${stemmioId}"`,
    };
  }).sort((left, right) => right.offset - left.offset);

  let nextHtml = source;
  for (const insertion of insertions) {
    nextHtml = nextHtml.slice(0, insertion.offset)
      + insertion.value
      + nextHtml.slice(insertion.offset);
  }
  const nextIdentity = inspectSourceElementIdentity(nextHtml);
  if (!nextIdentity.complete) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_MATERIALIZATION_FAILED",
      "The materialized Working Copy does not have a complete identity set.",
      { issues: nextIdentity.issues },
    );
  }
  const buffer = assertMaterializedHtmlWithinLimit(Buffer.from(nextHtml, "utf8"));
  return {
    html: nextHtml,
    buffer,
    changed: true,
    addedElementCount: insertions.length,
    identity: nextIdentity,
  };
}

export function materializeIdentityPreservingSave(currentHtml, nextHtml, options = {}) {
  const currentIdentity = inspectSourceElementIdentity(currentHtml);
  if (!currentIdentity.complete) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The current Working Copy lost or corrupted its persistent source element identities.",
      { issues: currentIdentity.issues },
    );
  }
  const nextIdentity = inspectSourceElementIdentity(nextHtml);
  if (!nextIdentity.valid) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save would corrupt persistent source element identities.",
      { issues: nextIdentity.issues },
    );
  }
  const lostIds = [...currentIdentity.claimedIds].filter(
    (stemmioId) => !nextIdentity.claimedIds.has(stemmioId),
  );
  const addedIds = [...nextIdentity.claimedIds].filter(
    (stemmioId) => !currentIdentity.claimedIds.has(stemmioId),
  );
  if (nextIdentity.missingElementCount > 0) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save would publish source elements without persistent identity.",
      {
        lostIds,
        missingElementCount: nextIdentity.missingElementCount,
        missingElements: nextIdentity.missing.map((element) => ({
          tagName: element.tagName,
          startOffset: element.startOffset,
        })),
      },
    );
  }
  const bindingIssues = identityBindingIssues(currentIdentity, nextIdentity);
  const sourceHistoryOperations = Array.isArray(options.sourceHistoryOperations)
    ? options.sourceHistoryOperations
    : [];
  if (
    lostIds.length > 0
    || bindingIssues.length > 0
    || addedIds.length > 0
    || sourceHistoryOperations.length > 0
  ) {
    if (sourceHistoryOperations.length === 0) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "The save would change persistent identity bindings without source operation evidence.",
        { lostIds, addedIds, bindingIssues },
      );
    }
    assertBindingChangesAreAuthorized(currentHtml, nextHtml, sourceHistoryOperations);
  }
  return materializeSourceElementIdentity(nextHtml, options);
}

export function sourceElementIdentityMigrationRecoveryPaths(
  paths,
  workingCopyIdValue,
  identitySchemaVersion,
  recoveryId,
) {
  const workingCopy = assertId(workingCopyIdValue, WORKING_COPY_ID, "workingCopyId");
  if (identitySchemaVersion !== STEMMIO_ELEMENT_ID_SCHEMA_VERSION) {
    throw new ProjectFileRepositoryError(
      "IDENTITY_MIGRATION_INVALID",
      "The source element identity migration schema is unsupported.",
    );
  }
  const id = String(recoveryId || "");
  const prefix = `identity_${workingCopy}_v${identitySchemaVersion}_`;
  if (
    !SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID.test(id)
    || !id.startsWith(prefix)
  ) {
    throw new ProjectFileRepositoryError(
      "IDENTITY_MIGRATION_INVALID",
      "The source element identity recovery location is invalid.",
    );
  }
  const operationRoot = path.join(paths.recoveryRoot, id);
  if (!pathInside(paths.recoveryRoot, operationRoot)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "The source element identity recovery location escapes recovery/.",
    );
  }
  return {
    operationRoot,
    previousPath: path.join(operationRoot, "previous.html"),
    nextPath: path.join(operationRoot, "next.html"),
  };
}

export function saveRecoveryPaths(paths, workingCopyIdValue, revision, recoveryId) {
  const normalizedRevision = Number.isSafeInteger(Number(revision)) && Number(revision) >= 0
    ? Number(revision)
    : 0;
  const id = String(recoveryId || "");
  const prefix = `save_${assertId(workingCopyIdValue, WORKING_COPY_ID, "workingCopyId")}_${normalizedRevision || "current"}_`;
  if (!SAVE_RECOVERY_ID.test(id) || !id.startsWith(prefix)) {
    throw new ProjectFileRepositoryError(
      "SAVE_TRANSACTION_INVALID",
      "The Working Copy save recovery location is invalid.",
    );
  }
  const operationRoot = path.join(paths.recoveryRoot, id);
  if (!pathInside(paths.recoveryRoot, operationRoot)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "The Working Copy save recovery location escapes recovery/.",
    );
  }
  return {
    operationRoot,
    previousPath: path.join(operationRoot, "previous.html"),
    nextPath: path.join(operationRoot, "next.html"),
  };
}

export async function compareAndSwapWorkingCopyFile({
  sourcePath, nextBuffer, expectedSha256, nextSha256, projectRootPath,
  expectedInformation = null, previousPath = null, preparedBindingPath = null,
  beforeCommit = null, beforePublication = null, afterDisplacement = null,
}) {
  const parent = path.dirname(sourcePath);
  await assertRealPathInsideProject(projectRootPath, parent, "Working Copy parent", { expectedKind: "directory" });
  const temporary = path.join(parent, nonReplaceTemporaryName(`save-${process.pid}-${randomUUID()}.tmp`));
  await atomicWriteFile(temporary, nextBuffer);
  let swapped = false;
  try {
    if (preparedBindingPath) {
      await assertRealPathInsideProject(projectRootPath, preparedBindingPath, "prepared source binding");
      try { await link(temporary, preparedBindingPath); }
      catch (cause) {
        if (!["ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS", "EPERM"].includes(cause?.code)) throw cause;
      }
      await syncDirectory(path.dirname(preparedBindingPath));
    }
    await beforeCommit?.();
    let current;
    try { current = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath }); }
    catch (cause) {
      if (cause?.code === "ENOENT" || cause?.code === "SOURCE_NOT_FOUND") return { swapped: false, actualSha256: null, written: null };
      throw cause;
    }
    if (current.sha256 !== expectedSha256) return { swapped: false, actualSha256: current.sha256, written: null };
    if (expectedInformation && !sameFileIdentity(copyFileIdentity(expectedInformation), copyFileIdentity(current.information))) {
      throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "工作文件在保存操作中被替换，未覆盖磁盘。");
    }
    const verified = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath });
    if (verified.sha256 !== expectedSha256
      || !sameFileIdentity(copyFileIdentity(current.information), copyFileIdentity(verified.information))) {
      return { swapped: false, actualSha256: verified.sha256, written: null };
    }
    await beforePublication?.();
    if (previousPath) {
      await assertRealPathInsideProject(projectRootPath, previousPath, "previous Working Copy");
      if (await regularInformation(previousPath, "previous Working Copy", { projectRootPath })) {
        throw new ProjectFileRepositoryError("SAVE_RECOVERY_CONFLICT", "The save recovery path is already occupied.");
      }
      // Capture the object actually displaced by the syscall. A final lstat
      // followed by overwrite-rename cannot protect an uncooperative writer.
      await rename(sourcePath, previousPath);
      await syncDirectory(parent);
      await syncDirectory(path.dirname(previousPath));
      await afterDisplacement?.();
      let parked;
      try { parked = await readHtmlFile(previousPath, "previous Working Copy", { projectRootPath }); }
      catch (cause) {
        // Never follow a swapped symlink, and never delete the displaced entry.
        throw new ProjectFileRepositoryError("SAVE_RECOVERY_CONFLICT", "保存期间文件被替换，移出的文件已保留。", { cause: cause?.code || null });
      }
      if (parked.sha256 !== expectedSha256
        || !sameFileIdentity(copyFileIdentity(verified.information), copyFileIdentity(parked.information))) {
        // Restore only into the still-empty name. If another writer already
        // published there, both its bytes and the displaced bytes survive.
        await link(previousPath, sourcePath).catch((cause) => { if (cause?.code !== "EEXIST") throw cause; });
        await syncDirectory(parent);
        throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "工作文件在提交时发生外部变化，未覆盖磁盘。");
      }
      try { await link(temporary, sourcePath); }
      catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
        throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "其他程序已写入工作文件，未覆盖磁盘。");
      }
      await unlink(temporary);
    } else {
      // Current force-unlock identity adoption already owns complete
      // before/after recovery bytes and uses its existing publication path.
      await rename(temporary, sourcePath);
    }
    swapped = true;
    await syncDirectory(parent);
    const written = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath });
    if (written.sha256 !== nextSha256) {
      throw new ProjectFileRepositoryError("SOURCE_HASH_CONFLICT", "The Working Copy changed while Stemmio was verifying its save.", { expectedSourceSha256: nextSha256, actualSourceSha256: written.sha256 });
    }
    if (previousPath) {
      const previous = await readHtmlFile(previousPath, "previous Working Copy", { projectRootPath });
      if (previous.sha256 !== expectedSha256) {
        throw new ProjectFileRepositoryError("SAVE_RECOVERY_CONFLICT", "外部程序修改了保存前的文件，已保留两份内容供恢复。");
      }
    }
    return { swapped: true, actualSha256: written.sha256, written };
  } finally {
    if (!swapped) await rm(temporary, { force: true }).catch(() => {});
  }
}

export function workingCopyStatePath(paths, workingCopy) {
  const relative = ensureRelativePath(workingCopy.stateRelativePath, "stateRelativePath");
  const resolved = resolveRelative(paths.controlRoot, relative, "stateRelativePath");
  if (!pathInside(paths.workingCopiesRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Working Copy state must stay inside working-copies/.",
    );
  }
  return resolved;
}

export function draftRelativePathFor(workingCopy) {
  return `drafts/${workingCopy.workingCopyId}.json`;
}

function validForceUnlockReceipt(receipt) {
  if (receipt === undefined) return true;
  if (
    !isObject(receipt)
    || !["pending", "completed", "superseded"].includes(receipt.status)
    || !SAFE_OPERATION_ID.test(String(receipt.operationId || ""))
    || !SHA256.test(String(receipt.expectedSourceSha256 || ""))
    || !SHA256.test(String(receipt.acceptedSourceSha256 || ""))
    || receipt.expectedSourceSha256 !== receipt.acceptedSourceSha256
  ) return false;
  if (receipt.status === "pending") {
    return validStateTimestamp(receipt.preparedAt);
  }
  return SHA256.test(String(receipt.sourceSha256 || ""))
    && validStateTimestamp(receipt.completedAt);
}

export function assertWorkingCopyState(
  state,
  loaded,
  workingCopy,
  { allowMissingIdentityBinding = false } = {},
) {
  const expectedDraftRelativePath = draftRelativePathFor(workingCopy);
  const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
  const basedOnVersion = loaded.manifest.versions.find(
    (version) => version.versionId === workingCopy.basedOnVersionId,
  );
  if (
    !isObject(state)
    || state.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || state.projectId !== loaded.project.projectId
    || state.documentId !== loaded.project.documentId
    || state.workingCopyId !== workingCopy.workingCopyId
    || state.basedOnVersionId !== workingCopy.basedOnVersionId
    || !basedOnVersion
    || !SHA256.test(String(state.baseSha256 || ""))
    || state.baseSha256 !== basedOnVersion.contentSha256
    || !SHA256.test(String(state.currentSha256 || ""))
    || typeof state.differsFromBase !== "boolean"
    || state.differsFromBase !== (state.currentSha256 !== state.baseSha256)
    || state.draftId !== `draft_${workingCopy.workingCopyId}`
    || state.draftRelativePath !== expectedDraftRelativePath
    || (state.draftSha256 !== null && !SHA256.test(String(state.draftSha256 || "")))
    || !validRevision(state.draftRevision)
    || (state.snapshotBaselineSha256 !== undefined && !SHA256.test(String(state.snapshotBaselineSha256)))
    || !WORKING_COPY_SAVE_STATES.has(state.saveState)
    || !validRevision(state.lastPersistedRevision)
    || !validStateTimestamp(state.lastSavedAt)
    || !validStateTimestamp(state.lastOpenedAt)
    || !validForceUnlockReceipt(state.forceUnlockReceipt)
    || (
      state.sourceElementIdentitySchemaVersion !== undefined
      && state.sourceElementIdentitySchemaVersion !== STEMMIO_ELEMENT_ID_SCHEMA_VERSION
    )
    || (
      state.sourceElementIdentitySchemaVersion === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
      && (
        !allowMissingIdentityBinding
        || state.sourceElementIdentityBindingSha256 !== undefined
      )
      && !SHA256.test(String(state.sourceElementIdentityBindingSha256 || ""))
    )
    || (
      state.sourceElementIdentitySchemaVersion === undefined
      && state.sourceElementIdentityBindingSha256 !== undefined
    )
  ) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_STATE_INVALID",
      "The Working Copy state does not match its immutable project authority.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  return state;
}

export function workingCopySourcePath(paths, workingCopy) {
  const relative = topLevelHtmlRelativePath(
    workingCopy.sourceRelativePath,
    "sourceRelativePath",
  );
  const resolved = resolveRelative(paths.projectRootPath, relative, "sourceRelativePath");
  if (pathInside(paths.controlRoot, resolved, { allowRoot: true })) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "A visible Working Copy cannot be inside .stemmio.",
    );
  }
  return resolved;
}

export function publicOpenTarget({
  project,
  projectRootPath,
  targetKind,
  workingCopy = null,
  version = null,
  exactSourcePath,
  sourceSha256,
}) {
  return Object.freeze({
    projectId: project.projectId,
    documentId: project.documentId,
    projectRootPath,
    targetKind,
    workingCopyId: workingCopy?.workingCopyId || null,
    versionId: version?.versionId || workingCopy?.versionId || null,
    exactSourcePath,
    sourceSha256,
  });
}
