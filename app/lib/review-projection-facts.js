const FACT_TYPES = new Set(["text", "structure"]);
const FACT_SCOPES = new Set([
  "text",
  "text-phrase",
  "text-line",
  "text-block",
  "element",
]);
const FACT_DISPLAY_SCOPES = new Set([
  "paragraph",
  "list-item",
  "cell",
  "component",
  "container",
]);
const FACT_GEOMETRY_MODES = new Set([
  "text-content",
  "element-box",
  "container-box",
  "numbered-line-range",
]);
const FACT_OPERATIONS = new Set(["none", "insert", "delete", "replace"]);
const FACT_TONES = new Set(["added", "removed"]);
const FACT_STRUCTURE_CHANGES = new Set([
  "added",
  "removed",
  "moved",
  "reordered",
  "attribute",
  "style",
]);
const FACT_KEY_PATTERN = /^[a-z0-9:_-]{1,160}$/iu;
export const REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT = 24;
// Closed over the largest legal 24-fact JSON payload, including worst-case
// summary escaping. Runtime uses the same ceiling before parsing authored DOM.
export const REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT = 65_536;
export const REVIEW_EXACT_ATOM_OCCURRENCE_LIMIT = 4_096;
export const REVIEW_EXACT_ATOM_OCCURRENCE_SERIALIZED_LENGTH_LIMIT = 262_144;
const MAX_SUMMARY_LENGTH = 80;

export class ReviewProjectionFactOverflowError extends Error {
  constructor(limit = REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT) {
    super(`Review projection fact limit (${limit}) exceeded for one element.`);
    this.name = "ReviewProjectionFactOverflowError";
    this.code = "REVIEW_PROJECTION_FACTS_OVERFLOW";
  }
}

function optionalKey(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return FACT_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

function optionalSummary(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= MAX_SUMMARY_LENGTH ? normalized : undefined;
}

/**
 * Normalize one disposable review-projection fact. Facts are analysis output,
 * not authored-document authority: malformed values are discarded rather than
 * guessed or coerced into a visible frame.
 */
export function normalizeReviewProjectionFact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = optionalKey(value.id);
  const type = typeof value.type === "string" ? value.type : "";
  const semanticOwnerId = optionalKey(value.semanticOwnerId);
  if (!id || !FACT_TYPES.has(type) || !semanticOwnerId) return null;

  const fact = { id, type, semanticOwnerId };
  const geometryOwnerId = optionalKey(value.geometryOwnerId);
  const scope = typeof value.scope === "string" && FACT_SCOPES.has(value.scope)
    ? value.scope
    : undefined;
  const operation = typeof value.operation === "string" && FACT_OPERATIONS.has(value.operation)
    ? value.operation
    : undefined;
  const tone = typeof value.tone === "string" && FACT_TONES.has(value.tone)
    ? value.tone
    : undefined;
  const textGroup = optionalKey(value.textGroup);
  const displayGroupId = optionalKey(value.displayGroupId);
  const displayOwnerId = optionalKey(value.displayOwnerId);
  const displayScope = typeof value.displayScope === "string"
    && FACT_DISPLAY_SCOPES.has(value.displayScope)
    ? value.displayScope
    : undefined;
  const geometryMode = typeof value.geometryMode === "string"
    && FACT_GEOMETRY_MODES.has(value.geometryMode)
    ? value.geometryMode
    : undefined;
  const structureChange = typeof value.structureChange === "string"
    && FACT_STRUCTURE_CHANGES.has(value.structureChange)
    ? value.structureChange
    : undefined;
  const summary = optionalSummary(value.summary);

  if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
  if (scope) fact.scope = scope;
  if (operation) fact.operation = operation;
  if (tone) fact.tone = tone;
  if (textGroup) fact.textGroup = textGroup;
  if (displayGroupId) fact.displayGroupId = displayGroupId;
  if (displayOwnerId) fact.displayOwnerId = displayOwnerId;
  if (displayScope) fact.displayScope = displayScope;
  if (geometryMode) fact.geometryMode = geometryMode;
  if (structureChange) fact.structureChange = structureChange;
  if (summary) fact.summary = summary;
  return fact;
}

