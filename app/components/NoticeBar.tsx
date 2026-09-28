"use client";

import { useEffect, useRef } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import styles from "./NoticeBar.module.css";

export type NoticeTone = "success" | "info" | "warning" | "error";
export type NoticeUsageCapture = (
  event: string,
  properties: Record<string, string | number | boolean | null | undefined>,
  projectId?: string,
) => void;

export type NoticeBarProps = {
  title: string;
  message: string;
  identity?: string;
  tone?: NoticeTone;
  placement?: "viewport" | "canvas";
  actionLabel?: string;
  dismissLabel?: string;
  className?: string;
  onAction?: () => void;
  onDismiss: () => void;
  onPauseChange?: (paused: boolean) => void;
  dismissMs?: number | null;
  paused?: boolean;
  repeatCount?: number;
  usageCode?: string;
  usageDisposition?: string;
  usageSurface?: "canvas" | "global" | "native" | "panel";
  usageProjectId?: string;
  usageCapture?: NoticeUsageCapture;
};

function NoticeToneIcon({ tone }: { tone: NoticeTone }) {
  if (tone === "success") {
    return <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  if (tone === "warning") {
    return <WarningCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  if (tone === "error") {
    return <XCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  return <InfoIcon aria-hidden="true" size={18} weight="bold" />;
}

export default function NoticeBar({
  title,
  message,
  identity,
  tone = "info",
  placement = "viewport",
  actionLabel,
  dismissLabel = "关闭提醒",
  className,
  onAction,
  onDismiss,
  onPauseChange,
  dismissMs = null,
  paused = false,
  repeatCount = 1,
  usageCode,
  usageDisposition = "inform-in-place",
  usageSurface,
  usageProjectId,
  usageCapture,
}: NoticeBarProps) {
  const pointerInsideRef = useRef(false);
  const focusWithinRef = useRef(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const onPauseChangeRef = useRef(onPauseChange);
  useEffect(() => {
    onPauseChangeRef.current = onPauseChange;
  }, [onPauseChange]);
  useEffect(() => () => {
    onPauseChangeRef.current?.(false);
  }, []);
  useEffect(() => {
    if (!identity || !elementRef.current) return;
    const element = elementRef.current;
    pointerInsideRef.current = element.matches(":hover");
    focusWithinRef.current = element.contains(element.ownerDocument.activeElement);
    onPauseChangeRef.current?.(pointerInsideRef.current || focusWithinRef.current);
  }, [identity]);
  const publishPauseState = () => {
    onPauseChange?.(pointerInsideRef.current || focusWithinRef.current);
  };
  const classes = [
    styles.notice,
    styles[placement],
    styles.visible,
    className,
    className === "toast" ? "show" : null,
  ].filter(Boolean).join(" ");
  const telemetrySurface = usageSurface
    || (placement === "canvas" ? "canvas" : "global");
  const hasUsageAction = Boolean(actionLabel && onAction);

  useEffect(() => {
    if (!usageCode) return;
    usageCapture?.("notification_presented", {
      notice_code: usageCode,
      tone,
      disposition: usageDisposition,
      surface: telemetrySurface,
      has_action: hasUsageAction,
    }, usageProjectId);
  }, [
    hasUsageAction,
    telemetrySurface,
    tone,
    usageCode,
    usageDisposition,
    usageProjectId,
    usageCapture,
  ]);

  const reportInteraction = (interaction: "action" | "dismiss") => {
    if (!usageCode) return;
    usageCapture?.("notification_interacted", {
      notice_code: usageCode,
      interaction,
      surface: telemetrySurface,
    }, usageProjectId);
  };

  return (
    <section
      ref={elementRef}
      className={classes}
      data-tone={tone}
      data-paused={paused ? "true" : undefined}
      data-dismissible={dismissMs ? "true" : undefined}
      style={dismissMs ? { ["--notice-dismiss-ms" as string]: `${dismissMs}ms` } : undefined}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={() => {
        pointerInsideRef.current = true;
        publishPauseState();
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
        publishPauseState();
      }}
      onFocusCapture={() => {
        focusWithinRef.current = true;
        publishPauseState();
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          focusWithinRef.current = false;
          publishPauseState();
        }
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        <NoticeToneIcon tone={tone} />
        {repeatCount > 1 ? (
          <span className={styles.repeat}>{repeatCount}</span>
        ) : null}
      </span>
      <span className={styles.copy}>
        <strong>{title}</strong>
        <span>{message}</span>
      </span>
      <span className={styles.actions}>
        {actionLabel && onAction ? (
          <button
            className={styles.action}
            type="button"
            onClick={() => {
              reportInteraction("action");
              onAction();
            }}
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          className={styles.close}
          type="button"
          aria-label={dismissLabel}
          onClick={() => {
            reportInteraction("dismiss");
            onDismiss();
          }}
        >
          <XIcon aria-hidden="true" size={15} weight="bold" />
        </button>
      </span>
      {dismissMs ? <span className={styles.progress} aria-hidden="true" /> : null}
    </section>
  );
}
