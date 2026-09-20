const STRUCTURAL_TYPES = new Set([
  "insertElement",
  "deleteElement",
  "moveElement",
  "replaceSubtree",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SemanticStructurePlanError";
  error.code = code;
  error.details = details;
  throw error;
}

function operationElementId(operation, field) {
  const directName = `${field}ElementId`;
  const value = operation?.[directName] ?? operation?.[field]?.elementId ?? null;
  return value ? String(value) : null;
}

function structuralType(operation) {
  return String(operation?.semanticType ?? operation?.type ?? "");
}

function normalizedElements(source, elements) {
  const result = (Array.isArray(elements) ? elements : []).map((element) => ({
    elementId: String(element?.elementId ?? element?.stemmioId ?? ""),
    tagName: String(element?.tagName ?? "").toLowerCase(),
    parentElementId: element?.parentElementId
      ? String(element.parentElementId)
      : null,
    startOffset: Number(element?.startOffset),
    endOffset: Number(element?.endOffset ?? element?.sourceEndOffset),
    contentStartOffset: Number(element?.contentStartOffset),
    contentEndOffset: Number(element?.contentEndOffset),
    explicitEndTag: element?.explicitEndTag === true,
    isVoid: element?.isVoid === true,
    selfClosing: element?.selfClosing === true,
    boundarySafe: element?.boundarySafe === true,
  }));
  const ids = new Set();
  for (const element of result) {
    if (
      !element.elementId
      || ids.has(element.elementId)
      || !Number.isInteger(element.startOffset)
      || !Number.isInteger(element.endOffset)
      || element.startOffset < 0
      || element.endOffset < element.startOffset
      || element.endOffset > source.length
    ) {
      fail(
        "SEMANTIC_STRUCTURE_INDEX_INVALID",
        "The semantic structure source index is incomplete or ambiguous.",
        { elementId: element.elementId || null },
      );
    }
    ids.add(element.elementId);
  }
  return result;
}

function exactElement(byId, elementId, field) {
  const element = elementId ? byId.get(elementId) : null;
  if (!element) {
    fail(
      "SEMANTIC_STRUCTURE_TARGET_MISSING",
      `The semantic ${field} element is absent from the exact source.`,
      { field, elementId },
    );
  }
  return element;
}

function sourcePatch(startOffset, endOffset, source, after, kind, details = {}) {
  return {
    startOffset,
    endOffset,
    before: source.slice(startOffset, endOffset),
    after,
    kind,
    ...details,
  };
}

function canonicalPatches(patches) {
  return [...patches].sort((left, right) => (
    left.startOffset - right.startOffset
    || left.endOffset - right.endOffset
  ));
}

function insertionPoint(byId, operation) {
  const parentElementId = operationElementId(operation, "parent");
  const beforeElementId = operationElementId(operation, "before");
  const parent = exactElement(byId, parentElementId, "parent");
  if (
    parent.isVoid
    || !Number.isInteger(parent.contentEndOffset)
    || parent.contentEndOffset < parent.startOffset
    || parent.contentEndOffset > parent.endOffset
  ) {
    fail(
      "SEMANTIC_STRUCTURE_PARENT_BOUNDARY_INVALID",
      "The semantic structure parent has no exact insertion boundary.",
      { parentElementId },
    );
  }
  const before = beforeElementId
    ? exactElement(byId, beforeElementId, "before")
    : null;
  if (before && before.parentElementId !== parent.elementId) {
    fail(
      "SEMANTIC_STRUCTURE_INSERTION_PARENT_MISMATCH",
      "The semantic before element is not a direct child of its parent.",
      { parentElementId, beforeElementId },
    );
  }
  return {
    parent,
    before,
    offset: before?.startOffset ?? parent.contentEndOffset,
  };
}

function gapContainsOnlyWhitespaceAndComments(gap) {
  let cursor = 0;
  let remaining = "";
  while (cursor < gap.length) {
    const commentStart = gap.indexOf("<!--", cursor);
    if (commentStart < 0) {
      remaining += gap.slice(cursor);
      break;
    }
    remaining += gap.slice(cursor, commentStart);
    const commentEnd = gap.indexOf("-->", commentStart + 4);
    if (commentEnd < 0) return false;
    cursor = commentEnd + 3;
  }
  return remaining.trim() === "";
}

function gapBoundary(source, previousElement, nextElement) {
  const startOffset = previousElement.endOffset;
  const endOffset = nextElement.startOffset;
  const gap = source.slice(startOffset, endOffset);
  if (!gap.includes("<!--")) return startOffset;
  const firstComment = gap.indexOf("<!--");
  const beforeComment = gap.slice(0, firstComment);
  if (beforeComment === "") return endOffset;
  if (/\r|\n/u.test(beforeComment)) return startOffset;
  fail(
    "SEMANTIC_STRUCTURE_REORDER_BOUNDARY_INVALID",
    "A comment between sibling elements has ambiguous ownership.",
    { startOffset, endOffset },
  );
}

function trailingCommentBoundary(source, parent, lastElement) {
  const startOffset = lastElement.endOffset;
  const endOffset = parent.contentEndOffset;
  const gap = source.slice(startOffset, endOffset);
  if (!gap.includes("<!--")) return startOffset;
  if (!gap.startsWith("<!--")) {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_BOUNDARY_INVALID",
      "A trailing comment has ambiguous sibling ownership.",
      { startOffset, endOffset },
    );
  }
  let cursor = 0;
  let commentCount = 0;
  while (gap.startsWith("<!--", cursor)) {
    const commentEnd = gap.indexOf("-->", cursor + 4);
    if (commentEnd < 0) {
      fail(
        "SEMANTIC_STRUCTURE_REORDER_BOUNDARY_INVALID",
        "A trailing sibling comment has no complete source boundary.",
        { startOffset, endOffset },
      );
    }
    cursor = commentEnd + 3;
    commentCount += 1;
  }
  const remaining = gap.slice(cursor);
  if (remaining.includes("<!--") || remaining.trim() !== "") {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_BOUNDARY_INVALID",
      "A trailing sibling comment has ambiguous ownership.",
      { startOffset, endOffset },
    );
  }
  return commentCount > 0 ? startOffset + cursor : startOffset;
}