/**
 * Validate the immutable analyzer -> Runtime focus-plan payload. Returning an
 * empty list rejects the entire payload; Runtime may ignore missing referenced
 * atoms/owners later, but it never repairs identities or invents groups.
 * Kept self-contained because Runtime injects this exact function source into
 * the opaque iframe and applies the same boundary there.
 */
export function normalizeReviewFocusGroupPlans(value) {
  const idPattern = /^[a-z0-9:_-]{1,160}$/iu;
  const displayScopes = new Set(["paragraph", "list-item", "cell", "component", "container"]);
  const outlinePolicies = new Set(["never", "source-change", "visual-change"]);
  const geometryModes = new Set([
    "text-content",
    "element-box",
    "container-box",
    "numbered-line-range",
  ]);
  const factTypes = new Set(["text", "structure"]);
  const maxGroups = 256;
  const maxRegions = 512;
  const maxPayloadLength = 131_072;
  const maxAtomsPerGroup = 512;
  const maxOwnersPerRegion = 256;
  const maxEvidencePerRegion = 256;
  const maxTotalEvidence = 4_096;
  const maxTotalAtoms = 8_192;
  const maxTotalOwners = 4_096;
  const safeId = (candidate) => typeof candidate === "string" && idPattern.test(candidate);
  const safeAtomKey = (candidate) => {
    if (typeof candidate !== "string" || candidate.length > 700) return false;
    const reference = candidate.split("\u001e");
    if (reference.length !== 2 || !safeId(reference[0])) return false;
    const parts = reference[1].split("\u001f");
    return parts.length === 4
      && factTypes.has(parts[0])
      && safeId(parts[1])
      && safeId(parts[2])
      && (!parts[3] || safeId(parts[3]));
  };
  const safePresentation = (candidate) => {
    if (!Array.isArray(candidate) || candidate.length > 64) return null;
    const steps = [];
    for (const step of candidate) {
      if (!step || typeof step !== "object" || Array.isArray(step)) return null;
      if (step.kind === "panel" && safeId(step.key)) steps.push({ kind: "panel", key: step.key });
      else if (step.kind === "details" && safeId(step.stableId)) {
        steps.push({ kind: "details", stableId: step.stableId });
      } else return null;
    }
    return steps;
  };
  if (!Array.isArray(value) || value.length > maxGroups) return [];
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    return [];
  }
  if (serialized.length > maxPayloadLength) return [];
  const groupIds = new Set();
  const regionIds = new Set();
  let regionCount = 0;
  let totalAtoms = 0;
  let totalOwners = 0;
  let totalEvidence = 0;
  const normalized = [];
  for (const group of value) {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    if (!safeId(group.id) || groupIds.has(group.id)) return [];
    if (!safeId(group.changeId) || !safeId(group.displayGroupId)) return [];
    if (!Array.isArray(group.changeIds) || !group.changeIds.length
      || group.changeIds.some((entry) => !safeId(entry))) return [];
    if (!Array.isArray(group.atomKeys) || !group.atomKeys.length
      || group.atomKeys.length > maxAtomsPerGroup
      || group.atomKeys.some((entry) => !safeAtomKey(entry))) return [];
    const changeIds = [...new Set(group.changeIds)];
    const atomKeys = [...new Set(group.atomKeys)];
    if (!changeIds.includes(group.changeId)) return [];
    if (atomKeys.some((entry) => !changeIds.includes(entry.split("\u001e")[0]))) return [];
    totalAtoms += atomKeys.length;
    if (totalAtoms > maxTotalAtoms) return [];
    if (!displayScopes.has(group.displayScope)
      || !["text", "style", "structure"].includes(group.kind)) return [];
    if (group.focusOutlinePolicy != null && !outlinePolicies.has(group.focusOutlinePolicy)) return [];
    const focusOutlinePolicy = group.focusOutlinePolicy == null
      ? group.kind === "text"
        ? "never"
        : group.kind === "style" ? "visual-change" : "source-change"
      : group.focusOutlinePolicy;
    const presentation = {
      before: safePresentation(group.presentation?.before),
      after: safePresentation(group.presentation?.after),
    };
    if (!presentation.before || !presentation.after) return [];
    const regions = { before: [], after: [] };
    for (const side of ["before", "after"]) {
      const sideRegions = group.regions?.[side];
      if (!Array.isArray(sideRegions)) return [];
      for (const region of sideRegions) {
        regionCount += 1;
        if (regionCount > maxRegions || !region || typeof region !== "object") return [];
        if (!safeId(region.id) || regionIds.has(region.id) || region.side !== side) return [];
        if (!geometryModes.has(region.geometryMode)) return [];
        if (region.navigationClusterId != null && !safeId(region.navigationClusterId)) return [];
        if (!safeId(region.correlationKey)) return [];
        if (!safeId(region.primaryChangeId)
          || !Array.isArray(region.changeIds)
          || !region.changeIds.length
          || region.changeIds.some((entry) => !safeId(entry))) return [];
        const regionChangeIds = [...new Set(region.changeIds)];
        if (!regionChangeIds.includes(region.primaryChangeId)
          || regionChangeIds.some((entry) => !changeIds.includes(entry))) return [];
        if (!Array.isArray(region.displayOwnerIds) || !region.displayOwnerIds.length
          || region.displayOwnerIds.length > maxOwnersPerRegion
          || region.displayOwnerIds.some((entry) => !safeId(entry))) return [];
        if (region.visualEvidenceStableIds != null && (
          !Array.isArray(region.visualEvidenceStableIds)
          || region.visualEvidenceStableIds.length > maxEvidencePerRegion
          || region.visualEvidenceStableIds.some((entry) => !safeId(entry))
        )) return [];
        if (region.contentCue != null && (
          typeof region.contentCue !== "string"
          || region.contentCue.length > 80
          || /[\u0000-\u001f\u007f]/u.test(region.contentCue)
        )) return [];
        if (!Array.isArray(region.atomKeys) || !region.atomKeys.length
          || region.atomKeys.length > maxAtomsPerGroup
          || region.atomKeys.some((entry) => !safeAtomKey(entry))) return [];
        const displayOwnerIds = [...new Set(region.displayOwnerIds)];
        const visualEvidenceStableIds = [...new Set(region.visualEvidenceStableIds || [])];
        const regionAtomKeys = [...new Set(region.atomKeys)];
        if (regionAtomKeys.some((entry) => !atomKeys.includes(entry))) return [];
        if (regionAtomKeys.some((entry) => !changeIds.includes(entry.split("\u001e")[0]))) return [];
        if (regionAtomKeys.some((entry) => !regionChangeIds.includes(entry.split("\u001e")[0]))) return [];
        const regionPresentation = safePresentation(region.presentation);
        if (!regionPresentation) return [];
        totalOwners += displayOwnerIds.length;
        totalEvidence += visualEvidenceStableIds.length;
        totalAtoms += regionAtomKeys.length;
        if (totalOwners > maxTotalOwners
          || totalEvidence > maxTotalEvidence
          || totalAtoms > maxTotalAtoms) return [];
        regionIds.add(region.id);
        regions[side].push({
          id: region.id,
          side,
          navigationClusterId: region.navigationClusterId || region.id,
          contentCue: region.contentCue || "",
          correlationKey: region.correlationKey,
          primaryChangeId: region.primaryChangeId,
          changeIds: regionChangeIds,
          geometryMode: region.geometryMode,
          displayOwnerIds,
          visualEvidenceStableIds,
          atomKeys: regionAtomKeys,
          presentation: regionPresentation,
        });
      }
    }
    groupIds.add(group.id);
    normalized.push({
      id: group.id,
      kind: group.kind,
      changeId: group.changeId,
      changeIds,
      displayGroupId: group.displayGroupId,
      displayScope: group.displayScope,
      focusOutlinePolicy,
      atomKeys,
      presentation,
      regions,
      presence: {
        before: Boolean(group.presence?.before),
        after: Boolean(group.presence?.after),
      },
    });
    if (Boolean(group.presence?.before) !== Boolean(regions.before.length)
      || Boolean(group.presence?.after) !== Boolean(regions.after.length)) return [];
  }
  return normalized;
}

