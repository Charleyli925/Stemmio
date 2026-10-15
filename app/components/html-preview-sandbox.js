import {
  EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
  EDIT_RUNTIME_OWNED_ATTRIBUTE,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
  isEditRuntimeExecutionId,
  isEditRuntimeSessionId,
} from "../domain/edit-runtime-contract.js";
import {
  STEMMIO_ELEMENT_ID_ATTRIBUTE,
  isValidStemmioElementId,
} from "../../shared/stemmio-element-identity.mjs";

export const EDITOR_STYLE_ATTRIBUTE = "data-html-canvas-editor-style";
export const FRAME_VERIFICATION_ATTRIBUTE =
  "data-html-canvas-render-verification";

const INJECTED_BASE_ATTRIBUTE = "data-html-canvas-injected-base";
const DISABLED_SCRIPT_ATTRIBUTE = "data-html-canvas-disabled-script";
const ORIGINAL_SCRIPT_TYPE_ATTRIBUTE = "data-html-canvas-original-script-type";
const DISABLED_REFRESH_ATTRIBUTE = "data-html-canvas-disabled-refresh";
const MISSING_ATTRIBUTE_VALUE = "__html_canvas_missing__";
export const EDIT_RUNTIME_CSP = [
  "default-src 'none'",
  "script-src stemmio-edit-runtime:",
  "style-src 'unsafe-inline' data: http: https: stemmio-edit-runtime:",
  "img-src data: blob: http: https: stemmio-edit-runtime:",
  "font-src data: http: https: stemmio-edit-runtime:",
  "media-src data: blob: http: https: stemmio-edit-runtime:",
  "connect-src http: https:",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri stemmio-edit-runtime:",
].join("; ");

function escapeAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function disableExecutableMarkup(source) {
  return source.replace(
    /<script\b([^>]*)>/gi,
    (_openingTag, rawAttributes) => {
      const typePattern =
        /\s+type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
      const typeMatch = rawAttributes.match(typePattern);
      const originalType = typeMatch
        ? typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? ""
        : MISSING_ATTRIBUTE_VALUE;
      const attributesWithoutType = rawAttributes.replace(typePattern, "");
      return `<script${attributesWithoutType} type="application/x-html-canvas-disabled" ${DISABLED_SCRIPT_ATTRIBUTE}="true" ${ORIGINAL_SCRIPT_TYPE_ATTRIBUTE}="${escapeAttribute(originalType)}">`;
    },
  );
}

