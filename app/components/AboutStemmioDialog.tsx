"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import { architectureLabel } from "./update-presentation";

export type AboutStemmioDialogProps = {
  open: boolean;
  appVersion: string;
  architecture?: string | null;
  publicReleasesOpenFailed: boolean;
  userNoticeOpenFailed: boolean;
  onClose: () => void;
  onOpenPublicReleases: () => void;
  onOpenUserNotice: () => void;
};

export default function AboutStemmioDialog({
  open,
  appVersion,
  architecture,
  publicReleasesOpenFailed,
  userNoticeOpenFailed,
  onClose,
  onOpenPublicReleases,
  onOpenUserNotice,
}: AboutStemmioDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open) return undefined;
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [open]);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby="about-stemmio-title"
      aria-describedby="about-stemmio-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <article className="about-dialog-card">
        <button
          ref={closeButtonRef}
          className="about-close-button"
          type="button"
          aria-label="关闭关于源页"
          title="关闭"
          onClick={onClose}
        >
          <XIcon aria-hidden="true" size={17} weight="bold" />
        </button>

        <header className="about-identity">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./brand-logo.png" alt="" />
          <div>
            <h2 id="about-stemmio-title">源页</h2>
            <p id="about-stemmio-description">
              源码级本地 HTML 编辑器。
              <br />
              所见即可改，源文件始终可追溯。
            </p>
          </div>
        </header>

        <div className="about-product-meta" aria-label="应用信息">
          <span>版本 {appVersion || "—"}</span>
          <span>{architectureLabel(architecture)}</span>
        </div>

        <button
          className="about-github-link"
          type="button"
          onClick={onOpenPublicReleases}
        >
          <span className="about-github-icon" aria-hidden="true">
            <GithubLogoIcon size={24} weight="fill" />
          </span>
          <span>
            <strong>Stemmio Releases on GitHub</strong>
            <small>下载、更新说明与产品支持</small>
          </span>
          <ArrowSquareOutIcon aria-hidden="true" size={17} weight="bold" />
        </button>
        {publicReleasesOpenFailed ? (
          <p className="about-link-error" role="alert">
            GitHub 页面没有打开，请检查网络后重试。
          </p>
        ) : null}

        <footer className="about-footer">
          <button
            className="about-user-notice"
            type="button"
            title="使用默认文本应用打开本地文件"
            onClick={onOpenUserNotice}
          >
            <span>用户声明与免责声明</span>
            <ArrowSquareOutIcon aria-hidden="true" size={11} weight="bold" />
          </button>
          {userNoticeOpenFailed ? (
            <p role="alert">
              声明文件没有打开，请重新安装源页后重试。
            </p>
          ) : null}
        </footer>
      </article>
    </dialog>
  );
}
