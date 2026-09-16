"use client";

import { useEffect } from "react";

export function markProjectHydrationStage(
  stage: string,
  operationId?: unknown,
  timing?: unknown,
): void {
  if (typeof window === "undefined") return;
  window.__STEMMIO_HYDRATION_STAGE__ = stage;
  const numericTiming = timing && typeof timing === "object" && !Array.isArray(timing)
    ? Object.fromEntries(Object.entries(timing).filter(([, value]) => (
      typeof value === "number" && Number.isFinite(value) && value >= 0
    )))
    : {};
  const detail = Object.freeze({
    operationId: operationId ? String(operationId) : null,
    timing: Object.freeze(numericTiming),
  });
  const entry = Object.freeze({ stage, startTime: performance.now(), ...detail });
  window.__STEMMIO_PERFORMANCE_TIMELINE__ = [
    ...(window.__STEMMIO_PERFORMANCE_TIMELINE__ || []).slice(-255),
    entry,
  ];
  performance.mark(`stemmio:project:${stage}`, { detail });
}

export function markProjectApplied(operationId: unknown, epoch: unknown): void {
  performance.mark("stemmio:project:applied", {
    detail: Object.freeze({
      operationId: operationId ? String(operationId) : null,
      epoch: Number(epoch) || 0,
    }),
  });
}

export function RendererStartupPerformance() {
  useEffect(() => {
    performance.mark("stemmio:renderer:shell-mounted");
    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        performance.mark("stemmio:renderer:first-paint");
      }, 0);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);
  return null;
}