function doctypeString(doctype) {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

export function sanitizePreviewDocument(source, baseUrl) {
  const disabledSource = disableExecutableMarkup(source);
  if (typeof DOMParser === "undefined") return disabledSource;

  const parsed = new DOMParser().parseFromString(disabledSource, "text/html");
  parsed.querySelectorAll("meta[http-equiv]").forEach((node) => {
    const directive = node.getAttribute("http-equiv")?.trim().toLowerCase();
    if (directive === "refresh") {
      node.setAttribute(DISABLED_REFRESH_ATTRIBUTE, "true");
      node.setAttribute("http-equiv", "x-html-canvas-disabled-refresh");
    }
  });

  if (baseUrl && !parsed.head.querySelector("base")) {
    const base = parsed.createElement("base");
    base.href = baseUrl;
    base.setAttribute(INJECTED_BASE_ATTRIBUTE, "true");
    parsed.head.prepend(base);
  }
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

function isolateRuntimeCandidateFocus(parsed, candidateInertOwnership) {
  const root = parsed.documentElement;
  // A replacement document is born as a hidden Candidate. Keep its controls
  // outside the focus order until the existing handoff coordinator accepts it
  // as Active. Ownership stays in the parent-side Candidate record because
  // author markup and scripts can freely mutate every attribute in this DOM.
  const injected = !root.hasAttribute("inert");
  if (candidateInertOwnership) candidateInertOwnership.injected = injected;
  if (injected) {
    root.setAttribute("inert", "");
  }
  parsed.querySelectorAll("[autofocus]").forEach((element) => {
    element.removeAttribute("autofocus");
  });
}

export function prepareVerifiedFrameDocument(
  source,
  verificationToken,
  {
    baseUrl,
    editorStyles,
    candidateInert = false,
    candidateInertOwnership,
  } = {},
) {
  const sanitized = sanitizePreviewDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return sanitized;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  parsed.head
    .querySelectorAll(`style[${EDITOR_STYLE_ATTRIBUTE}]`)
    .forEach((node) => node.remove());
  const editorStyle = parsed.createElement("style");
  editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
  editorStyle.textContent = String(editorStyles || "");
  parsed.head.prepend(editorStyle);
  const marker = parsed.createElement("meta");
  marker.setAttribute(FRAME_VERIFICATION_ATTRIBUTE, verificationToken);
  marker.setAttribute("content", verificationToken);
  parsed.head.prepend(marker);
  if (candidateInert) {
    isolateRuntimeCandidateFocus(parsed, candidateInertOwnership);
  }
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

function uniqueRuntimeMarker(element) {
  // Runtime source proof is Stable-ID-only. Stemmio-owned injections such as
  // the protocol <base> are not source objects and must not mint a second ID.
  const stemmioId = element.getAttribute(STEMMIO_ELEMENT_ID_ATTRIBUTE);
  return isValidStemmioElementId(stemmioId) ? stemmioId : null;
}

function addFrameVerification(parsed, verificationToken, editorStyles) {
  parsed.head
    .querySelectorAll(`style[${EDITOR_STYLE_ATTRIBUTE}]`)
    .forEach((node) => node.remove());
  const editorStyle = parsed.createElement("style");
  editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
  editorStyle.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "editor-style");
  editorStyle.textContent = String(editorStyles || "");
  parsed.head.prepend(editorStyle);
  const marker = parsed.createElement("meta");
  marker.setAttribute(FRAME_VERIFICATION_ATTRIBUTE, verificationToken);
  marker.setAttribute("content", verificationToken);
  marker.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "verification");
  parsed.head.prepend(marker);
}

function addRuntimeContentSecurityPolicy(parsed) {
  parsed.head
    .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    .forEach((node) => node.remove());
  const csp = parsed.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", EDIT_RUNTIME_CSP);
  csp.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "csp");
  parsed.head.prepend(csp);
}

/**
 * Runtime relative assets must resolve through the same immutable session as
 * the fixed author scripts.  `srcdoc` is intentionally retained for direct
 * editor DOM access, so the protocol base—not the iframe URL—closes this
 * capability boundary.
 */
function addRuntimeResourceBase(parsed, sessionId, documentBasePath = "/") {
  const resourceBase = editRuntimeProtocolUrl(sessionId, documentBasePath);
  if (!resourceBase || !parsed.head) return false;
  parsed.head.querySelectorAll("base").forEach((node) => node.remove());
  const base = parsed.createElement("base");
  base.href = resourceBase;
  base.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "resource-base");
  parsed.head.prepend(base);
  return true;
}

/**
 * Builds one disposable Edit runtime document. Native script elements load
 * through a source-scoped protocol session. They remain inert until the fixed
 * bootstrap has proved the complete parser-authored source object set, then
 * activate in source order without widening the renderer's own CSP. No Runtime
 * DOM is ever serialized back into the source HTML.
 */