/**
 * Validate the independent exact-evidence occurrence registry. This payload is
 * intentionally separate from Focus Group plans: rejecting a semantic plan
 * must never erase source-backed red/green evidence. Kept self-contained for
 * the same analyzer/Runtime injection contract as the focus-plan normalizer.
 */
export function normalizeReviewExactAtomOccurrences(value) {
  const idPattern = /^[a-z0-9:_-]{1,160}$/iu;
  const factTypes = new Set(["text", "structure"]);
  const maxEntries = 4096;
  const maxPayloadLength = 262144;
  const safeId = (candidate) => typeof candidate === "string" && idPattern.test(candidate);
  const safeAtomKey = (candidate) => {
    if (typeof candidate !== "string" || candidate.length > 700) return false;
    const reference = candidate.split("\u001e");
    if (reference.length !== 2 || !safeId(reference[0])) return false;
    const parts = reference[1].split("\u001f");
    return parts.length === 4
      && factTypes.has(parts[0])
      && safeId(parts[1])
      && safeId(parts[2])
      && (!parts[3] || safeId(parts[3]));
  };
  if (!Array.isArray(value) || value.length > maxEntries) return [];
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    return [];
  }
  if (serialized.length > maxPayloadLength) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (!safeAtomKey(entry.atomKey) || seen.has(entry.atomKey)) return [];
    if (!Number.isInteger(entry.count) || entry.count < 1 || entry.count > 128) return [];
    seen.add(entry.atomKey);
    normalized.push({ atomKey: entry.atomKey, count: entry.count });
  }
  return normalized;
}

