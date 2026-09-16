import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_PATH_LENGTH = 4096;
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export function assertDefaultBrowserSourcePath(
  value,
  { maxPathLength = DEFAULT_MAX_PATH_LENGTH } = {},
) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxPathLength
    || value.includes("\0")
  ) {
    throw new TypeError("sourcePath无效。");
  }

  const sourcePath = path.resolve(value);
  if (!HTML_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
    throw new TypeError("sourcePath必须以 .html 或 .htm 结尾。");
  }
  return sourcePath;
}

export function createOpenInDefaultBrowserOperation({
  authorizeTarget,
  inspectHtmlFile,
  openExternal,
}) {
  if (
    typeof authorizeTarget !== "function"
    || typeof inspectHtmlFile !== "function"
    || typeof openExternal !== "function"
  ) {
    throw new TypeError("默认浏览器操作依赖不完整。");
  }

  return async function openInDefaultBrowser(targetInput) {
    const target = await authorizeTarget(targetInput);
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new TypeError("默认浏览器目标授权无效。");
    }
    const sourcePath = assertDefaultBrowserSourcePath(target.sourcePath);
    await inspectHtmlFile(sourcePath);
    const sourceUrl = pathToFileURL(sourcePath).href;
    await openExternal(sourceUrl);
    return {
      sourcePath,
      targetKind: target.targetKind,
      ...(target.versionId ? { versionId: target.versionId } : {}),
    };
  };
}