function siblingReorderPlan(source, elements, target, insertion, operation) {
  const parent = insertion.parent;
  if (!parent.boundarySafe || !parent.explicitEndTag) {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_BOUNDARY_INVALID",
      "The reorder parent has no explicit source boundary.",
      { parentElementId: parent.elementId },
    );
  }
  const siblings = elements
    .filter((element) => element.parentElementId === parent.elementId)
    .sort((left, right) => left.startOffset - right.startOffset);
  if (siblings.length < 2) {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_SIBLINGS_REQUIRED",
      "A same-parent move requires reorderable sibling elements.",
    );
  }
  const unsafeSibling = siblings.find((element) => (
    !element.explicitEndTag
    && !element.isVoid
    && !element.selfClosing
  ));
  if (unsafeSibling) {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_SIBLING_BOUNDARY_INVALID",
      "A same-parent move cannot reorder a sibling with an implicit source boundary.",
      {
        parentElementId: parent.elementId,
        siblingElementId: unsafeSibling.elementId,
      },
    );
  }
  const gaps = [];
  let gapStart = parent.contentStartOffset;
  for (const sibling of siblings) {
    gaps.push(source.slice(gapStart, sibling.startOffset));
    gapStart = sibling.endOffset;
  }
  gaps.push(source.slice(gapStart, parent.contentEndOffset));
  if (gaps.some((gap) => !gapContainsOnlyWhitespaceAndComments(gap))) {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_BOUNDARY_INVALID",
      "Sibling reordering cannot cross authored non-element content.",
      { parentElementId: parent.elementId },
    );
  }
  const oldOrder = siblings.map((element) => element.elementId);
  const movingIndex = oldOrder.indexOf(target.elementId);
  const remaining = oldOrder.filter((elementId) => elementId !== target.elementId);
  const insertionIndex = insertion.before
    ? remaining.indexOf(insertion.before.elementId)
    : remaining.length;
  if (movingIndex < 0 || insertionIndex < 0) {
    fail(
      "SEMANTIC_STRUCTURE_REORDER_TARGET_INVALID",
      "The requested same-parent move cannot be placed among its exact siblings.",
    );
  }
  const nextOrder = [...remaining];
  nextOrder.splice(insertionIndex, 0, target.elementId);
  let firstChanged = -1;
  let lastChanged = -1;
  for (let index = 0; index < oldOrder.length; index += 1) {
    if (oldOrder[index] === nextOrder[index]) continue;
    if (firstChanged < 0) firstChanged = index;
    lastChanged = index;
  }
  if (firstChanged < 0) {
    return { patches: [], beforeOrder: oldOrder, nextOrder };
  }
  if (gaps.some((gap) => gap.includes("<!--"))) {
    const boundaries = [];
    for (let index = 0; index < siblings.length - 1; index += 1) {
      boundaries.push(gapBoundary(source, siblings[index], siblings[index + 1]));
    }
    const trailingBoundary = trailingCommentBoundary(source, parent, siblings.at(-1));
    const units = siblings.map((element, position) => {
      const startOffset = position === 0
        ? parent.contentStartOffset
        : boundaries[position - 1];
      const endOffset = position === siblings.length - 1
        ? trailingBoundary
        : boundaries[position];
      return {
        elementId: element.elementId,
        startOffset,
        endOffset,
        raw: source.slice(startOffset, endOffset),
      };
    });
    const byElementId = new Map(units.map((unit) => [unit.elementId, unit]));
    const movingUnit = byElementId.get(target.elementId);
    const ownedPrefix = source.slice(movingUnit.startOffset, target.startOffset);
    const ownedSuffix = source.slice(target.endOffset, movingUnit.endOffset);
    if (
      operation?.preserveSourceGaps === true
      && !ownedPrefix.includes("<!--")
      && !ownedSuffix.includes("<!--")
    ) {
      const raw = source.slice(target.startOffset, target.endOffset);
      const insertionOffset = insertion.before
        ? byElementId.get(insertion.before.elementId).startOffset
        : insertion.offset;
      return {
        // A comment owned by another sibling stays at its exact source gap.
        // Move only the target bytes, but insert before the destination's
        // owned prefix so duplicate -> move -> delete remains byte-exact.
        patches: canonicalPatches([
          sourcePatch(
            target.startOffset,
            target.endOffset,
            source,
            "",
            "sibling-reorder",
          ),
          sourcePatch(
            insertionOffset,
            insertionOffset,
            source,
            raw,
            "sibling-reorder",
          ),
        ]),
        beforeOrder: oldOrder,
        nextOrder,
      };
    }
    const startOffset = units[firstChanged].startOffset;
    const endOffset = units[lastChanged].endOffset;
    return {
      patches: [sourcePatch(
        startOffset,
        endOffset,
        source,
        nextOrder
          .slice(firstChanged, lastChanged + 1)
          .map((elementId) => byElementId.get(elementId).raw)
          .join(""),
        "sibling-reorder",
      )],
      beforeOrder: oldOrder,
      nextOrder,
    };
  }
  const raw = source.slice(target.startOffset, target.endOffset);
  return {
    // With no authored comment owning a sibling gap, whitespace remains at its
    // existing source position instead of becoming part of the moved element.
    // Exact remove/insert patches let a later delete restore the pre-insert
    // source byte-for-byte.
    patches: canonicalPatches([
      sourcePatch(
        target.startOffset,
        target.endOffset,
        source,
        "",
        "sibling-reorder",
      ),
      sourcePatch(
        insertion.offset,
        insertion.offset,
        source,
        raw,
        "sibling-reorder",
      ),
    ]),
    beforeOrder: oldOrder,
    nextOrder,
  };
}