/**
 * A fact ID is unique only within a change. Its type and owners are part of
 * the identity; U+001F cannot occur in the validated key alphabet, so it is
 * an unambiguous internal separator rather than a rendered identifier.
 */
export function reviewProjectionFactKey(value) {
  const fact = normalizeReviewProjectionFact(value);
  return fact
    ? [
      fact.type,
      fact.id,
      fact.semanticOwnerId,
      fact.geometryOwnerId || "",
    ].join("\u001f")
    : "";
}

export function reviewProjectionFactsCanMerge(left, right) {
  const normalizedLeft = normalizeReviewProjectionFact(left);
  const normalizedRight = normalizeReviewProjectionFact(right);
  return Boolean(
    normalizedLeft
    && normalizedRight
    && normalizedLeft.type === normalizedRight.type
    && normalizedLeft.id === normalizedRight.id
    && normalizedLeft.semanticOwnerId === normalizedRight.semanticOwnerId
    && (normalizedLeft.geometryOwnerId || "") === (normalizedRight.geometryOwnerId || ""),
  );
}

function appendNormalizedFact(facts, next, overflow) {
  if (!next) return facts;
  const existingIndex = facts.findIndex((fact) => reviewProjectionFactsCanMerge(fact, next));
  if (existingIndex >= 0) {
    const updated = [...facts];
    updated[existingIndex] = { ...updated[existingIndex], ...next };
    return updated;
  }
  if (facts.length < REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT) return [...facts, next];
  if (overflow === "throw") throw new ReviewProjectionFactOverflowError();
  return overflow === "fail-closed" ? null : facts;
}

function normalizedReviewProjectionFacts(facts, overflow = "truncate") {
  if (!Array.isArray(facts)) return [];
  let normalized = [];
  for (const value of facts) {
    const next = normalizeReviewProjectionFact(value);
    const appended = appendNormalizedFact(normalized, next, overflow);
    if (appended === null) return null;
    normalized = appended;
  }
  return normalized;
}

/**
 * Parse or compatibility callers stay bounded and never trust an oversized
 * payload. Trusted analysis must use appendTrustedReviewProjectionFact so an
 * incomplete projection can never masquerade as a complete one.
 */
export function appendReviewProjectionFact(facts, value) {
  const normalized = normalizedReviewProjectionFacts(facts);
  return appendNormalizedFact(normalized, normalizeReviewProjectionFact(value), "truncate");
}

export function appendTrustedReviewProjectionFact(facts, value) {
  const normalized = normalizedReviewProjectionFacts(facts, "throw");
  return appendNormalizedFact(normalized, normalizeReviewProjectionFact(value), "throw");
}

export function serializeReviewProjectionFacts(facts) {
  return JSON.stringify((Array.isArray(facts) ? facts : []).reduce(
    (result, fact) => appendReviewProjectionFact(result, fact),
    [],
  ));
}

export function parseReviewProjectionFacts(value) {
  if (
    typeof value !== "string"
    || value.length > REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT
  ) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizedReviewProjectionFacts(parsed, "fail-closed") || [];
  } catch {
    return [];
  }
}
