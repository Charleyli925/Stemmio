"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ExportHtmlDialog({
  canSaveVersion, saveUnavailableReason, canExport, onClose, onConfirm,
}: {
  canSaveVersion: boolean;
  saveUnavailableReason?: string;
  canExport: boolean;
  onClose: () => void;
  onConfirm: (saveVersion: boolean) => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [saveVersion, setSaveVersion] = useState(true);
  useEffect(() => {
    const dialog = dialogRef.current;
    const focused = document.activeElement;
    const frame = focused instanceof HTMLIFrameElement ? focused : null;
    const nested = frame?.contentDocument?.activeElement as HTMLElement | null;
    returnFrameRef.current = frame;
    returnFocusRef.current = nested && typeof nested.focus === "function"
      ? nested : focused instanceof HTMLElement ? focused : null;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const closeAndRestoreFocus = () => {
    dialogRef.current?.close();
    if (returnFocusRef.current?.isConnected && (!returnFrameRef.current || returnFrameRef.current.isConnected)) {
      returnFocusRef.current.focus({ preventScroll: true });
    }
  };
  const dismiss = () => { closeAndRestoreFocus(); onClose(); };

  return createPortal(
    <dialog ref={dialogRef} className="cancel-ai-run-dialog"
      data-html-canvas-preserve-selection="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}
    >
      <article className="cancel-ai-run-card export-html-card">
        <h2 id={`${id}-title`}>导出当前 HTML</h2>
        <p id={`${id}-description`}>将当前内容保存为一份 HTML 文件。</p>
        <label className="export-html-history-option">
          <input type="checkbox" checked={saveVersion && canSaveVersion}
            disabled={!canSaveVersion} aria-describedby={`${id}-history-help`}
            onChange={(event) => setSaveVersion(event.target.checked)} />
          同时保存到历史版本
        </label>
        <p id={`${id}-history-help`}>
          {canSaveVersion
            ? "在项目历史中保留此刻的内容，之后可随时查看。你可以继续编辑当前稿。"
            : saveUnavailableReason || "当前暂时不能保存历史版本，仍可导出 HTML。"}
        </p>
        <footer>
          <button className="export-html-cancel" type="button" onClick={dismiss}>取消</button>
          <button className="cancel-ai-run-wait" type="button" disabled={!canExport}
            onClick={() => { closeAndRestoreFocus(); onConfirm(saveVersion && canSaveVersion); }}>选择保存位置…</button>
        </footer>
      </article>
    </dialog>, document.body,
  );
}
