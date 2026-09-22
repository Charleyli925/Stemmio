export type ReviewProjectionFactType = "text" | "structure";

export type ReviewProjectionFactScope =
  | "text"
  | "text-phrase"
  | "text-line"
  | "text-block"
  | "element";

export type ReviewProjectionDisplayScope =
  | "paragraph"
  | "list-item"
  | "cell"
  | "component"
  | "container";

export type ReviewFocusGeometryMode =
  | "text-content"
  | "element-box"
  | "container-box"
  | "numbered-line-range";

export type ReviewFocusOutlinePolicy = "never" | "source-change" | "visual-change";

export type ReviewProjectionFact = {
  id: string;
  type: ReviewProjectionFactType;
  semanticOwnerId: string;
  geometryOwnerId?: string;
  scope?: ReviewProjectionFactScope;
  operation?: "none" | "insert" | "delete" | "replace";
  tone?: "added" | "removed";
  textGroup?: string;
  /** Disposable presentation grouping; never part of exact fact identity. */
  displayGroupId?: string;
  displayOwnerId?: string;
  displayScope?: ReviewProjectionDisplayScope;
  geometryMode?: ReviewFocusGeometryMode;
  structureChange?:
    | "added"
    | "removed"
    | "moved"
    | "reordered"
    | "attribute"
    | "style";
  summary?: string;
};

export const REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT: number;
export const REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT: number;
export const REVIEW_EXACT_ATOM_OCCURRENCE_LIMIT: number;
export const REVIEW_EXACT_ATOM_OCCURRENCE_SERIALIZED_LENGTH_LIMIT: number;

export class ReviewProjectionFactOverflowError extends Error {
  code: "REVIEW_PROJECTION_FACTS_OVERFLOW";
}

export function normalizeReviewProjectionFact(value: unknown): ReviewProjectionFact | null;
export function reviewProjectionFactKey(value: unknown): string;
export function reviewProjectionFactsCanMerge(left: unknown, right: unknown): boolean;
export function appendReviewProjectionFact(
  facts: readonly unknown[],
  value: unknown,
): ReviewProjectionFact[];
/** Throws ReviewProjectionFactOverflowError instead of silently discarding a fact. */
export function appendTrustedReviewProjectionFact(
  facts: readonly unknown[],
  value: unknown,
): ReviewProjectionFact[];
export function serializeReviewProjectionFacts(facts: readonly unknown[]): string;
export function parseReviewProjectionFacts(value: unknown): ReviewProjectionFact[];
export function normalizeReviewFocusGroupPlans(value: unknown): unknown[];
export function normalizeReviewExactAtomOccurrences(value: unknown): Array<{
  atomKey: string;
  count: number;
}>;
