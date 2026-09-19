"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  baseHrefFromSourcePath,
  sanitizeScrollableDisplayDocument,
} from "./html-preview-sandbox.js";
import { usePreviewResourceBase } from "./use-preview-resource-base";
import styles from "./HtmlDisplaySurface.module.css";

type HtmlDisplaySurfaceProps = {
  html: string;
  sourcePath?: string;
  height?: string;
  status?: string | null;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  onFirstScroll?: (scrollTop: number) => void;
  presentationKey?: string;
};

/**
 * A disposable, read-only first-paint surface. It deliberately has no Canvas
 * authority and can never serialize DOM back into source. The final editor
 * replaces it after edit-runtime preparation settles.
 */
export default function HtmlDisplaySurface({
  html,
  sourcePath,
  height = "720px",
  status = null,
  initialScrollTop = 0,
  onScrollTopChange,
  onFirstScroll,
  presentationKey,
}: HtmlDisplaySurfaceProps) {
  const fallbackBase = baseHrefFromSourcePath(sourcePath);
  const { resourceBase, ready } = usePreviewResourceBase(html, sourcePath, false);
  const frameHtml = useMemo(
    () => ready
      ? sanitizeScrollableDisplayDocument(html, resourceBase || fallbackBase)
      : null,
    [fallbackBase, html, ready, resourceBase],
  );
  const [loadedFrameHtml, setLoadedFrameHtml] = useState<string | null>(null);
  const [scrollableFrameHtml, setScrollableFrameHtml] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cleanupScrollRef = useRef<(() => void) | null>(null);
  const firstScrollReportedRef = useRef(false);
  const initialScrollTopRef = useRef(initialScrollTop);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  const onFirstScrollRef = useRef(onFirstScroll);
  useEffect(() => {
    initialScrollTopRef.current = initialScrollTop;
    onScrollTopChangeRef.current = onScrollTopChange;
    onFirstScrollRef.current = onFirstScroll;
  }, [initialScrollTop, onFirstScroll, onScrollTopChange]);

  useEffect(() => () => cleanupScrollRef.current?.(), []);

  return (
    <div
      className={styles.surface}
      style={{ "--html-display-height": height } as CSSProperties}
      data-testid="html-display-surface"
      data-display-ready={frameHtml && loadedFrameHtml === frameHtml ? "true" : "false"}
      data-scrollable-ready={frameHtml && scrollableFrameHtml === frameHtml ? "true" : "false"}
    >
      {status ? <div className={styles.status} role="status">{status}</div> : null}
      {frameHtml ? <iframe
        key={presentationKey || frameHtml}
        ref={frameRef}
        className={styles.frame}
        title="HTML 页面（正在准备编辑）"
        srcDoc={frameHtml}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() => {
          cleanupScrollRef.current?.();
          cleanupScrollRef.current = null;
          firstScrollReportedRef.current = false;
          const frameWindow = frameRef.current?.contentWindow;
          if (frameWindow) {
            let scheduled = false;
            let trailingTimer = 0;
            let lastPublishedAt = 0;
            let acceptingUserScroll = true;
            let restorationPending = Math.max(
              0,
              Number(initialScrollTopRef.current) || 0,
            ) > 0;
            let lastObservedScrollTop = Math.max(0, Number(frameWindow.scrollY) || 0);
            const publishScroll = () => {
              scheduled = false;
              const scrollTop = Math.max(0, Number(frameWindow.scrollY) || 0);
              const elapsed = performance.now() - lastPublishedAt;
              if (elapsed < 100) {
                frameWindow.clearTimeout(trailingTimer);
                trailingTimer = frameWindow.setTimeout(publishScroll, 100 - elapsed);
                return;
              }
              lastPublishedAt = performance.now();
              onScrollTopChangeRef.current?.(scrollTop);
            };
            const handleScroll = () => {
              const scrollTop = Math.max(0, Number(frameWindow.scrollY) || 0);
              const positionChanged = Math.abs(scrollTop - lastObservedScrollTop) >= 0.5;
              lastObservedScrollTop = scrollTop;
              if (
                acceptingUserScroll
                && positionChanged
                && !firstScrollReportedRef.current
              ) {
                restorationPending = false;
                firstScrollReportedRef.current = true;
                lastPublishedAt = performance.now();
                onScrollTopChangeRef.current?.(scrollTop);
                performance.mark("stemmio:document:first-scroll-response");
                onFirstScrollRef.current?.(scrollTop);
              }
              if (scheduled) return;
              scheduled = true;
              frameWindow.requestAnimationFrame(publishScroll);
            };
            frameWindow.addEventListener("scroll", handleScroll, { passive: true });
            cleanupScrollRef.current = () => {
              frameWindow.clearTimeout(trailingTimer);
              frameWindow.removeEventListener("scroll", handleScroll);
            };
            performance.mark("stemmio:document:scrollable-ready");
            setScrollableFrameHtml(frameHtml);
            if (restorationPending) frameWindow.requestAnimationFrame(() => {
              if (!restorationPending) return;
              acceptingUserScroll = false;
              frameWindow.scrollTo({
                top: Math.max(0, Number(initialScrollTopRef.current) || 0),
                left: 0,
                behavior: "auto",
              });
              lastObservedScrollTop = Math.max(0, Number(frameWindow.scrollY) || 0);
              restorationPending = false;
              acceptingUserScroll = true;
            });
          }
          setLoadedFrameHtml(frameHtml);
          performance.mark("stemmio:document:static-frame-loaded");
        }}
      /> : null}
    </div>
  );
}
