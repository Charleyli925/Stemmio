"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";

type HistoryCreationDialogProps = {
  open: boolean;
  versionLabel: string;
  onClose: () => void;
  onConfirm: () => void;
};

export default function HistoryCreationDialog({
  open,
  versionLabel,
  onClose,
  onConfirm,
}: HistoryCreationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const waitButtonRef = useRef<HTMLButtonElement>(null);

  const closeDialog = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const focusFrame = requestAnimationFrame(
        () => waitButtonRef.current?.focus(),
      );
      return () => cancelAnimationFrame(focusFrame);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) closeDialog();
  };

  return (
    <dialog
      ref={dialogRef}
      className="cancel-ai-run-dialog"
      aria-labelledby="history-create-title"
      aria-describedby="history-create-description"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <article className="cancel-ai-run-card">
        <h2 id="history-create-title">基于 {versionLabel} 创建新版本？</h2>
        <p id="history-create-description">
          将以这个历史版本建立当前稿。原有版本和替换前的当前稿都会保留。
        </p>
        <footer>
          <button
            className="cancel-ai-run-end"
            type="button"
            onClick={onConfirm}
          >
            创建并编辑
          </button>
          <button
            ref={waitButtonRef}
            className="cancel-ai-run-wait"
            type="button"
            onClick={closeDialog}
          >
            取消
          </button>
        </footer>
      </article>
    </dialog>
  );
}
