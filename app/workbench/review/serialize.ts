import {
  REVIEW_TEXT_EVIDENCE_ADDED_COLOR,
  REVIEW_TEXT_EVIDENCE_MARKER_CSS,
  REVIEW_TEXT_EVIDENCE_REMOVED_COLOR,
} from "../../lib/review-text-evidence-marks.js";
import {
  normalizeReviewExactAtomOccurrences,
  reviewProjectionFactKey,
} from "../../lib/review-projection-facts.js";
import {
  REVIEW_BASE_ATTRIBUTE,
  REVIEW_BOOTSTRAP_ATTRIBUTE,
  REVIEW_BOOTSTRAP_PATH,
  REVIEW_STYLE_ID,
} from "./constants";
import { reviewProjectionFactsForElement } from "./parse";
import {
  reviewBootstrap,
} from "./runtime-projection";
import {
  REVIEW_STRUCTURE_TONE_COLOR,
} from "./tones";
import type {
  ReviewCommentBootstrapBinding,
  ReviewFocusGroupPlan,
  ReviewSide,
} from "./types";

export const REVIEW_DOCUMENT_STYLE = String.raw`
  html {
    --stemmio-review-context-opacity: .18;
    --stemmio-review-ui-scale: 1;
    scroll-behavior: auto !important;
    overflow-anchor: none !important;
  }

  body {
    scroll-behavior: auto !important;
    overflow-anchor: none !important;
  }

  [data-stemmio-outline-id] {
    transition: opacity 160ms ease, filter 160ms ease, outline-color 120ms ease !important;
  }

  html body [data-stemmio-review-text][data-stemmio-review-marker] {
    display: contents !important;
    position: static !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    font: inherit !important;
    letter-spacing: inherit !important;
    word-spacing: inherit !important;
  }

  [data-stemmio-review-confirmed="true"][data-stemmio-review-marker-types~="structure"] {
    outline: none !important;
  }

${REVIEW_TEXT_EVIDENCE_MARKER_CSS}

  html[data-stemmio-review-overlays="true"] [data-stemmio-review-marker] {
    outline: none !important;
  }

  [data-stemmio-review-projection-layer] {
    position: absolute !important;
    z-index: 2147482500 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: none !important;
    background: transparent !important;
    opacity: 1 !important;
    filter: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    mix-blend-mode: normal !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-stemmio-review-mask-layer] {
    position: absolute !important;
    z-index: 0 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    overflow: visible !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    outline: none !important;
    background: transparent !important;
    box-shadow: none !important;
    opacity: 1 !important;
    filter: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    mix-blend-mode: normal !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-stemmio-review-mask],
  [data-stemmio-review-mask-background],
  [data-stemmio-review-mask-hole],
  [data-stemmio-review-mask-dim] {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: none !important;
    opacity: 1 !important;
    filter: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    mix-blend-mode: normal !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-stemmio-review-mask] {
    mask-type: luminance !important;
  }

  [data-stemmio-review-mask-background] {
    fill: #ffffff !important;
    stroke: none !important;
  }

  [data-stemmio-review-mask-hole] {
    fill: #000000 !important;
    stroke: none !important;
  }

  [data-stemmio-review-mask-dim] {
    fill: #ffffff !important;
    stroke: none !important;
  }

  [data-stemmio-review-text-marks] {
    position: absolute !important;
    z-index: 1 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: none !important;
    background: transparent !important;
    opacity: 1 !important;
    filter: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    mix-blend-mode: normal !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-stemmio-review-text-mark="removed"] {
    fill: none !important;
    stroke: ${REVIEW_TEXT_EVIDENCE_REMOVED_COLOR} !important;
    stroke-linecap: round !important;
    vector-effect: non-scaling-stroke !important;
  }

  [data-stemmio-review-text-mark="added"] {
    fill: ${REVIEW_TEXT_EVIDENCE_ADDED_COLOR} !important;
    stroke: none !important;
  }

  [data-stemmio-review-overlay-box] {
    position: absolute !important;
    z-index: 1 !important;
    display: block !important;
    overflow: visible !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: calc(1.5px * var(--stemmio-review-ui-scale)) solid transparent !important;
    border-radius: calc(5px * var(--stemmio-review-ui-scale)) !important;
    outline: none !important;
    background: transparent !important;
    box-shadow: none !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-stemmio-review-overlay-box][data-tone="text-removed"],
  [data-stemmio-review-overlay-box][data-tone="text-added"] {
    border-width: calc(1px * var(--stemmio-review-ui-scale)) !important;
  }

  /* A confirmed change rests silent: the dim mask, the page-edge revision bar
     and one caption per region already say where it is. The precise outline
     appears only when the reader reaches for it — hover previews, focus
     claims. */
  [data-stemmio-review-overlay-box][data-hover="true"] {
    border-color: rgb(109 92 231 / 55%) !important;
  }

  [data-stemmio-review-overlay-box][data-active="true"] {
    border-color: ${REVIEW_STRUCTURE_TONE_COLOR} !important;
    background: rgb(109 92 231 / 4%) !important;
  }

  [data-stemmio-review-overlay-box][data-shaped="true"] {
    border: 0 !important;
    background: transparent !important;
  }

  [data-stemmio-review-overlay-shape-svg] {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    overflow: visible !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: none !important;
    background: transparent !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: none !important;
  }

  [data-stemmio-review-overlay-shape] {
    display: block !important;
    fill: none !important;
    stroke: transparent !important;
    stroke-width: calc(1.5px * var(--stemmio-review-ui-scale)) !important;
    stroke-linejoin: round !important;
    stroke-linecap: round !important;
    vector-effect: non-scaling-stroke !important;
  }

  [data-stemmio-review-overlay-box][data-hover="true"] [data-stemmio-review-overlay-shape] {
    stroke: rgb(109 92 231 / 55%) !important;
  }

  [data-stemmio-review-overlay-box][data-active="true"] [data-stemmio-review-overlay-shape] {
    stroke: ${REVIEW_STRUCTURE_TONE_COLOR} !important;
  }

  [data-stemmio-review-overlay-label] {
    position: absolute !important;
    right: 0 !important;
    bottom: calc(100% + 4px) !important;
    z-index: 2 !important;
    display: inline-flex !important;
    align-items: center !important;
    min-height: calc(18px * var(--stemmio-review-ui-scale)) !important;
    max-width: min(320px, calc(100vw - 24px)) !important;
    padding: calc(2px * var(--stemmio-review-ui-scale)) calc(7px * var(--stemmio-review-ui-scale)) !important;
    overflow: hidden !important;
    border: 1px solid rgb(90 85 223 / 18%) !important;
    border-radius: calc(6px * var(--stemmio-review-ui-scale)) !important;
    background: rgb(255 255 255 / 88%) !important;
    color: #4f47b8 !important;
    box-shadow: 0 2px 8px rgb(30 25 70 / 8%) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: calc(10px * var(--stemmio-review-ui-scale)) !important;
    font-weight: 640 !important;
    line-height: 1.2 !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    cursor: pointer !important;
  }

  [data-stemmio-review-overlay-box][data-hover="true"] [data-stemmio-review-overlay-label],
  [data-stemmio-review-overlay-box][data-active="true"] [data-stemmio-review-overlay-label] {
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
  }

  /* At the document's very top there is no room above the box, so the caption
     slides just below its top edge instead of clipping outside the page. */
  [data-stemmio-review-overlay-box][data-label-inside="true"] [data-stemmio-review-overlay-label] {
    bottom: auto !important;
    top: calc(100% + 4px) !important;
  }

  [data-stemmio-review-overlay-box][data-hover="true"] [data-stemmio-review-overlay-label] {
    background: rgb(255 255 255 / 94%) !important;
    border-color: rgb(90 85 223 / 30%) !important;
  }

  [data-stemmio-review-overlay-box][data-active="true"] [data-stemmio-review-overlay-label] {
    background: rgb(255 255 255 / 96%) !important;
    border-color: rgb(90 85 223 / 40%) !important;
    color: #4843c9 !important;
    font-weight: 700 !important;
    box-shadow: 0 4px 14px rgb(30 25 70 / 14%) !important;
  }

  /* One page-edge revision bar per change region: the quiet, clickable focus
     entry point that remains after the toolbar sequence navigator is removed. */
  [data-stemmio-review-region-bar] {
    position: absolute !important;
    z-index: 2 !important;
    display: block !important;
    width: calc(3px * var(--stemmio-review-ui-scale)) !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: calc(2px * var(--stemmio-review-ui-scale)) !important;
    outline: none !important;
    background: ${REVIEW_STRUCTURE_TONE_COLOR} !important;
    box-shadow: none !important;
    opacity: .5 !important;
    filter: none !important;
    transform: none !important;
    pointer-events: auto !important;
    cursor: pointer !important;
  }

  [data-stemmio-review-region-bar]:hover,
  [data-stemmio-review-region-bar][data-hover="true"] {
    opacity: .85 !important;
  }

  [data-stemmio-review-region-bar][data-active="true"] {
    opacity: 1 !important;
    box-shadow: 0 0 0 calc(2.5px * var(--stemmio-review-ui-scale)) rgb(109 92 231 / 14%) !important;
  }

  [data-stemmio-review-transition-mask] {
    position: absolute !important;
    z-index: 2147482490 !important;
    top: 0 !important;
    left: 0 !important;
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: none !important;
    background: #ffffff !important;
    pointer-events: none !important;
  }

  html:not([data-stemmio-review-overlays="true"])
    [data-stemmio-review-confirmed="true"][data-stemmio-review-marker][data-stemmio-review-primary="true"][data-stemmio-review-active="true"]::after {
    position: absolute !important;
    z-index: 2147483000 !important;
    top: calc(-24px * var(--stemmio-review-ui-scale)) !important;
    right: 0 !important;
    display: inline-flex !important;
    align-items: center !important;
    min-height: calc(19px * var(--stemmio-review-ui-scale)) !important;
    max-width: min(320px, calc(100vw - 24px)) !important;
    padding: 0 calc(7px * var(--stemmio-review-ui-scale)) !important;
    border: 1px solid rgb(90 85 223 / 24%) !important;
    border-radius: calc(6px * var(--stemmio-review-ui-scale)) !important;
    background: rgb(255 255 255 / 94%) !important;
    color: #4843c9 !important;
    box-shadow: 0 4px 12px rgb(30 25 70 / 12%) !important;
    content: attr(data-stemmio-review-summary) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: calc(10px * var(--stemmio-review-ui-scale)) !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
    letter-spacing: 0 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    pointer-events: none !important;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-stemmio-outline-id] { transition: none !important; }
  }
`;

