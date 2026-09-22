import type {
  ReviewDocuments,
  ReviewPresentation,
  ReviewSide,
} from "./review-document";
import {
  DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID,
  nextActiveReviewFocusGroupId,
} from "../lib/review-focus-state.js";

export type ReviewPageView = "split" | ReviewSide;
export type ReviewScrollMode = "linked" | "independent";
export type ReviewZoomMode = "fit" | "actual";
export type ReviewFocusRegionSelection = Record<ReviewSide, string | null>;
export type ReviewReadingPosition = Record<ReviewSide, Readonly<{
  top: number;
  left: number;
  viewportLeft: number;
}>>;

export type ReviewState = {
  pageView: ReviewPageView;
  contextVisibility: number;
  navigationTarget: string;
  activeFocusGroupId: string | null;
  activeFocusRegionIds: ReviewFocusRegionSelection;
  pagePresentation: ReviewPresentation;
  scrollMode: ReviewScrollMode;
  zoomMode: ReviewZoomMode;
};

export type ReviewPresentationSnapshot = Readonly<{
  reviewIdentity: string;
  state: Omit<ReviewState, "contextVisibility">;
  positions: ReviewReadingPosition;
}>;

export type ReviewStateAction =
  | { type: "set-page-view"; value: ReviewPageView }
  | { type: "set-context-visibility"; value: number }
  | { type: "set-navigation-target"; value: string }
  | { type: "set-active-focus-group"; value: string | null }
  | {
    type: "set-active-focus";
    value: null | {
      groupId: string;
      regionIds: ReviewFocusRegionSelection;
    };
  }
  | { type: "set-page-presentation"; value: ReviewPresentation }
  | { type: "set-scroll-mode"; value: ReviewScrollMode }
  | { type: "set-zoom-mode"; value: ReviewZoomMode };

export const DEFAULT_REVIEW_STATE: ReviewState = {
  pageView: "split",
  contextVisibility: 25,
  navigationTarget: "all",
  activeFocusGroupId: DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID,
  activeFocusRegionIds: { before: null, after: null },
  pagePresentation: { before: [], after: [] },
  scrollMode: "linked",
  zoomMode: "fit",
};

export const EMPTY_REVIEW_READING_POSITIONS: ReviewReadingPosition = Object.freeze({
  before: Object.freeze({ top: 0, left: 0, viewportLeft: 0 }),
  after: Object.freeze({ top: 0, left: 0, viewportLeft: 0 }),
});

export function restoreReviewPresentation({
  documents,
  reviewIdentity,
  contextVisibility,
  presentation,
}: Readonly<{
  documents: Pick<ReviewDocuments, "changes" | "focusGroups">;
  reviewIdentity: string;
  contextVisibility: number;
  presentation?: ReviewPresentationSnapshot | null;
}>): {
  state: ReviewState;
  positions: ReviewPresentationSnapshot["positions"];
  restored: boolean;
} {
  const fallback = {
    state: { ...DEFAULT_REVIEW_STATE, contextVisibility },
    positions: EMPTY_REVIEW_READING_POSITIONS,
    restored: false,
  };
  if (!presentation || presentation.reviewIdentity !== reviewIdentity) return fallback;
  const candidate = presentation.state;
  const pageView = (["split", "before", "after"] as string[]).includes(candidate.pageView)
    ? candidate.pageView
    : "split";
  const scrollMode = candidate.scrollMode === "independent" ? "independent" : "linked";
  const zoomMode = candidate.zoomMode === "actual" ? "actual" : "fit";
  const navigationTarget = candidate.navigationTarget === "all"
    || documents.changes.some((change) => change.id === candidate.navigationTarget)
    ? candidate.navigationTarget
    : "all";
  const focusGroup = documents.focusGroups.find((group) => (
    group.id === candidate.activeFocusGroupId
  )) || null;
  const regionId = (side: ReviewSide) => {
    const requested = candidate.activeFocusRegionIds?.[side];
    return focusGroup?.regions[side].some((region) => region.id === requested)
      ? requested || null
      : null;
  };
  const position = (side: ReviewSide) => {
    const raw = presentation.positions?.[side];
    const safe = (value: unknown) => Number.isFinite(Number(value))
      ? Math.max(0, Number(value))
      : 0;
    return {
      top: safe(raw?.top),
      left: safe(raw?.left),
      viewportLeft: safe(raw?.viewportLeft),
    };
  };
  return {
    state: {
      pageView: pageView as ReviewPageView,
      contextVisibility,
      navigationTarget,
      activeFocusGroupId: focusGroup?.id || null,
      activeFocusRegionIds: {
        before: regionId("before"),
        after: regionId("after"),
      },
      pagePresentation: candidate.pagePresentation || { before: [], after: [] },
      scrollMode,
      zoomMode,
    },
    positions: { before: position("before"), after: position("after") },
    restored: true,
  };
}

export function reduceReviewState(
  state: ReviewState,
  action: ReviewStateAction,
): ReviewState {
  switch (action.type) {
    case "set-page-view":
      return state.pageView === action.value ? state : { ...state, pageView: action.value };
    case "set-context-visibility": {
      const nextVisibility = Math.round(Math.max(0, Math.min(100, action.value)));
      return state.contextVisibility === nextVisibility
        ? state
        : { ...state, contextVisibility: nextVisibility };
    }
    case "set-navigation-target":
      return state.navigationTarget === action.value
        ? state
        : { ...state, navigationTarget: action.value };
    case "set-active-focus-group": {
      const activeFocusGroupId = nextActiveReviewFocusGroupId(
        state.activeFocusGroupId,
        action.value,
      );
      return state.activeFocusGroupId === activeFocusGroupId
        ? state
        : {
          ...state,
          activeFocusGroupId,
          activeFocusRegionIds: { before: null, after: null },
        };
    }
    case "set-active-focus": {
      const activeFocusGroupId = nextActiveReviewFocusGroupId(
        state.activeFocusGroupId,
        action.value?.groupId,
      );
      const activeFocusRegionIds = action.value?.regionIds || { before: null, after: null };
      const unchanged = state.activeFocusGroupId === activeFocusGroupId
        && state.activeFocusRegionIds.before === activeFocusRegionIds.before
        && state.activeFocusRegionIds.after === activeFocusRegionIds.after;
      return unchanged ? state : {
        ...state,
        activeFocusGroupId,
        activeFocusRegionIds,
      };
    }
    case "set-page-presentation": {
      const normalize = (side: ReviewSide) => {
        const seen = new Set<string>();
        return action.value[side].filter((step) => {
          const key = step.kind === "panel" ? `panel:${step.key}` : `details:${step.stableId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const value: ReviewPresentation = { before: normalize("before"), after: normalize("after") };
      const unchanged = (["before", "after"] as const).every((side) => (
        value[side].length === state.pagePresentation[side].length
        && value[side].every((step, index) => (
          JSON.stringify(step) === JSON.stringify(state.pagePresentation[side][index])
        ))
      ));
      return unchanged ? state : { ...state, pagePresentation: value };
    }
    case "set-scroll-mode":
      return state.scrollMode === action.value ? state : { ...state, scrollMode: action.value };
    case "set-zoom-mode":
      return state.zoomMode === action.value ? state : { ...state, zoomMode: action.value };
    default:
      return state;
  }
}
