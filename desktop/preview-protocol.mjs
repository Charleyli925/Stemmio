import { randomBytes } from "node:crypto";
import {
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse, serialize } from "parse5";

import { authoredDocumentBase } from "../app/domain/edit-runtime-contract.js";

export const PREVIEW_PROTOCOL_SCHEME = "stemmio-preview";
export const PREVIEW_BOOTSTRAP_PATH = "/.stemmio/preview-bootstrap.js";

const DEFAULT_MAX_HTML_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_DECLARED_ASSETS = 256;
const DEFAULT_MAX_DEPENDENCY_SCAN_BYTES = 2 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const ASSET_REFERENCE_ORIGIN = "https://stemmio-preview.invalid";
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const FONT_EXTENSIONS = new Set([".otf", ".ttf", ".woff", ".woff2"]);
const MEDIA_EXTENSIONS = new Set([
  ".m4a",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".ogv",
  ".wav",
  ".webm",
]);
const CSS_URL_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...FONT_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
]);
const PREVIEW_DOCUMENT_CSP = [
  "default-src 'self' http: https: data: blob:",
  "script-src 'self' http: https: data: blob: 'unsafe-inline'",
  "style-src 'self' http: https: data: blob: 'unsafe-inline'",
  "img-src 'self' http: https: data: blob:",
  "font-src 'self' http: https: data: blob:",
  "media-src 'self' http: https: data: blob:",
  "connect-src 'self' http: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' http: https:",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");
const PREVIEW_NAVIGATION_FALLBACK_CSP = [
  "default-src 'self' http: https: data: blob:",
  "script-src 'self'",
  "style-src 'self' http: https: data: blob: 'unsafe-inline'",
  "img-src 'self' http: https: data: blob:",
  "font-src 'self' http: https: data: blob:",
  "media-src 'self' http: https: data: blob:",
  "connect-src 'self' http: https:",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");
const PREVIEW_BOOTSTRAP_ATTRIBUTES = new Set([
  "data-stemmio-ai-review-bootstrap",
  "data-stemmio-preview-bootstrap",
]);
const PREVIEW_NAVIGATION_FALLBACK_ATTRIBUTE =
  "data-stemmio-preview-navigation-fallback";

let schemePrivilegesRegistered = false;

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function response(body, status, contentType, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function notFound() {
  return response("Not found", 404, "text/plain; charset=utf-8");
}

function invalidRequest() {
  return response("Invalid preview request", 400, "text/plain; charset=utf-8");
}

function isContainedPath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolvePreviewSourceRoot(sourcePath) {
  if (sourcePath === undefined || sourcePath === null || sourcePath === "") {
    return null;
  }
  if (
    typeof sourcePath !== "string"
    || sourcePath.length > 4096
    || !path.isAbsolute(sourcePath)
  ) {
    throw new TypeError("Preview sourcePath must be an absolute local path.");
  }
  const sourceRealPath = await realpath(sourcePath);
  const sourceInfo = await stat(sourceRealPath);
  if (sourceInfo.isDirectory()) {
    return sourceRealPath;
  }
  if (!sourceInfo.isFile()) {
    throw new TypeError(
      "Preview sourcePath must resolve to a regular file or directory.",
    );
  }
  return realpath(path.dirname(sourceRealPath));
}

export function normalizeRelativeAssetPath(value, basePath = "") {
  if (typeof value !== "string") return null;
  const reference = value.trim();
  if (!reference || reference.length > 4096 || reference.startsWith("#")) {
    return null;
  }

  let parsed;
  try {
    const baseUrl = new URL(
      `${ASSET_REFERENCE_ORIGIN}/${basePath.replace(/^\/+|\/+$/gu, "")}`,
    );
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
    parsed = new URL(reference, baseUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== ASSET_REFERENCE_ORIGIN) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (!decodedPath || decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return null;
  }
  const normalizedPath = path.posix.normalize(decodedPath).replace(/^\/+/, "");
  if (
    !normalizedPath
    || normalizedPath === "."
    || normalizedPath === ".."
    || normalizedPath.startsWith("../")
  ) return null;
  if (normalizedPath.split("/").some((segment) => segment.startsWith("."))) {
    return null;
  }
  return normalizedPath;
}

function extensionForAsset(relativePath) {
  return path.posix.extname(relativePath).toLowerCase();
}

function isAllowedAssetType(relativePath, extensions) {
  return extensions.has(extensionForAsset(relativePath));
}

function attributesFor(node) {
  return new Map((node.attrs || []).map((attribute) => [
    String(attribute.name || "").toLowerCase(),
    String(attribute.value || ""),
  ]));
}

/**
 * Resolves the first authored <base href> inside the authorized source root.
 * Runtime and declared-asset preparation share this result so a relative base
 * can never make Main freeze one file while the visible frame requests another.
 */
export function resolveContainedDocumentBase(html) {
  const base = authoredDocumentBase(html);
  if (!base) {
    return Object.freeze({ documentPath: "/", basePath: "" });
  }
  const href = String(base.href || "").trim();
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(href)) return null;
  const pathReference = href.split(/[?#]/u, 1)[0];
  let decodedReference;
  try {
    decodedReference = decodeURIComponent(pathReference);
  } catch {
    return null;
  }
  if (
    decodedReference.includes("\0")
    || decodedReference.includes("\\")
    || decodedReference.split("/").some((segment) => (
      segment === ".." || (segment.startsWith(".") && segment !== ".")
    ))
  ) return null;
  let parsed;
  try {
    parsed = new URL(href, `${ASSET_REFERENCE_ORIGIN}/`);
  } catch {
    return null;
  }
  if (parsed.origin !== ASSET_REFERENCE_ORIGIN) return null;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;
  const normalized = path.posix.normalize(decodedPath);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) {
    return null;
  }
  const rootedPath = normalized === "."
    ? "/"
    : `${normalized.startsWith("/") ? "" : "/"}${normalized}`;
  const documentPath = parsed.pathname.endsWith("/")
    && rootedPath !== "/"
    && !rootedPath.endsWith("/")
    ? `${rootedPath}/`
    : rootedPath;
  const relativeDocumentPath = documentPath.replace(/^\/+|\/+$/gu, "");
  const basePath = documentPath.endsWith("/")
    ? relativeDocumentPath
    : path.posix.dirname(relativeDocumentPath) === "."
      ? ""
      : path.posix.dirname(relativeDocumentPath);
  return Object.freeze({ documentPath, basePath });
}

function isOwnedPreviewBootstrap(node) {
  if (String(node?.tagName || "").toLowerCase() !== "script") return false;
  const attributes = attributesFor(node);
  return attributes.get("src") === PREVIEW_BOOTSTRAP_PATH
    && [...PREVIEW_BOOTSTRAP_ATTRIBUTES].some(
      (attribute) => attributes.get(attribute) === "true",
    );
}

function scriptlessNavigationFallback(html) {
  const document = parse(html);
  let keptBootstrap = false;
  let documentElement = null;
  const visit = (node) => {
    if (String(node?.tagName || "").toLowerCase() === "html") {
      documentElement = node;
    }
    if (Array.isArray(node?.childNodes)) {
      node.childNodes = node.childNodes.filter((child) => {
        if (String(child?.tagName || "").toLowerCase() !== "script") return true;
        if (!keptBootstrap && isOwnedPreviewBootstrap(child)) {
          keptBootstrap = true;
          return true;
        }
        return false;
      });
      node.childNodes.forEach(visit);
    }
    if (node?.content) visit(node.content);
  };
  visit(document);
  if (documentElement) {
    documentElement.attrs = (documentElement.attrs || []).filter(
      (attribute) => attribute.name !== PREVIEW_NAVIGATION_FALLBACK_ATTRIBUTE,
    );
    documentElement.attrs.push({
      name: PREVIEW_NAVIGATION_FALLBACK_ATTRIBUTE,
      value: "true",
    });
  }
  return serialize(document);
}

function appendSrcSetReferences(value, extensions, append) {
  if (typeof value !== "string") return;
  for (const candidate of value.split(",")) {
    const reference = candidate.trim().split(/\s+/u)[0];
    if (reference) append(reference, extensions);
  }
}

function textContentFor(node) {
  if (typeof node?.value === "string") return node.value;
  return (node?.childNodes || []).map((child) => textContentFor(child)).join("");
}

function collectHtmlAssetReferences(html, documentBasePath = "") {
  const references = [];
  const append = (value, extensions) => {
    references.push({ value, extensions, basePath: documentBasePath });
  };
  const visit = (node) => {
    const tagName = String(node.tagName || "").toLowerCase();
    const attributes = attributesFor(node);
    const inlineStyle = cssReferences(attributes.get("style") || "");
    for (const value of inlineStyle.urls) {
      append(value, CSS_URL_EXTENSIONS);
    }
    if (tagName === "script") {
      append(attributes.get("src"), SCRIPT_EXTENSIONS);
      if (
        !attributes.get("src")
        && (attributes.get("type") || "").trim().toLowerCase() === "module"
      ) {
        for (const value of javaScriptImports(textContentFor(node))) {
          append(value, SCRIPT_EXTENSIONS);
        }
      }
    } else if (tagName === "style") {
      const inlineStylesheet = cssReferences(textContentFor(node));
      for (const value of inlineStylesheet.imports) {
        append(value, STYLE_EXTENSIONS);
      }
      for (const value of inlineStylesheet.urls) {
        append(value, CSS_URL_EXTENSIONS);
      }
    } else if (tagName === "link") {
      const rel = (attributes.get("rel") || "")
        .toLowerCase()
        .split(/\s+/u);
      if (rel.includes("stylesheet")) {
        append(attributes.get("href"), STYLE_EXTENSIONS);
      } else if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
        append(attributes.get("href"), IMAGE_EXTENSIONS);
      } else if (rel.includes("preload")) {
        const as = (attributes.get("as") || "").toLowerCase();
        const extensions = as === "style"
          ? STYLE_EXTENSIONS
          : as === "script"
            ? SCRIPT_EXTENSIONS
            : as === "font"
              ? FONT_EXTENSIONS
              : as === "image"
                ? IMAGE_EXTENSIONS
                : MEDIA_EXTENSIONS;
        append(attributes.get("href"), extensions);
      }
    } else if (tagName === "img") {
      append(attributes.get("src"), IMAGE_EXTENSIONS);
      appendSrcSetReferences(attributes.get("srcset"), IMAGE_EXTENSIONS, append);
    } else if (tagName === "source") {
      const type = (attributes.get("type") || "").toLowerCase();
      const extensions = type.startsWith("image/")
        ? IMAGE_EXTENSIONS
        : MEDIA_EXTENSIONS;
      append(attributes.get("src"), extensions);
      appendSrcSetReferences(attributes.get("srcset"), extensions, append);
    } else if (tagName === "video" || tagName === "audio" || tagName === "track") {
      append(attributes.get("src"), MEDIA_EXTENSIONS);
      if (tagName === "video") append(attributes.get("poster"), IMAGE_EXTENSIONS);
    } else if (tagName === "image" || tagName === "use") {
      append(attributes.get("href") || attributes.get("xlink:href"), IMAGE_EXTENSIONS);
    } else if (tagName === "input") {
      if ((attributes.get("type") || "").toLowerCase() === "image") {
        append(attributes.get("src"), IMAGE_EXTENSIONS);
      }
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  try {
    visit(parse(html));
  } catch {
    return [];
  }
  return references;
}

function cssReferences(css) {
  const imports = [];
  const urls = [];
  const importPattern = /@import\s+(?:url\(\s*)?(["']?)([^"'\s)]+)\1\s*\)?/giu;
  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
  for (const match of css.matchAll(importPattern)) imports.push(match[2]);
  for (const match of css.matchAll(urlPattern)) urls.push(match[2]);
  return { imports, urls };
}

function javaScriptImports(source) {
  const references = [];
  const pattern = /(?:\bimport\s*(?:[\w*${},\s]*?\s+from\s*)?|\bexport\s+(?:[\w*${},\s]*?\s+from\s*)?|\bimport\s*\(\s*)(["'])([^"']+)\1/giu;
  for (const match of source.matchAll(pattern)) references.push(match[2]);
  return references;
}

function throwIfAssetDiscoveryAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Preview asset discovery was aborted.");
}

async function resolveDeclaredAsset(sourceRoot, relativePath, signal) {
  throwIfAssetDiscoveryAborted(signal);
  const candidatePath = path.resolve(
    sourceRoot,
    ...relativePath.split("/"),
  );
  if (!isContainedPath(sourceRoot, candidatePath)) return null;
  try {
    const resolvedPath = await realpath(candidatePath);
    throwIfAssetDiscoveryAborted(signal);
    if (!isContainedPath(sourceRoot, resolvedPath)) return null;
    const fileInfo = await stat(resolvedPath);
    throwIfAssetDiscoveryAborted(signal);
    return fileInfo.isFile() ? resolvedPath : null;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return null;
  }
}

export async function collectDeclaredPreviewAssets({
  html,
  sourceRoot,
  documentBasePath = "",
  maxAssets = DEFAULT_MAX_DECLARED_ASSETS,
  maxReferences = DEFAULT_MAX_DECLARED_ASSETS,
  maxDependencyScanBytes = DEFAULT_MAX_DEPENDENCY_SCAN_BYTES,
  signal,
}) {
  const assets = new Map();
  const cssQueue = [];
  const scriptQueue = [];
  const pendingReferences = collectHtmlAssetReferences(html, documentBasePath);
  const referenceLimit = Math.max(0, Math.floor(Number(maxReferences)) || 0);
  let referenceCount = 0;

  const add = async ({ value, extensions, basePath = "" }) => {
    throwIfAssetDiscoveryAborted(signal);
    const relativePath = normalizeRelativeAssetPath(value, basePath);
    if (
      !relativePath
      || !isAllowedAssetType(relativePath, extensions)
      || assets.has(relativePath)
      || assets.size >= maxAssets
      || referenceCount >= referenceLimit
    ) return;
    referenceCount += 1;
    const resolvedPath = await resolveDeclaredAsset(sourceRoot, relativePath, signal);
    if (!resolvedPath) return;
    const asset = Object.freeze({ relativePath, resolvedPath });
    assets.set(relativePath, asset);
    const extension = extensionForAsset(relativePath);
    if (STYLE_EXTENSIONS.has(extension)) cssQueue.push(asset);
    if (SCRIPT_EXTENSIONS.has(extension)) scriptQueue.push(asset);
  };

  while (pendingReferences.length > 0) {
    throwIfAssetDiscoveryAborted(signal);
    await add(pendingReferences.shift());
  }

  for (let index = 0; index < cssQueue.length; index += 1) {
    throwIfAssetDiscoveryAborted(signal);
    const stylesheet = cssQueue[index];
    try {
      const info = await stat(stylesheet.resolvedPath);
      throwIfAssetDiscoveryAborted(signal);
      if (info.size > maxDependencyScanBytes) continue;
      const source = await readFile(stylesheet.resolvedPath, {
        encoding: "utf8",
        ...(signal ? { signal } : {}),
      });
      throwIfAssetDiscoveryAborted(signal);
      const basePath = path.posix.dirname(stylesheet.relativePath);
      const references = cssReferences(source);
      for (const value of references.imports) {
        await add({ value, extensions: STYLE_EXTENSIONS, basePath });
      }
      for (const value of references.urls) {
        await add({ value, extensions: CSS_URL_EXTENSIONS, basePath });
      }
    } catch (cause) {
      if (signal?.aborted) throw cause;
      // A missing or unreadable declared stylesheet simply cannot extend the
      // preview session's capability set.
    }
  }

  for (let index = 0; index < scriptQueue.length; index += 1) {
    throwIfAssetDiscoveryAborted(signal);
    const script = scriptQueue[index];
    try {
      const info = await stat(script.resolvedPath);
      throwIfAssetDiscoveryAborted(signal);
      if (info.size > maxDependencyScanBytes) continue;
      const source = await readFile(script.resolvedPath, {
        encoding: "utf8",
        ...(signal ? { signal } : {}),
      });
      throwIfAssetDiscoveryAborted(signal);
      const basePath = path.posix.dirname(script.relativePath);
      for (const value of javaScriptImports(source)) {
        await add({ value, extensions: SCRIPT_EXTENSIONS, basePath });
      }
    } catch (cause) {
      if (signal?.aborted) throw cause;
      // A missing or unreadable declared script cannot authorize additional
      // local files for the preview.
    }
  }

  return assets;
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? "").toLowerCase();
  return SESSION_ID_PATTERN.test(sessionId) ? sessionId : null;
}

export function registerPreviewProtocolScheme(protocolApi) {
  if (schemePrivilegesRegistered) return;
  protocolApi.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
  schemePrivilegesRegistered = true;
}

export function createPreviewSessionOperation({
  createSession,
  authorizeSourcePath,
} = {}) {
  if (typeof createSession !== "function") {
    throw new TypeError("Preview session operation requires createSession.");
  }
  if (typeof authorizeSourcePath !== "function") {
    throw new TypeError(
      "Preview session operation requires source path authorization.",
    );
  }
  return async (payload) => {
    const sourcePath = payload?.sourcePath === undefined
      || payload?.sourcePath === null
      || payload?.sourcePath === ""
      ? undefined
      : await authorizeSourcePath(payload.sourcePath);
    const sessionId = normalizeSessionId(payload?.sessionId);
    return createSession({
      html: payload?.html,
      bootstrapJavaScript: payload?.bootstrapJavaScript,
      ...(payload?.bootstrapFallbackJavaScript === undefined
        ? {}
        : { bootstrapFallbackJavaScript: payload.bootstrapFallbackJavaScript }),
      ...(sourcePath ? { sourcePath } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  };
}

export function createPreviewProtocolController({
  protocolApi,
  netFetch,
  now = () => Date.now(),
  randomSessionId = () => randomBytes(16).toString("hex"),
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
  maxBootstrapBytes = DEFAULT_MAX_BOOTSTRAP_BYTES,
  maxSessions = DEFAULT_MAX_SESSIONS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  if (!protocolApi || typeof protocolApi.handle !== "function") {
    throw new TypeError("Preview protocol controller requires protocol.handle.");
  }
  if (typeof netFetch !== "function") {
    throw new TypeError("Preview protocol controller requires Electron net.fetch.");
  }

  const sessions = new Map();
  const installedProtocols = new WeakSet();

  const removeExpiredSessions = () => {
    const cutoff = now() - sessionTtlMs;
    for (const [sessionId, session] of sessions) {
      if (session.lastAccessedAt < cutoff) sessions.delete(sessionId);
    }
  };

  const createSession = async (payload) => {
    const html = typeof payload?.html === "string" ? payload.html : null;
    const bootstrapJavaScript = typeof payload?.bootstrapJavaScript === "string"
      ? payload.bootstrapJavaScript
      : null;
    const bootstrapFallbackJavaScript = payload?.bootstrapFallbackJavaScript === undefined
      ? null
      : typeof payload.bootstrapFallbackJavaScript === "string"
        ? payload.bootstrapFallbackJavaScript
        : null;
    if (
      html === null
      || bootstrapJavaScript === null
      || (payload?.bootstrapFallbackJavaScript !== undefined
        && bootstrapFallbackJavaScript === null)
      || utf8ByteLength(html) > maxHtmlBytes
      || utf8ByteLength(bootstrapJavaScript)
        + utf8ByteLength(bootstrapFallbackJavaScript || "") > maxBootstrapBytes
    ) {
      throw new TypeError("Interactive preview payload is invalid or too large.");
    }
    const sourceRoot = await resolvePreviewSourceRoot(payload?.sourcePath);
    const declaredAssets = sourceRoot
      ? await collectDeclaredPreviewAssets({ html, sourceRoot })
      : new Map();
    removeExpiredSessions();
    const reuseSessionId = normalizeSessionId(payload?.sessionId);
    const createdAt = now();
    const nextRecord = {
      html,
      navigationFallbackActive: false,
      bootstrapJavaScript,
      bootstrapFallbackJavaScript,
      bootstrapPrivateAvailable: bootstrapFallbackJavaScript !== null,
      sourceRoot,
      declaredAssets,
      createdAt,
      lastAccessedAt: createdAt,
    };
    if (reuseSessionId && sessions.has(reuseSessionId)) {
      const existing = sessions.get(reuseSessionId);
      sessions.set(reuseSessionId, {
        ...nextRecord,
        createdAt: existing.createdAt,
      });
      return Object.freeze({
        sessionId: reuseSessionId,
        url: `${PREVIEW_PROTOCOL_SCHEME}://${reuseSessionId}/index.html`,
      });
    }
    while (sessions.size >= maxSessions) {
      let oldestSessionId = null;
      let oldestAccessedAt = Infinity;
      for (const [sessionId, session] of sessions) {
        if (session.lastAccessedAt < oldestAccessedAt) {
          oldestAccessedAt = session.lastAccessedAt;
          oldestSessionId = sessionId;
        }
      }
      if (!oldestSessionId) break;
      sessions.delete(oldestSessionId);
    }

    let sessionId = null;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = normalizeSessionId(randomSessionId());
      if (candidate && !sessions.has(candidate)) {
        sessionId = candidate;
        break;
      }
    }
    if (!sessionId) throw new Error("Unable to allocate a preview session.");
    sessions.set(sessionId, nextRecord);
    return Object.freeze({
      sessionId,
      url: `${PREVIEW_PROTOCOL_SCHEME}://${sessionId}/index.html`,
    });
  };

  const revokeSession = (sessionIdInput) => {
    const sessionId = normalizeSessionId(sessionIdInput);
    return Object.freeze({
      revoked: sessionId ? sessions.delete(sessionId) : false,
    });
  };

  const inspectSession = (sessionIdInput) => {
    const sessionId = normalizeSessionId(sessionIdInput);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return Object.freeze({ active: false });
    if (session.lastAccessedAt < now() - sessionTtlMs) {
      sessions.delete(sessionId);
      return Object.freeze({ active: false });
    }
    return Object.freeze({ active: true });
  };

  const activateNavigationFallback = (sessionUrlInput) => {
    let sessionUrl;
    try {
      sessionUrl = new URL(String(sessionUrlInput || ""));
    } catch {
      return false;
    }
    if (
      sessionUrl.protocol !== `${PREVIEW_PROTOCOL_SCHEME}:`
      || (sessionUrl.pathname !== "/index.html" && sessionUrl.pathname !== "/")
    ) return false;
    const sessionId = normalizeSessionId(sessionUrl.hostname);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || session.navigationFallbackActive) return false;
    if (session.lastAccessedAt < now() - sessionTtlMs) {
      sessions.delete(sessionId);
      return false;
    }
    session.html = scriptlessNavigationFallback(session.html);
    session.navigationFallbackActive = true;
    session.lastAccessedAt = now();
    return true;
  };

  const handleRequest = async (request) => {
    if (!request || (request.method !== "GET" && request.method !== "HEAD")) {
      return invalidRequest();
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return invalidRequest();
    }
    const sessionId = normalizeSessionId(requestUrl.hostname);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return notFound();
    if (session.lastAccessedAt < now() - sessionTtlMs) {
      sessions.delete(sessionId);
      return notFound();
    }
    session.lastAccessedAt = now();

    if (requestUrl.pathname === "/index.html" || requestUrl.pathname === "/") {
      return response(
        request.method === "HEAD" ? null : session.html,
        200,
        "text/html; charset=utf-8",
        {
          "content-security-policy": session.navigationFallbackActive
            ? PREVIEW_NAVIGATION_FALLBACK_CSP
            : PREVIEW_DOCUMENT_CSP,
        },
      );
    }
    if (requestUrl.pathname === PREVIEW_BOOTSTRAP_PATH) {
      const servePrivateBootstrap = request.method === "GET"
        && session.bootstrapPrivateAvailable;
      const bootstrapJavaScript = servePrivateBootstrap
        ? session.bootstrapJavaScript
        : session.bootstrapFallbackJavaScript ?? session.bootstrapJavaScript;
      if (servePrivateBootstrap) {
        // The first parser-blocking bootstrap can receive a private binding
        // payload. It is never returned to later same-origin fetches from the
        // authored document; retain only the public, unbound program.
        session.bootstrapPrivateAvailable = false;
        session.bootstrapJavaScript = session.bootstrapFallbackJavaScript;
      }
      return response(
        request.method === "HEAD" ? null : bootstrapJavaScript,
        200,
        "text/javascript; charset=utf-8",
      );
    }
    if (!session.sourceRoot) return notFound();

    const relativePath = normalizeRelativeAssetPath(requestUrl.pathname);
    if (!relativePath) return invalidRequest();
    const asset = session.declaredAssets.get(relativePath);
    if (!asset) return notFound();

    try {
      const resolvedPath = await realpath(asset.resolvedPath);
      if (
        resolvedPath !== asset.resolvedPath
        || !isContainedPath(session.sourceRoot, resolvedPath)
      ) return notFound();
      const fileInfo = await stat(resolvedPath);
      if (!fileInfo.isFile()) return notFound();
      return netFetch(pathToFileURL(resolvedPath).href, {
        method: request.method,
        headers: request.headers,
      });
    } catch {
      return notFound();
    }
  };

  const installFor = (targetProtocol = protocolApi) => {
    if (!targetProtocol || typeof targetProtocol.handle !== "function") {
      throw new TypeError("Preview protocol target requires handle().");
    }
    if (installedProtocols.has(targetProtocol)) return;
    targetProtocol.handle(PREVIEW_PROTOCOL_SCHEME, handleRequest);
    installedProtocols.add(targetProtocol);
  };

  const install = () => installFor(protocolApi);

  const dispose = () => {
    sessions.clear();
  };

  return Object.freeze({
    install,
    installFor,
    createSession,
    revokeSession,
    inspectSession,
    activateNavigationFallback,
    dispose,
    sessionCount: () => sessions.size,
    handleRequest,
  });
}