export function serializeReviewMarkup(document: Document): string {
  return `${doctypeString(document.doctype)}\n${document.documentElement.outerHTML}`;
}

export function doctypeString(doctype: DocumentType | null): string {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

export function baseHrefFromSourcePath(sourcePath?: string): string | undefined {
  const trimmedPath = sourcePath?.trim();
  if (!trimmedPath) return undefined;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      const sourceUrl = new URL(trimmedPath);
      if (!sourceUrl.pathname.endsWith("/")) {
        sourceUrl.pathname = sourceUrl.pathname.slice(0, sourceUrl.pathname.lastIndexOf("/") + 1);
      }
      sourceUrl.search = "";
      sourceUrl.hash = "";
      return sourceUrl.href;
    }
  } catch {
    return undefined;
  }
  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("/")) return undefined;
  const directoryPath = normalizedPath.endsWith("/")
    ? normalizedPath
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
  return `file://${directoryPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function prepareDocument(
  document: Document,
  side: ReviewSide,
  sessionId: string,
  sourcePath?: string,
  externalBootstrap = false,
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
  reviewVisualStableIds: readonly string[] = [],
  reviewFocusGroupPlans: readonly ReviewFocusGroupPlan[] = [],
): {
  html: string;
  bootstrapJavaScript: string;
  bootstrapFallbackJavaScript: string;
} {
  document.querySelectorAll("meta[http-equiv]").forEach((element) => {
    const directive = (element.getAttribute("http-equiv") || "").trim().toLowerCase();
    if (
      directive === "refresh"
      || directive === "content-security-policy"
      || directive === "content-security-policy-report-only"
    ) element.remove();
  });
  document.querySelectorAll("*").forEach((element) => {
    if (element.tagName === "IFRAME") {
      element.setAttribute("sandbox", "");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
  });

  document.documentElement.dataset.stemmioReviewSide = side;
  document.documentElement.dataset.stemmioReviewFocus = "all";
  document.documentElement.dataset.stemmioReviewFocusGroup = "";

  const style = document.createElement("style");
  style.id = REVIEW_STYLE_ID;
  style.textContent = REVIEW_DOCUMENT_STYLE;

  const bootstrap = document.createElement("script");
  bootstrap.setAttribute(REVIEW_BOOTSTRAP_ATTRIBUTE, "true");
  // Exact evidence remains available even when the independent semantic focus
  // plan is rejected. The trusted analyzer also tells Runtime how many source
  // marker occurrences legitimately carry each logical atom, so repeated text
  // fragments are accepted without admitting authored decoys.
  const exactAtomOccurrenceCounts = new Map<string, number>();
  document.querySelectorAll(
    "[data-stemmio-review-marker][data-stemmio-review-projection-facts]",
  ).forEach((element) => {
    const changeId = element.getAttribute("data-stemmio-review-marker") || "";
    if (!changeId) return;
    reviewProjectionFactsForElement(element).forEach((fact) => {
      const factKey = reviewProjectionFactKey(fact);
      if (!factKey) return;
      const atomKey = `${changeId}\u001e${factKey}`;
      exactAtomOccurrenceCounts.set(atomKey, (exactAtomOccurrenceCounts.get(atomKey) || 0) + 1);
    });
  });
  const requestedExactAtomOccurrences = [...exactAtomOccurrenceCounts]
    .map(([atomKey, count]) => ({ atomKey, count }));
  const reviewExactAtomOccurrences = normalizeReviewExactAtomOccurrences(
    requestedExactAtomOccurrences,
  );
  if (reviewExactAtomOccurrences.length !== requestedExactAtomOccurrences.length) {
    throw new Error("Review exact atom occurrence payload exceeds its bootstrap contract.");
  }
  const bootstrapJavaScript = reviewBootstrap(
    sessionId,
    side,
    reviewCommentBindings,
    reviewVisualStableIds,
    reviewFocusGroupPlans,
    reviewExactAtomOccurrences,
  );
  const bootstrapFallbackJavaScript = reviewBootstrap(
    sessionId,
    side,
    [],
    reviewVisualStableIds,
    reviewFocusGroupPlans,
    reviewExactAtomOccurrences,
  );
  if (externalBootstrap) {
    bootstrap.src = REVIEW_BOOTSTRAP_PATH;
  } else {
    bootstrap.textContent = bootstrapJavaScript;
  }

  const baseHref = externalBootstrap ? undefined : baseHrefFromSourcePath(sourcePath);
  if (baseHref && !document.head.querySelector("base")) {
    const base = document.createElement("base");
    base.href = baseHref;
    base.setAttribute(REVIEW_BASE_ATTRIBUTE, "true");
    document.head.insertBefore(base, document.head.firstChild);
  }
  document.head.prepend(bootstrap);
  document.head.append(style);
  return {
    html: `${doctypeString(document.doctype)}\n${document.documentElement.outerHTML}`,
    bootstrapJavaScript,
    bootstrapFallbackJavaScript,
  };
}
