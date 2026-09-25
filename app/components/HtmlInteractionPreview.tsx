"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  PAGE_VIEW_CONTEXT_PROTOCOL,
  PAGE_VIEW_CONTEXT_VERSION,
  createPageViewContext,
  type PageViewContext,
  type RawPageViewSnapshot,
} from "../lib/page-view-context.js";
import { OPAQUE_SANDBOX_STORAGE_BOOTSTRAP } from "../lib/opaque-sandbox-storage.js";
import { STEMMIO_ELEMENT_ID_ATTRIBUTE } from "../../shared/stemmio-element-identity.mjs";
import { buildSourceIndex } from "../lib/source-index.js";
import {
  MAX_PREVIEW_COMMENT_GROUPS,
  previewCommentMarkerGroups,
  previewCommentMeasureRequest,
  safePreviewCommentLayouts,
  type PreviewCommentGroup,
  type PreviewCommentLayout,
} from "../lib/preview-comment-markers.js";
import ReadOnlyCommentMarker from "./ReadOnlyCommentMarker";
import styles from "./HtmlInteractionPreview.module.css";

export type HtmlInteractionPreviewHandle = {
  capturePageViewContext: () => Promise<PageViewContext | null>;
  reload: () => void;
};

export type PreviewDisplayResult =
  | Readonly<{ status: "pending"; attemptId: string }>
  | Readonly<{ status: "cancelled"; attemptId: string }>
  | Readonly<{ status: "verified"; attemptId: string; sourceSha256: string; sessionId?: string }>
  | Readonly<{
    status: "degraded";
    attemptId: string;
    sourceSha256: string;
    reason: "paint-timeout" | "host-timeout" | "history-static";
  }>
  | Readonly<{
    status: "failed";
    attemptId: string;
    reason: "session-unavailable" | "session-create-failed" | "frame-unavailable" | "frame-error";
  }>;

export type PreviewOpenReason =
  | "initial-open"
  | "mode-switch"
  | "tab-switch"
  | "source-change"
  | "history-open";

export type HtmlInteractionPreviewProps = {
  html: string;
  documentKey: string;
  sourcePath?: string;
  height?: string;
  transport?: "independent-url" | "srcdoc";
  staticFallbackOnFailure?: boolean;
  openReason?: PreviewOpenReason;
  /**
   * Saved comments for this document. The preview renders each resolvable
   * target as a read-only marker; an ambiguous or orphaned target produces no
   * marker at all.
   */
  comments?: readonly unknown[];
  onInteraction?: () => void;
  onDisplayResult?: (result: PreviewDisplayResult) => void;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
};

type DesktopPreviewSession = {
  sessionId: string;
  url: string;
};

type DesktopPreviewApi = {
  createSession: (payload: {
    html: string;
    bootstrapJavaScript: string;
    bootstrapFallbackJavaScript?: string;
    sourcePath?: string;
    sessionId?: string;
  }) => Promise<DesktopPreviewSession>;
  revokeSession: (sessionId: string) => Promise<{ revoked: boolean }>;
  inspectSession?: (sessionId: string) => Promise<{ active: boolean }>;
};

declare global {
  interface Window {
    stemmioPreview?: DesktopPreviewApi;
  }
}

const PREVIEW_BOOTSTRAP_ATTRIBUTE = "data-stemmio-preview-bootstrap";
const PREVIEW_BASE_ATTRIBUTE = "data-stemmio-preview-base";
const PREVIEW_BOOTSTRAP_PATH = "/.stemmio/preview-bootstrap.js";
const CAPTURE_REQUEST_TYPE = "stemmio-page-view-context-request";
const CAPTURE_RESPONSE_TYPE = "stemmio-page-view-context-response";
const COMMENT_MEASURE_REQUEST_TYPE = "stemmio-preview-comment-measure-request";
const COMMENT_LAYOUT_RESPONSE_TYPE = "stemmio-preview-comment-layout";
const SCROLL_REQUEST_TYPE = "stemmio-preview-scroll-request";
const SCROLL_EVENT_TYPE = "stemmio-preview-scroll";
const VISUAL_READY_REQUEST_TYPE = "stemmio-preview-visual-ready-request";
const VISUAL_READY_RESPONSE_TYPE = "stemmio-preview-visual-ready-response";
const CAPTURE_TIMEOUT_MS = 1_200;
const VISUAL_READY_TIMEOUT_MS = 900;
const MAX_CAPTURED_ELEMENTS = 512;
const INDEPENDENT_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads";
const SRCDOC_PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-popups allow-downloads";

