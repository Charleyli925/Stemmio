"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";

type CancelAiRunDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function CancelAiRunDialog({
  open,
  onClose,
  onConfirm,
}: CancelAiRunDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const waitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      waitButtonRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="cancel-ai-run-dialog"
      aria-labelledby="cancel-ai-run-title"
      aria-describedby="cancel-ai-run-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <article className="cancel-ai-run-card">
        <h2 id="cancel-ai-run-title">AI Agent 可能仍在修改</h2>
        <p id="cancel-ai-run-description">
          结束本轮后，AI Agent 的修改将不会保存到源页。建议先停止 AI Agent。
        </p>
        <footer>
          <button
            className="cancel-ai-run-end"
            type="button"
            onClick={onConfirm}
          >
            结束本轮并继续编辑
          </button>
          <button
            ref={waitButtonRef}
            className="cancel-ai-run-wait"
            type="button"
            onClick={onClose}
          >
            继续等待
          </button>
        </footer>
      </article>
    </dialog>
  );
}