export function prepareDisposableRuntimeFrameDocument(
  source,
  verificationToken,
  {
    sessionId,
    executionId,
    documentBasePath,
    baseUrl,
    editorStyles,
    candidateInertOwnership,
  } = {},
) {
  if (
    typeof source !== "string"
    || !verificationToken
    || !isEditRuntimeSessionId(sessionId)
    || !isEditRuntimeExecutionId(executionId)
  ) return null;
  const scriptContract = collectEditRuntimeScripts(source);
  if (
    scriptContract.unsupportedReason
    || scriptContract.executableScripts.length < 1
  ) return null;
  const sanitized = sanitizePreviewDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  if (!parsed.documentElement || !parsed.head) return null;
  if (!addRuntimeResourceBase(parsed, sessionId, documentBasePath)) return null;
  const root = parsed.documentElement;
  isolateRuntimeCandidateFocus(parsed, candidateInertOwnership);
  const sourceElements = [root, ...root.querySelectorAll("*")];
  const seenMarkers = new Set();
  for (const element of sourceElements) {
    const marker = uniqueRuntimeMarker(element);
    if (!marker) continue;
    if (seenMarkers.has(marker)) return null;
    seenMarkers.add(marker);
    element.setAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, marker);
  }
  if (seenMarkers.size === 0) return null;
  const scriptNodes = Array.from(parsed.querySelectorAll("script"));
  if (scriptNodes.length !== scriptContract.scripts.length) return null;
  for (let ordinal = 0; ordinal < scriptNodes.length; ordinal += 1) {
    const descriptor = scriptContract.scripts[ordinal];
    if (!descriptor?.executable) continue;
    const script = scriptNodes[ordinal];
    const scriptUrl = editRuntimeProtocolUrl(
      sessionId,
      `/.stemmio/author/${descriptor.index}.js`,
    );
    if (!scriptUrl) return null;
    script.src = scriptUrl;
    script.setAttribute(EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE, String(descriptor.index));
    script.textContent = "";
  }
  addFrameVerification(parsed, String(verificationToken), editorStyles);
  addRuntimeContentSecurityPolicy(parsed);
  const bootstrapUrl = editRuntimeProtocolUrl(
    sessionId,
    `/.stemmio/bootstrap/${executionId}.js`,
  );
  if (!bootstrapUrl || !bootstrapUrl.startsWith(`${EDIT_RUNTIME_PROTOCOL_SCHEME}:`)) {
    return null;
  }
  const bootstrap = parsed.createElement("script");
  bootstrap.src = bootstrapUrl;
  bootstrap.setAttribute(EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE, "true");
  bootstrap.setAttribute(EDIT_RUNTIME_OWNED_ATTRIBUTE, "bootstrap");
  parsed.head.prepend(bootstrap);
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

/**
 * A discriminated frame builder keeps script-free pages static and uses the
 * disposable runtime only with a complete Main-authorized resource grant.
 */
export function prepareCanvasFrameDocument(
  source,
  verificationToken,
  options = {},
) {
  const { mode = "static", ...rest } = options;
  if (mode === "static") {
    return prepareVerifiedFrameDocument(source, verificationToken, rest);
  }
  if (mode === "disposable-runtime") {
    return prepareDisposableRuntimeFrameDocument(source, verificationToken, rest);
  }
  throw new TypeError("Unknown HTML canvas frame mode.");
}

export function baseHrefFromSourcePath(sourcePath) {
  if (!sourcePath) return undefined;
  let trimmedPath = sourcePath.trim();
  if (!trimmedPath) return undefined;
  // macOS exposes the same tree as /var and /private/var. Treat those
  // spellings as one directory so a Finder rename cannot look like a new
  // Canvas authority.
  if (trimmedPath === "/private/var" || trimmedPath.startsWith("/private/var/")) {
    trimmedPath = trimmedPath.slice("/private".length);
  } else if (trimmedPath === "/private/tmp" || trimmedPath.startsWith("/private/tmp/")) {
    trimmedPath = trimmedPath.slice("/private".length);
  }

  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      const sourceUrl = new URL(trimmedPath);
      if (!sourceUrl.pathname.endsWith("/")) {
        sourceUrl.pathname = sourceUrl.pathname.slice(
          0,
          sourceUrl.pathname.lastIndexOf("/") + 1,
        );
      }
      sourceUrl.search = "";
      sourceUrl.hash = "";
      return sourceUrl.href;
    }
  } catch {
    return undefined;
  }

  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("/")) return undefined;
  const directoryPath = normalizedPath.endsWith("/")
    ? normalizedPath
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
  const encodedPath = directoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encodedPath}`;
}