export function planSemanticStructurePatches({
  source: sourceValue,
  elements: elementValues,
  operation,
  fragmentHtml = null,
} = {}) {
  const source = String(sourceValue ?? "");
  const type = structuralType(operation);
  if (!STRUCTURAL_TYPES.has(type)) {
    fail(
      "SEMANTIC_STRUCTURE_OPERATION_UNSUPPORTED",
      "Only semantic structure operations can use the structure plan replayer.",
      { operationType: type || null },
    );
  }
  const elements = normalizedElements(source, elementValues);
  const byId = new Map(elements.map((element) => [element.elementId, element]));
  const targetElementId = operationElementId(operation, "target");
  const target = targetElementId
    ? exactElement(byId, targetElementId, "target")
    : null;

  if (type === "insertElement") {
    const insertion = insertionPoint(byId, operation);
    return {
      patches: [sourcePatch(
        insertion.offset,
        insertion.offset,
        source,
        String(fragmentHtml ?? ""),
        "semantic:insert-element",
      )],
      parentElementId: insertion.parent.elementId,
    };
  }
  if (type === "deleteElement") {
    if (!target?.parentElementId) {
      fail(
        "SEMANTIC_STRUCTURE_ROOT_UNSUPPORTED",
        "Only a source element with a parent can be deleted.",
      );
    }
    return {
      patches: [sourcePatch(
        target.startOffset,
        target.endOffset,
        source,
        "",
        "semantic:delete-element",
      )],
    };
  }
  if (type === "replaceSubtree") {
    return {
      patches: [sourcePatch(
        target.startOffset,
        target.endOffset,
        source,
        String(fragmentHtml ?? ""),
        "semantic:replace-subtree",
      )],
    };
  }

  if (!target?.parentElementId) {
    fail(
      "SEMANTIC_STRUCTURE_ROOT_UNSUPPORTED",
      "Only a source element with a parent can be moved.",
    );
  }
  const insertion = insertionPoint(byId, operation);
  if (insertion.before?.elementId === target.elementId) {
    fail(
      "SEMANTIC_STRUCTURE_MOVE_NOOP",
      "A semantic move cannot insert a target before itself.",
    );
  }
  if (target.parentElementId === insertion.parent.elementId) {
    return siblingReorderPlan(
      source,
      elements,
      target,
      insertion,
      operation,
    );
  }
  const raw = source.slice(target.startOffset, target.endOffset);
  return {
    patches: canonicalPatches([
      sourcePatch(
        target.startOffset,
        target.endOffset,
        source,
        "",
        "semantic:move-element:remove",
      ),
      sourcePatch(
        insertion.offset,
        insertion.offset,
        source,
        raw,
        "semantic:move-element:insert",
      ),
    ]),
    parentElementId: insertion.parent.elementId,
  };
}

export function inverseSemanticStructurePatches(patches) {
  let delta = 0;
  const inverse = [...(patches ?? [])]
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((patch) => {
      const startOffset = patch.startOffset + delta;
      const result = {
        startOffset,
        endOffset: startOffset + patch.after.length,
        before: patch.after,
        after: patch.before,
        kind: `inverse:${patch.kind ?? "source"}`,
      };
      delta += patch.after.length - patch.before.length;
      return result;
    });
  const coalesced = [];
  for (const patch of inverse) {
    const previous = coalesced.at(-1);
    if (previous && previous.startOffset === patch.startOffset) {
      previous.endOffset = Math.max(previous.endOffset, patch.endOffset);
      previous.before += patch.before;
      previous.after += patch.after;
      if (previous.kind !== patch.kind) previous.kind = "inverse:source";
      continue;
    }
    coalesced.push({ ...patch });
  }
  return coalesced;
}
