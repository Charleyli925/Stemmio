"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

type AttachmentLightboxProps = {
  fileName: string;
  sizeLabel: string;
  src: string;
  onClose: () => void;
};

export default function AttachmentLightbox({
  fileName,
  sizeLabel,
  src,
  onClose,
}: AttachmentLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
  }, []);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="attachment-lightbox"
      aria-label={`预览图片 ${fileName}`}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <div className="attachment-lightbox-content">
        <div className="attachment-lightbox-header">
          <span>
            <strong>{fileName}</strong>
            <small>{sizeLabel}</small>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭图片预览"
            onClick={() => dialogRef.current?.close()}
          >
            <XIcon aria-hidden="true" size={18} weight="bold" />
          </button>
        </div>
        {/* Blob URLs are project-local attachment previews and cannot use next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={fileName}
        />
      </div>
    </dialog>
  );
}