function previewBootstrapJavaScript({
  channelToken,
  sourceSha256,
}: {
  channelToken: string;
  sourceSha256: string;
}): string {
  const config = JSON.stringify({
    channelToken,
    sourceSha256,
    sourceNodeAttribute: STEMMIO_ELEMENT_ID_ATTRIBUTE,
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    requestType: CAPTURE_REQUEST_TYPE,
    responseType: CAPTURE_RESPONSE_TYPE,
    commentRequestType: COMMENT_MEASURE_REQUEST_TYPE,
    commentLayoutType: COMMENT_LAYOUT_RESPONSE_TYPE,
    scrollRequestType: SCROLL_REQUEST_TYPE,
    scrollEventType: SCROLL_EVENT_TYPE,
    visualReadyRequestType: VISUAL_READY_REQUEST_TYPE,
    visualReadyResponseType: VISUAL_READY_RESPONSE_TYPE,
    maxElements: MAX_CAPTURED_ELEMENTS,
    maxCommentTargets: MAX_PREVIEW_COMMENT_GROUPS,
  }).replace(/</gu, "\\u003c");
  return String.raw`
(() => {
  "use strict";
  const config = ${config};
  ${OPAQUE_SANDBOX_STORAGE_BOOTSTRAP}

  const capture = () => {
    const entries = [];
    const seen = new Set();
    const elements = document.querySelectorAll(
      "[" + config.sourceNodeAttribute + "]",
    );
    let truncated = false;
    for (const element of elements) {
      const sourceNodeId = element.getAttribute(config.sourceNodeAttribute) || "";
      if (!sourceNodeId || seen.has(sourceNodeId)) {
        if (sourceNodeId) {
          entries.push({
            sourceNodeId,
            className: "",
            hidden: false,
            open: false,
            ariaSelected: null,
            ariaExpanded: null,
            display: "",
            visibility: "",
          });
        }
        continue;
      }
      seen.add(sourceNodeId);
      const className = element.getAttribute("class") || "";
      const hidden = element.hasAttribute("hidden");
      const open = element.hasAttribute("open");
      const ariaSelected = element.getAttribute("aria-selected");
      const ariaExpanded = element.getAttribute("aria-expanded");
      if (
        !className
        && !hidden
        && !open
        && ariaSelected === null
        && ariaExpanded === null
      ) continue;
      let display = "";
      let visibility = "";
      try {
        const computed = window.getComputedStyle(element);
        display = computed.display || "";
        visibility = computed.visibility || "";
      } catch {
        // A malformed authored node simply contributes no visibility signal.
      }
      entries.push({
        sourceNodeId,
        className,
        hidden,
        open,
        ariaSelected,
        ariaExpanded,
        display,
        visibility,
      });
      if (entries.length > config.maxElements) {
        truncated = true;
        break;
      }
    }
    return {
      protocol: config.protocol,
      version: config.version,
      sourceSha256: config.sourceSha256,
      truncated,
      entries: truncated ? [] : entries,
    };
  };

  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (
      event.source !== window.parent
      || !payload
      || payload.type !== config.requestType
      || payload.channelToken !== config.channelToken
      || typeof payload.requestId !== "string"
    ) return;
    window.parent.postMessage({
      type: config.responseType,
      channelToken: config.channelToken,
      requestId: payload.requestId,
      snapshot: capture(),
    }, "*");
  });

  // The outer iframe load event can precede the first composited content.
  // Reply only after this document has reported a contentful paint and has
  // passed through its own animation frames. Blank documents use a bounded
  // fallback so Preview still opens.
  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (
      event.source !== window.parent
      || !payload
      || payload.type !== config.visualReadyRequestType
      || payload.channelToken !== config.channelToken
      || typeof payload.requestId !== "string"
    ) return;
    let finished = false;
    let observer = null;
    let timeoutId = 0;
    const finish = (evidence) => {
      if (finished) return;
      finished = true;
      observer?.disconnect();
      window.clearTimeout(timeoutId);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        window.setTimeout(() => window.parent.postMessage({
          type: config.visualReadyResponseType,
          channelToken: config.channelToken,
          requestId: payload.requestId,
          evidence,
        }, "*"), 0);
      }));
    };
    if (performance.getEntriesByType("paint").some((entry) => entry.name === "first-contentful-paint")) {
      finish("first-contentful-paint");
      return;
    }
    try {
      observer = new PerformanceObserver((list) => {
        if (list.getEntries().some((entry) => entry.name === "first-contentful-paint")) finish("first-contentful-paint");
      });
      observer.observe({ type: "paint", buffered: true });
    } catch {
      // Older or restricted pages still receive the bounded fallback.
    }
    timeoutId = window.setTimeout(() => finish("bounded-no-paint"), 350);
  });

  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (
      event.source !== window.parent
      || !payload
      || payload.type !== config.scrollRequestType
      || payload.channelToken !== config.channelToken
    ) return;
    window.scrollTo({
      top: Math.max(0, Number(payload.scrollTop) || 0),
      left: window.scrollX,
      behavior: "auto",
    });
  });
  let scrollFrame = 0;
  let scrollTimer = 0;
  let lastScrollPublishedAt = 0;
  const publishScroll = () => {
    scrollFrame = 0;
    const elapsed = performance.now() - lastScrollPublishedAt;
    if (elapsed < 100) {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(publishScroll, 100 - elapsed);
      return;
    }
    lastScrollPublishedAt = performance.now();
    window.parent.postMessage({
      type: config.scrollEventType,
      channelToken: config.channelToken,
      scrollTop: Math.max(0, Number(window.scrollY) || 0),
    }, "*");
  };
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(publishScroll);
  }, { passive: true });

  // Read-only comment markers. The host resolves which source nodes carry a
  // comment and asks only for their positions; no comment text ever enters the
  // page. Positions are viewport-relative, so the host overlay can place a
  // marker without knowing anything about the page's scroll model.
  let commentTargets = [];
  let commentFrame = 0;

  const measureComments = () => {
    const layouts = [];
    for (const target of commentTargets) {
      let element = null;
      try {
        element = document.querySelector(
          "[" + config.sourceNodeAttribute + '="' + target.nodeId + '"]',
        );
      } catch {
        element = null;
      }
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      // A collapsed box means the node is not laid out. Skip it rather than
      // pinning a marker to the page origin.
      if (rect.width === 0 && rect.height === 0) continue;
      layouts.push({
        key: target.key,
        left: rect.left + rect.width,
        top: rect.top,
      });
    }
    window.parent.postMessage({
      type: config.commentLayoutType,
      channelToken: config.channelToken,
      layouts,
    }, "*");
  };

  const scheduleCommentMeasure = () => {
    if (commentFrame) return;
    commentFrame = window.requestAnimationFrame(() => {
      commentFrame = 0;
      measureComments();
    });
  };

  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (
      event.source !== window.parent
      || !payload
      || payload.type !== config.commentRequestType
      || payload.channelToken !== config.channelToken
      || !Array.isArray(payload.targets)
    ) return;
    commentTargets = payload.targets
      .filter((target) => (
        target
        && typeof target.key === "string"
        && typeof target.nodeId === "string"
      ))
      .slice(0, config.maxCommentTargets);
    scheduleCommentMeasure();
  });

  window.addEventListener("scroll", scheduleCommentMeasure, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", scheduleCommentMeasure, { passive: true });
})();
`;
}

function randomToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function doctypeString(doctype: DocumentType | null): string {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

function baseHrefFromSourcePath(sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined;
  const trimmedPath = sourcePath.trim();
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
  const encodedPath = directoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encodedPath}`;
}

function preparePreviewDocument(
  source: string,
  {
    baseUrl,
    externalBootstrap,
  }: {
    baseUrl?: string;
    externalBootstrap: boolean;
  },
): {
  html: string;
  sourceSha256: string;
  channelToken: string;
  bootstrapJavaScript: string;
  sourceIndex: ReturnType<typeof buildSourceIndex>;
} {
  const sourceIndex = buildSourceIndex(source);
  const channelToken = randomToken();
  const bootstrapJavaScript = previewBootstrapJavaScript({
    channelToken,
    sourceSha256: sourceIndex.sourceSha256,
  });
  if (typeof DOMParser === "undefined") {
    return {
      html: source,
      sourceSha256: sourceIndex.sourceSha256,
      channelToken,
      bootstrapJavaScript,
      sourceIndex,
    };
  }

  const parsed = new DOMParser().parseFromString(source, "text/html");
  if (baseUrl && !parsed.head.querySelector("base")) {
    const base = parsed.createElement("base");
    base.href = baseUrl;
    base.setAttribute(PREVIEW_BASE_ATTRIBUTE, "true");
    parsed.head.prepend(base);
  }

  const bootstrap = parsed.createElement("script");
  bootstrap.setAttribute(PREVIEW_BOOTSTRAP_ATTRIBUTE, "true");
  if (externalBootstrap) {
    bootstrap.src = PREVIEW_BOOTSTRAP_PATH;
  } else {
    bootstrap.textContent = bootstrapJavaScript;
  }
  parsed.head.prepend(bootstrap);

  return {
    html: `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`,
    sourceSha256: sourceIndex.sourceSha256,
    channelToken,
    bootstrapJavaScript,
    sourceIndex,
  };
}

const HtmlInteractionPreview = forwardRef<
  HtmlInteractionPreviewHandle,
  HtmlInteractionPreviewProps
>(function HtmlInteractionPreview({
  html,
  documentKey,
  sourcePath,
  height = "100%",
  transport = "srcdoc",
  staticFallbackOnFailure = false,
  openReason = "initial-open",
  comments,
  onInteraction,
  onDisplayResult,
  initialScrollTop,
  onScrollTopChange,
}, forwardedRef) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  useEffect(() => {
    onScrollTopChangeRef.current = onScrollTopChange;
  }, [onScrollTopChange]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sessionGenerationRef = useRef(0);
  const loadCompletionSequenceRef = useRef(0);
  const visualReadyCleanupRef = useRef<(() => void) | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [desktopSession, setDesktopSession] = useState<DesktopPreviewSession | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const terminalAttemptRef = useRef<string | null>(null);
  const reloadAttemptRef = useRef<{
    current: string;
    next: string;
    startedAt: number;
    targetType: string;
    actionReason: PreviewOpenReason | "retry";
  } | null>(null);
  const [commentLayouts, setCommentLayouts] = useState<PreviewCommentLayout[]>([]);
  const independentTransport = transport === "independent-url";
  const reload = useCallback(() => {
    visualReadyCleanupRef.current?.();
    loadCompletionSequenceRef.current += 1;
    const attempt = reloadAttemptRef.current;
    if (attempt) {
      if (terminalAttemptRef.current !== attempt.current) {
        performance.mark("stemmio:preview:display-result", {
          detail: Object.freeze({
            attemptId: attempt.current,
            targetType: attempt.targetType,
            actionReason: attempt.actionReason,
            status: "cancelled",
            cancelReason: "retry",
            elapsedMs: Math.max(0, Math.round(performance.now() - attempt.startedAt)),
          }),
        });
        onDisplayResult?.({ status: "cancelled", attemptId: attempt.current });
      }
      terminalAttemptRef.current = attempt.current;
      // Fence old callbacks before React mounts the retry iframe.
      onDisplayResult?.({ status: "pending", attemptId: attempt.next });
    }
    setFrameReady(false);
    setLoadFailed(false);
    setCommentLayouts([]);
    setReloadRevision((revision) => revision + 1);
  }, [onDisplayResult]);
  const prepared = useMemo(
    () => preparePreviewDocument(html, {
      baseUrl: independentTransport
        ? undefined
        : baseHrefFromSourcePath(sourcePath),
      externalBootstrap: independentTransport,
    }),
    [html, independentTransport, sourcePath],
  );
  const attemptId = `${prepared.channelToken}:${reloadRevision}`;
  useLayoutEffect(() => {
    reloadAttemptRef.current = {
      current: attemptId,
      next: `${prepared.channelToken}:${reloadRevision + 1}`,
      startedAt: attemptMetadataRef.current.startedAt,
      targetType: attemptMetadataRef.current.targetType,
      actionReason: attemptMetadataRef.current.actionReason,
    };
  }, [attemptId, prepared.channelToken, reloadRevision]);
  const attemptMetadataRef = useRef<{
    attemptId: string;
    targetType: string;
    actionReason: PreviewOpenReason | "retry";
    startedAt: number;
  }>({
    attemptId,
    targetType: staticFallbackOnFailure ? "history" : independentTransport ? "current" : "browser",
    actionReason: reloadRevision > 0 ? "retry" : openReason,
    startedAt: performance.now(),
  });
  if (attemptMetadataRef.current.attemptId !== attemptId) {
    attemptMetadataRef.current = {
      attemptId,
      targetType: staticFallbackOnFailure ? "history" : independentTransport ? "current" : "browser",
      actionReason: reloadRevision > 0 ? "retry" : openReason,
      startedAt: performance.now(),
    };
  }
  const attemptMetadata = attemptMetadataRef.current;
  const recordPreviewStage = useCallback((stage: string, detail: Record<string, unknown> = {}) => {
    performance.mark(`stemmio:preview:${stage}`, {
      detail: Object.freeze({
        attemptId,
        targetType: attemptMetadata.targetType,
        actionReason: attemptMetadata.actionReason,
        elapsedMs: Math.max(0, Math.round(performance.now() - attemptMetadata.startedAt)),
        ...detail,
      }),
    });
  }, [attemptId, attemptMetadata]);

  useEffect(() => {
    terminalAttemptRef.current = null;
    recordPreviewStage("attempt-start");
    onDisplayResult?.({ status: "pending", attemptId });
    return () => {
      visualReadyCleanupRef.current?.();
      if (terminalAttemptRef.current !== attemptId) {
        recordPreviewStage("display-result", { status: "cancelled" });
        onDisplayResult?.({ status: "cancelled", attemptId });
      }
    };
  }, [attemptId, onDisplayResult, recordPreviewStage]);

  // Comment markers are derived in this trusted host. The page receives only
  // marker keys and source-node identities; comment text never crosses into it.
  const commentGroups = useMemo<PreviewCommentGroup[]>(
    () => previewCommentMarkerGroups(prepared.sourceIndex, comments ?? []),
    [comments, prepared.sourceIndex],
  );
  const commentGroupKeys = useMemo(
    () => new Set(commentGroups.map((group) => group.key)),
    [commentGroups],
  );

  useEffect(() => {
    setCommentLayouts([]);
  }, [prepared.channelToken]);

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || !frameReady || loadFailed) return undefined;
    if (commentGroups.length === 0) {
      setCommentLayouts([]);
      return undefined;
    }
    const handleLayout = (event: MessageEvent) => {
      const payload = event.data;
      if (
        event.source !== frameWindow
        || !payload
        || payload.type !== COMMENT_LAYOUT_RESPONSE_TYPE
        || payload.channelToken !== prepared.channelToken
      ) return;
      setCommentLayouts(
        safePreviewCommentLayouts(payload.layouts, commentGroupKeys),
      );
    };
    window.addEventListener("message", handleLayout);
    frameWindow.postMessage({
      type: COMMENT_MEASURE_REQUEST_TYPE,
      channelToken: prepared.channelToken,
      targets: previewCommentMeasureRequest(commentGroups)
        .slice(0, MAX_PREVIEW_COMMENT_GROUPS),
    }, "*");
    return () => window.removeEventListener("message", handleLayout);
  }, [
    commentGroupKeys,
    commentGroups,
    frameReady,
    loadFailed,
    prepared.channelToken,
  ]);

  useEffect(() => {
    if (!independentTransport) {
      setDesktopSession(null);
      setFrameReady(false);
      setLoadFailed(false);
      sessionGenerationRef.current += 1;
      return undefined;
    }
    const previewApi = window.stemmioPreview;
    let cancelled = false;
    let createdSession: DesktopPreviewSession | null = null;
    setDesktopSession(null);
    setFrameReady(false);
    setLoadFailed(false);
    sessionGenerationRef.current += 1;
    if (!previewApi) {
      setLoadFailed(true);
      if (!staticFallbackOnFailure) {
        terminalAttemptRef.current = attemptId;
        recordPreviewStage("display-result", { status: "failed", reason: "session-unavailable" });
        onDisplayResult?.({ status: "failed", attemptId, reason: "session-unavailable" });
      }
      return undefined;
    }
    const releaseSession = (sessionId: string) => {
      void previewApi.revokeSession(sessionId).then((result) => {
        recordPreviewStage("session-released", { released: result.revoked === true });
      }).catch(() => {
        recordPreviewStage("session-released", { released: false });
      });
    };
    recordPreviewStage("session-create");
    void previewApi.createSession({
      html: prepared.html,
      bootstrapJavaScript: prepared.bootstrapJavaScript,
      ...(sourcePath ? { sourcePath } : {}),
    }).then((session) => {
      createdSession = session;
      recordPreviewStage("session-created");
      if (cancelled) {
        releaseSession(session.sessionId);
        return;
      }
      setDesktopSession(session);
    }).catch(() => {
      if (!cancelled) {
        recordPreviewStage("session-create-failed");
        setLoadFailed(true);
        if (!staticFallbackOnFailure) {
          terminalAttemptRef.current = attemptId;
          recordPreviewStage("display-result", { status: "failed", reason: "session-create-failed" });
          onDisplayResult?.({ status: "failed", attemptId, reason: "session-create-failed" });
        }
      }
    });
    return () => {
      cancelled = true;
      if (createdSession) {
        releaseSession(createdSession.sessionId);
      }
    };
  }, [
    independentTransport,
    prepared.bootstrapJavaScript,
    prepared.html,
    reloadRevision,
    sourcePath,
    attemptId,
    onDisplayResult,
    recordPreviewStage,
    staticFallbackOnFailure,
  ]);

  useImperativeHandle(forwardedRef, () => ({
    reload,
    capturePageViewContext: () => new Promise<PageViewContext | null>((resolve) => {
      const iframe = iframeRef.current;
      const frameWindow = iframe?.contentWindow;
      if (!iframe || !frameWindow || !frameReady || loadFailed) {
        resolve(null);
        return;
      }
      const requestId = randomToken();
      let settled = false;
      const finish = (context: PageViewContext | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", handleMessage);
        window.clearTimeout(timeoutId);
        resolve(context);
      };
      const handleMessage = (event: MessageEvent) => {
        const payload = event.data;
        if (
          event.source !== frameWindow
          || !payload
          || payload.type !== CAPTURE_RESPONSE_TYPE
          || payload.channelToken !== prepared.channelToken
          || payload.requestId !== requestId
        ) return;
        finish(createPageViewContext({
          html,
          documentKey,
          generation: sessionGenerationRef.current,
          snapshot: payload.snapshot as RawPageViewSnapshot,
        }));
      };
      const timeoutId = window.setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
      window.addEventListener("message", handleMessage);
      frameWindow.postMessage({
        type: CAPTURE_REQUEST_TYPE,
        channelToken: prepared.channelToken,
        requestId,
      }, "*");
    }),
  }), [
    documentKey,
    frameReady,
    html,
    loadFailed,
    prepared.channelToken,
    reload,
  ]);

  useEffect(() => {
    if (!frameReady || !Number.isFinite(Number(initialScrollTop))) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: SCROLL_REQUEST_TYPE,
      channelToken: prepared.channelToken,
      scrollTop: Math.max(0, Number(initialScrollTop)),
    }, "*");
  }, [frameReady, initialScrollTop, prepared.channelToken]);

  useEffect(() => {
    if (!frameReady) return undefined;
    const frameWindow = iframeRef.current?.contentWindow;
    const receiveScroll = (event: MessageEvent) => {
      const payload = event.data;
      if (
        event.source !== frameWindow
        || payload?.type !== SCROLL_EVENT_TYPE
        || payload?.channelToken !== prepared.channelToken
      ) return;
      onScrollTopChangeRef.current?.(Math.max(0, Number(payload.scrollTop) || 0));
    };
    window.addEventListener("message", receiveScroll);
    return () => window.removeEventListener("message", receiveScroll);
  }, [frameReady, prepared.channelToken]);

  const staticFallback = staticFallbackOnFailure && loadFailed;
  const frameSource = independentTransport
    ? desktopSession?.url
    : undefined;
  const frameSandbox = independentTransport
    ? INDEPENDENT_PREVIEW_SANDBOX
    : SRCDOC_PREVIEW_SANDBOX;
  return (
    <div
      className={styles.preview}
      data-reload-revision={reloadRevision}
      data-testid="html-interaction-preview"
      style={{ "--preview-height": height } as CSSProperties}
      onPointerDown={onInteraction}
    >
      {staticFallback ? <p role="status">动态内容暂时不可用，正在显示只读静态内容。可刷新重试。</p> : null}
      <div className={styles.viewport} ref={viewportRef}>
        <iframe
          ref={iframeRef}
          key={staticFallback ? `static-${reloadRevision}` : independentTransport
            ? desktopSession?.sessionId ?? `pending-${reloadRevision}`
            : reloadRevision}
          className={styles.frame}
          title="HTML 交互预览"
          {...(staticFallback ? { srcDoc: prepared.html } : independentTransport
            ? { src: frameSource ?? "about:blank" }
            : { srcDoc: prepared.html })}
          sandbox={staticFallback ? "" : frameSandbox}
          allow="autoplay; clipboard-write; fullscreen; picture-in-picture"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const loadedFrame = event.currentTarget;
            if (
              iframeRef.current !== loadedFrame
              || (independentTransport && !staticFallback && desktopSession
                && loadedFrame.getAttribute("src") !== desktopSession.url)
            ) return;
            if (independentTransport && !desktopSession && !staticFallback) return;
            recordPreviewStage("iframe-loaded");
            visualReadyCleanupRef.current?.();
            const sessionGeneration = sessionGenerationRef.current;
            const loadSequence = ++loadCompletionSequenceRef.current;
            let completed = false;
            const finish = (result: "verified" | "paint-timeout" | "host-timeout" | "history-static") => {
              if (completed) return;
              completed = true;
              visualReadyCleanupRef.current?.();
              window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                if (
                  !loadedFrame?.isConnected
                  || iframeRef.current !== loadedFrame
                  || sessionGenerationRef.current !== sessionGeneration
                  || loadCompletionSequenceRef.current !== loadSequence
                  || terminalAttemptRef.current === attemptId
                ) return;
                setFrameReady(true);
                // A failed desktop session may deliberately serve the
                // script-disabled historical srcDoc. Keep that failure state
                // until an explicit reload starts a fresh session.
                if (!staticFallback) setLoadFailed(false);
                terminalAttemptRef.current = attemptId;
                recordPreviewStage("display-result", {
                  status: result === "verified" ? "verified" : "degraded",
                  ...(result === "verified" ? {} : { reason: result }),
                });
                onDisplayResult?.(result === "verified"
                  ? { status: "verified", attemptId, sourceSha256: prepared.sourceSha256,
                    ...(desktopSession?.sessionId ? { sessionId: desktopSession.sessionId } : {}) }
                  : { status: "degraded", attemptId, sourceSha256: prepared.sourceSha256, reason: result });
              }));
            };
            if (staticFallback) {
              finish("history-static");
              return;
            }
            if (!loadedFrame?.contentWindow) {
              setLoadFailed(true);
              if (!staticFallbackOnFailure) {
                terminalAttemptRef.current = attemptId;
                recordPreviewStage("display-result", { status: "failed", reason: "frame-unavailable" });
                onDisplayResult?.({ status: "failed", attemptId, reason: "frame-unavailable" });
              }
              return;
            }
            const frameWindow = loadedFrame.contentWindow;
            const requestId = randomToken();
            const handleVisualReady = (event: MessageEvent) => {
              const payload = event.data;
              if (
                event.source !== frameWindow
                || payload?.type !== VISUAL_READY_RESPONSE_TYPE
                || payload.channelToken !== prepared.channelToken
                || payload.requestId !== requestId
              ) return;
              if (payload.evidence === "first-contentful-paint") finish("verified");
              else if (payload.evidence === "bounded-no-paint") finish("paint-timeout");
            };
            window.addEventListener("message", handleVisualReady);
            const timeoutId = window.setTimeout(() => finish("host-timeout"), VISUAL_READY_TIMEOUT_MS);
            visualReadyCleanupRef.current = () => {
              window.removeEventListener("message", handleVisualReady);
              window.clearTimeout(timeoutId);
              visualReadyCleanupRef.current = null;
            };
            recordPreviewStage("visual-ready-request");
            frameWindow.postMessage({
              type: VISUAL_READY_REQUEST_TYPE,
              channelToken: prepared.channelToken,
              requestId,
            }, "*");
          }}
          onError={(event) => {
            const failedFrame = event.currentTarget;
            if (
              iframeRef.current !== failedFrame
              || (independentTransport && !staticFallback && desktopSession
                && failedFrame.getAttribute("src") !== desktopSession.url)
            ) return;
            visualReadyCleanupRef.current?.();
            loadCompletionSequenceRef.current += 1;
            setFrameReady(false);
            setLoadFailed(true);
            if (!staticFallbackOnFailure && terminalAttemptRef.current !== attemptId) {
              terminalAttemptRef.current = attemptId;
              recordPreviewStage("display-result", { status: "failed", reason: "frame-error" });
              onDisplayResult?.({ status: "failed", attemptId, reason: "frame-error" });
            }
          }}
        />
        {/*
          * The marker layer sits above the page and stays pointer-transparent,
          * so it never intercepts a click meant for the previewed page. Only
          * the markers themselves take pointer events.
          */}
        <div className={styles.commentLayer} data-testid="preview-comment-layer">
          {commentLayouts.map((layout) => {
            const group = commentGroups.find(
              (candidate) => candidate.key === layout.key,
            );
            if (!group) return null;
            return (
              <ReadOnlyCommentMarker
                key={group.key}
                group={group}
                left={layout.left}
                top={layout.top}
                viewportRef={viewportRef}
                testId="preview-comment-marker"
                bubbleTestId="preview-comment-bubble"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default HtmlInteractionPreview;
