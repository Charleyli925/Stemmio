import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PREVIEW_BOOTSTRAP_PATH,
  PREVIEW_PROTOCOL_SCHEME,
  collectDeclaredPreviewAssets,
  createPreviewProtocolController,
  createPreviewSessionOperation,
  registerPreviewProtocolScheme,
  resolveContainedDocumentBase,
  resolvePreviewSourceRoot,
} from "../desktop/preview-protocol.mjs";

test("contained document base ignores inert and href-less base elements", () => {
  assert.deepEqual(
    resolveContainedDocumentBase(
      '<base target="_blank"><base href="./assets/"><script src="chart.js"></script>',
    ),
    { documentPath: "/assets/", basePath: "assets" },
  );
  assert.deepEqual(
    resolveContainedDocumentBase(
      '<template><base href="./assets/"></template><script src="chart.js"></script>',
    ),
    { documentPath: "/", basePath: "" },
  );
  assert.deepEqual(
    resolveContainedDocumentBase(
      '<svg><base href="./assets/"></base></svg><script src="chart.js"></script>',
    ),
    { documentPath: "/", basePath: "" },
  );
});

test("contained document base rejects absolute and scheme-relative sentinel URLs", () => {
  assert.equal(
    resolveContainedDocumentBase('<base href="https://stemmio-preview.invalid/assets/">'),
    null,
  );
  assert.equal(
    resolveContainedDocumentBase('<base href="//stemmio-preview.invalid/assets/">'),
    null,
  );
});

test("declared asset discovery caps missing-reference probes before they can delay a preview session", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "stemmio-preview-declared-asset-cap-"),
  );
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await writeFile(path.join(temporaryRoot, "later.png"), "later asset");

  const assets = await collectDeclaredPreviewAssets({
    html: [
      '<img src="missing-one.png">',
      '<img src="missing-two.png">',
      '<img src="later.png">',
    ].join(""),
    sourceRoot: temporaryRoot,
    maxAssets: 8,
    maxReferences: 2,
  });

  assert.equal(assets.size, 0);
  assert.equal(assets.has("later.png"), false);
});

test("declared asset discovery applies an authored base only for the Edit runtime caller", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "stemmio-preview-document-base-"),
  );
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(path.join(temporaryRoot, "assets"));
  await Promise.all([
    writeFile(path.join(temporaryRoot, "chart.js"), "window.previewRoot=true;"),
    writeFile(path.join(temporaryRoot, "assets", "chart.js"), "window.editBase=true;"),
  ]);
  const sourceRoot = await realpath(temporaryRoot);
  const html = '<base href="./assets/"><script src="chart.js"></script>';

  const previewAssets = await collectDeclaredPreviewAssets({
    html,
    sourceRoot,
  });
  const editRuntimeAssets = await collectDeclaredPreviewAssets({
    html,
    sourceRoot,
    documentBasePath: "assets",
  });

  assert.equal(previewAssets.has("chart.js"), true);
  assert.equal(previewAssets.has("assets/chart.js"), false);
  assert.equal(editRuntimeAssets.has("chart.js"), false);
  assert.equal(editRuntimeAssets.has("assets/chart.js"), true);
});

test("preview protocol installs one handler for each isolated Electron session", () => {
  let defaultHandlers = 0;
  let isolatedHandlers = 0;
  let isolatedHandler = null;
  const controller = createPreviewProtocolController({
    protocolApi: {
      handle(scheme, handler) {
        assert.equal(scheme, PREVIEW_PROTOCOL_SCHEME);
        assert.equal(typeof handler, "function");
        defaultHandlers += 1;
      },
    },
    netFetch: async () => new Response("unreachable"),
  });
  const isolatedProtocol = {
    handle(scheme, handler) {
      assert.equal(scheme, PREVIEW_PROTOCOL_SCHEME);
      isolatedHandlers += 1;
      isolatedHandler = handler;
    },
  };

  controller.install();
  controller.installFor(isolatedProtocol);
  controller.installFor(isolatedProtocol);

  assert.equal(defaultHandlers, 1);
  assert.equal(isolatedHandlers, 1);
  assert.equal(typeof isolatedHandler, "function");
});

test("preview session operation authorizes the source path before creation", async () => {
  const calls = [];
  const operation = createPreviewSessionOperation({
    authorizeSourcePath: async (sourcePath) => {
      calls.push(["authorize", sourcePath]);
      return "/canonical/report.html";
    },
    createSession: async (payload) => {
      calls.push(["create", payload]);
      return { sessionId: "session" };
    },
  });
  const result = await operation({
    html: "<p>preview</p>",
    bootstrapJavaScript: "void 0;",
    bootstrapFallbackJavaScript: "void 1;",
    sourcePath: "/known/report.html",
    ignored: "not forwarded",
  });

  assert.deepEqual(result, { sessionId: "session" });
  assert.deepEqual(calls, [
    ["authorize", "/known/report.html"],
    ["create", {
      html: "<p>preview</p>",
      bootstrapJavaScript: "void 0;",
      bootstrapFallbackJavaScript: "void 1;",
      sourcePath: "/canonical/report.html",
    }],
  ]);
});

test("private preview bootstrap bytes are consumed before authored fetches", async () => {
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unreachable"),
    randomSessionId: () => "abcdefabcdefabcdefabcdefabcdefab",
  });
  const session = await controller.createSession({
    html: [
      "<!doctype html>",
      '<script data-stemmio-ai-review-bootstrap="true"',
      ` src="${PREVIEW_BOOTSTRAP_PATH}"></script>`,
      "<main>public preview bytes</main>",
    ].join(""),
    bootstrapJavaScript: [
      "const reviewCommentInitialBindings = ['sm1_11111111111141118111111111111111'];",
      "const runtimeProjectionInitialBindings = ['runtime-host-1'];",
    ].join("\n"),
    bootstrapFallbackJavaScript: "const publicBootstrap = true;",
  });
  const documentResponse = await controller.handleRequest(new Request(session.url));
  const documentHtml = await documentResponse.text();
  assert.doesNotMatch(
    documentHtml,
    /reviewCommentInitialBindings|runtimeProjectionInitialBindings|runtime-host-1/u,
  );

  const bootstrapUrl = `stemmio-preview://${session.sessionId}${PREVIEW_BOOTSTRAP_PATH}`;
  const firstBootstrap = await controller.handleRequest(new Request(bootstrapUrl));
  const firstBootstrapSource = await firstBootstrap.text();
  assert.match(firstBootstrapSource, /reviewCommentInitialBindings/u);
  assert.match(firstBootstrapSource, /runtimeProjectionInitialBindings/u);
  assert.match(firstBootstrapSource, /runtime-host-1/u);

  const laterBootstrap = await controller.handleRequest(new Request(bootstrapUrl));
  const laterBootstrapSource = await laterBootstrap.text();
  assert.match(laterBootstrapSource, /publicBootstrap/u);
  assert.doesNotMatch(
    laterBootstrapSource,
    /reviewCommentInitialBindings|runtimeProjectionInitialBindings|runtime-host-1/u,
  );

  const headBootstrap = await controller.handleRequest(new Request(bootstrapUrl, {
    method: "HEAD",
  }));
  assert.equal(await headBootstrap.text(), "");
});

test("independent preview protocol serves one volatile document and bounded local assets", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "stemmio-preview-protocol-"),
  );
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const siteRoot = path.join(temporaryRoot, "site");
  await mkdir(siteRoot);
  const sourcePath = path.join(siteRoot, "report.html");
  const sourceHtml = [
    "<!doctype html>",
    '<link rel="stylesheet" href="styles/site.css">',
    '<script type="module" src="chart.js"></script>',
    "<style>@import \"styles/inline.css\"; .inline-sheet { background-image: url(\"assets/inline-sheet.png\"); }</style>",
    '<div style="background-image: url(\'assets/inline-attribute.png\')"></div>',
    '<script type="module">import "./inline-module.js";</script>',
    '<script src="escape.js"></script>',
    '<img src="assets/hero.png">',
    '<img src=".env">',
  ].join("\n");
  const assetPath = path.join(siteRoot, "chart.js");
  const outsidePath = path.join(temporaryRoot, "outside.js");
  await mkdir(path.join(siteRoot, "styles"));
  await mkdir(path.join(siteRoot, "assets"));
  await mkdir(path.join(siteRoot, "modules"));
  await mkdir(path.join(siteRoot, ".git"));
  await writeFile(sourcePath, sourceHtml);
  await writeFile(assetPath, 'import "./modules/helper.mjs";');
  await writeFile(path.join(siteRoot, "modules", "helper.mjs"), "window.chartLoaded = true;");
  await writeFile(
    path.join(siteRoot, "styles", "site.css"),
    '@import "theme.css"; .hero { background-image: url("../assets/hero.png"); }',
  );
  await writeFile(
    path.join(siteRoot, "styles", "theme.css"),
    '@font-face { font-family: Preview; src: url("../assets/preview.woff2"); }',
  );
  await writeFile(
    path.join(siteRoot, "styles", "inline.css"),
    '@font-face { font-family: Inline; src: url("../assets/inline.woff2"); }',
  );
  await writeFile(
    path.join(siteRoot, "inline-module.js"),
    'import "./modules/inline-helper.mjs";',
  );
  await writeFile(
    path.join(siteRoot, "modules", "inline-helper.mjs"),
    "window.inlineModuleLoaded = true;",
  );
  await writeFile(path.join(siteRoot, "assets", "hero.png"), "synthetic image");
  await writeFile(path.join(siteRoot, "assets", "preview.woff2"), "synthetic font");
  await writeFile(path.join(siteRoot, "assets", "inline-sheet.png"), "synthetic image");
  await writeFile(path.join(siteRoot, "assets", "inline-attribute.png"), "synthetic image");
  await writeFile(path.join(siteRoot, "assets", "inline.woff2"), "synthetic font");
  await writeFile(path.join(siteRoot, ".env"), "PRIVATE_TOKEN=preview-test\n");
  await writeFile(path.join(siteRoot, ".git", "config"), "[core]\nrepositoryformatversion = 0\n");
  await writeFile(path.join(siteRoot, "not-declared.js"), "window.private = true;");
  await writeFile(outsidePath, "window.escaped = true;");
  await symlink(outsidePath, path.join(siteRoot, "escape.js"));

  const registrations = [];
  let handler = null;
  const protocolApi = {
    registerSchemesAsPrivileged(value) {
      registrations.push(value);
    },
    handle(scheme, value) {
      assert.equal(scheme, PREVIEW_PROTOCOL_SCHEME);
      handler = value;
    },
  };
  const fetched = [];
  const controller = createPreviewProtocolController({
    protocolApi,
    netFetch: async (url, options) => {
      fetched.push({ url, options });
      return new Response("asset response", {
        headers: { "content-type": "text/javascript" },
      });
    },
    randomSessionId: () => "0123456789abcdef0123456789abcdef",
  });

  registerPreviewProtocolScheme(protocolApi);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0].scheme, PREVIEW_PROTOCOL_SCHEME);
  assert.equal(registrations[0][0].privileges.standard, true);
  assert.equal(registrations[0][0].privileges.secure, true);
  assert.equal(
    Object.hasOwn(registrations[0][0].privileges, "bypassCSP"),
    false,
  );

  controller.install();
  assert.equal(typeof handler, "function");
  const session = await controller.createSession({
    html: sourceHtml,
    bootstrapJavaScript: "window.previewBootstrap = true;",
    sourcePath,
  });
  assert.deepEqual(session, {
    sessionId: "0123456789abcdef0123456789abcdef",
    url: "stemmio-preview://0123456789abcdef0123456789abcdef/index.html",
  });
  assert.equal(controller.sessionCount(), 1);

  const documentResponse = await handler(new Request(session.url));
  assert.equal(documentResponse.status, 200);
  assert.match(await documentResponse.text(), /chart\.js/);
  assert.equal(
    documentResponse.headers.get("cache-control"),
    "no-store",
  );
  assert.match(
    documentResponse.headers.get("content-security-policy") || "",
    /base-uri 'none'/,
  );

  const bootstrapResponse = await handler(new Request(
    `stemmio-preview://${session.sessionId}${PREVIEW_BOOTSTRAP_PATH}`,
  ));
  assert.equal(bootstrapResponse.status, 200);
  assert.match(await bootstrapResponse.text(), /previewBootstrap/);

  const assetResponse = await handler(new Request(
    `stemmio-preview://${session.sessionId}/chart.js`,
  ));
  assert.equal(assetResponse.status, 200);
  assert.equal(await assetResponse.text(), "asset response");
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].url, /chart\.js$/u);

  const previewUrl = (relativePath) => (
    PREVIEW_PROTOCOL_SCHEME + "://" + session.sessionId + "/" + relativePath
  );
  const importedModule = await handler(new Request(
    previewUrl("modules/helper.mjs"),
  ));
  assert.equal(importedModule.status, 200);

  const stylesheet = await handler(new Request(
    previewUrl("styles/theme.css"),
  ));
  assert.equal(stylesheet.status, 200);

  const cssAsset = await handler(new Request(
    previewUrl("assets/preview.woff2"),
  ));
  assert.equal(cssAsset.status, 200);

  const inlineStylesheet = await handler(new Request(
    previewUrl("styles/inline.css"),
  ));
  assert.equal(inlineStylesheet.status, 200);
  const inlineSheetAsset = await handler(new Request(
    previewUrl("assets/inline-sheet.png"),
  ));
  assert.equal(inlineSheetAsset.status, 200);
  const inlineAttributeAsset = await handler(new Request(
    previewUrl("assets/inline-attribute.png"),
  ));
  assert.equal(inlineAttributeAsset.status, 200);
  const inlineCssAsset = await handler(new Request(
    previewUrl("assets/inline.woff2"),
  ));
  assert.equal(inlineCssAsset.status, 200);
  const inlineModule = await handler(new Request(
    previewUrl("inline-module.js"),
  ));
  assert.equal(inlineModule.status, 200);
  const inlineModuleDependency = await handler(new Request(
    previewUrl("modules/inline-helper.mjs"),
  ));
  assert.equal(inlineModuleDependency.status, 200);
  assert.equal(fetched.length, 10);

  const secretAsset = await handler(new Request(previewUrl(".env")));
  assert.equal(secretAsset.status, 400);
  const gitConfig = await handler(new Request(previewUrl(".git/config")));
  assert.equal(gitConfig.status, 400);
  const unlistedAsset = await handler(new Request(previewUrl("not-declared.js")));
  assert.equal(unlistedAsset.status, 404);

  const escapedAsset = await handler(new Request(
    `stemmio-preview://${session.sessionId}/escape.js`,
  ));
  assert.equal(escapedAsset.status, 404);
  assert.equal(fetched.length, 10);

  assert.deepEqual(controller.revokeSession(session.sessionId), {
    revoked: true,
  });
  assert.equal(controller.sessionCount(), 0);
  const revokedResponse = await handler(new Request(session.url));
  assert.equal(revokedResponse.status, 404);
});

test("preview protocol rejects malformed methods, payloads, and unknown sessions", async () => {
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unreachable"),
    randomSessionId: () => "fedcba9876543210fedcba9876543210",
  });

  assert.equal(
    (await controller.handleRequest({
      method: "POST",
      url: "stemmio-preview://fedcba9876543210fedcba9876543210/index.html",
    })).status,
    400,
  );
  assert.equal(
    (await controller.handleRequest(new Request(
      "stemmio-preview://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html",
    ))).status,
    404,
  );
  await assert.rejects(
    controller.createSession({
      html: null,
      bootstrapJavaScript: "",
    }),
    /payload is invalid/u,
  );
  await assert.rejects(
    controller.createSession({
      html: "<p>preview</p>",
      bootstrapJavaScript: "",
      sourcePath: "relative/report.html",
    }),
    /absolute local path/u,
  );
});

test("a preview navigation attempt activates one scriptless bootstrap fallback", async () => {
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unreachable"),
    randomSessionId: () => "1234567890abcdef1234567890abcdef",
  });
  const session = await controller.createSession({
    html: [
      "<!doctype html>",
      '<html><head><script data-stemmio-ai-review-bootstrap="true"',
      ` src="${PREVIEW_BOOTSTRAP_PATH}"></script>`,
      '<script src="author-chart.js"></script></head>',
      '<body onload="location.replace(\'data:text/html,forged\')">',
      '<script>window.authorNavigationRan = true;</script>',
      "<p>静态审阅内容</p></body></html>",
    ].join(""),
    bootstrapJavaScript: "window.ownedBootstrapRan = true;",
  });

  const originalResponse = await controller.handleRequest(new Request(session.url));
  const originalHtml = await originalResponse.text();
  assert.match(originalHtml, /authorNavigationRan/u);
  assert.match(originalHtml, /author-chart\.js/u);
  assert.equal(controller.activateNavigationFallback("data:text/html,forged"), false);
  assert.equal(controller.activateNavigationFallback(session.url), true);
  assert.equal(controller.activateNavigationFallback(session.url), false);

  const fallbackResponse = await controller.handleRequest(new Request(session.url));
  const fallbackHtml = await fallbackResponse.text();
  assert.match(
    fallbackHtml,
    /data-stemmio-preview-navigation-fallback="true"/u,
  );
  assert.match(fallbackHtml, /data-stemmio-ai-review-bootstrap="true"/u);
  assert.doesNotMatch(fallbackHtml, /authorNavigationRan|author-chart\.js/u);
  assert.equal((fallbackHtml.match(/<script\b/gu) || []).length, 1);
  const fallbackCsp = fallbackResponse.headers.get("content-security-policy") || "";
  assert.equal(
    fallbackCsp.split(";").map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src")),
    "script-src 'self'",
  );
  assert.match(fallbackCsp, /form-action 'none'/u);
  assert.match(fallbackCsp, /frame-src 'none'/u);

  const bootstrapResponse = await controller.handleRequest(new Request(
    `stemmio-preview://${session.sessionId}${PREVIEW_BOOTSTRAP_PATH}`,
  ));
  assert.match(await bootstrapResponse.text(), /ownedBootstrapRan/u);
});

test("preview keeps sibling assets beside the original after HTML is copied into a project", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "stemmio-preview-imported-siblings-"),
  );
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const originalDirectory = path.join(temporaryRoot, "原稿");
  const projectDirectory = path.join(temporaryRoot, "项目");
  await mkdir(originalDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });
  const originalPath = path.join(originalDirectory, "图表报告.html");
  const projectPath = path.join(projectDirectory, "图表报告-V1.html");
  const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <img src="pixel.png" alt="">
  <script src="chart.js"></script>
</body>
</html>`;
  await writeFile(originalPath, html, "utf8");
  await writeFile(projectPath, html, "utf8");
  await writeFile(path.join(originalDirectory, "style.css"), "body{background:#111}", "utf8");
  await writeFile(path.join(originalDirectory, "pixel.png"), "png", "utf8");
  await writeFile(path.join(originalDirectory, "chart.js"), "window.chartReady=true;", "utf8");

  const originalRoot = await resolvePreviewSourceRoot(originalPath);
  assert.equal(originalRoot, await realpath(originalDirectory));
  const fromOriginal = await collectDeclaredPreviewAssets({
    html,
    sourceRoot: originalRoot,
  });
  assert.equal(fromOriginal.has("style.css"), true);
  assert.equal(fromOriginal.has("pixel.png"), true);
  assert.equal(fromOriginal.has("chart.js"), true);

  const fromProject = await collectDeclaredPreviewAssets({
    html,
    sourceRoot: await resolvePreviewSourceRoot(projectPath),
  });
  assert.equal(fromProject.has("pixel.png"), false);
  assert.equal(fromProject.has("style.css"), false);
  assert.equal(fromProject.has("chart.js"), false);

  await rm(originalPath);
  const afterTrash = await resolvePreviewSourceRoot(originalDirectory);
  assert.equal(afterTrash, await realpath(originalDirectory));
  const fromDirectory = await collectDeclaredPreviewAssets({
    html,
    sourceRoot: afterTrash,
  });
  assert.equal(fromDirectory.has("pixel.png"), true);
});

test("preview session operation forwards a live session id for in-place refresh", async () => {
  const calls = [];
  const operation = createPreviewSessionOperation({
    authorizeSourcePath: async (sourcePath) => sourcePath,
    createSession: async (payload) => {
      calls.push(payload);
      return { sessionId: payload.sessionId };
    },
  });
  await operation({
    html: "<p>preview</p>",
    bootstrapJavaScript: "void 0;",
    sourcePath: "/canonical/report.html",
    sessionId: "0123456789abcdef0123456789abcdef",
    ignored: "not forwarded",
  });
  assert.deepEqual(calls, [{
    html: "<p>preview</p>",
    bootstrapJavaScript: "void 0;",
    sourcePath: "/canonical/report.html",
    sessionId: "0123456789abcdef0123456789abcdef",
  }]);
});

test("a full preview session map evicts the least-recently-accessed idle session", async () => {
  let now = 1_000;
  let nextId = 0;
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unreachable"),
    maxSessions: 2,
    now: () => now,
    randomSessionId: () => {
      nextId += 1;
      return nextId.toString(16).padStart(32, "0");
    },
  });
  const first = await controller.createSession({
    html: "<p>first</p>",
    bootstrapJavaScript: "void 0;",
  });
  now = 2_000;
  const second = await controller.createSession({
    html: "<p>second</p>",
    bootstrapJavaScript: "void 0;",
  });
  now = 3_000;
  assert.equal((await controller.handleRequest(new Request(first.url))).status, 200);
  now = 4_000;
  const third = await controller.createSession({
    html: "<p>third</p>",
    bootstrapJavaScript: "void 0;",
  });
  assert.equal(controller.sessionCount(), 2);
  assert.equal((await controller.handleRequest(new Request(first.url))).status, 200);
  assert.equal((await controller.handleRequest(new Request(second.url))).status, 404);
  assert.equal((await controller.handleRequest(new Request(third.url))).status, 200);
  assert.notEqual(third.sessionId, first.sessionId);
  assert.notEqual(third.sessionId, second.sessionId);
});

test("preview inspection reports expiry and revocation without extending the resource lease", async () => {
  let now = 1_000;
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unreachable"),
    now: () => now,
    sessionTtlMs: 100,
  });
  const first = await controller.createSession({ html: "<p>first</p>", bootstrapJavaScript: "void 0;" });
  now += 90;
  assert.deepEqual(controller.inspectSession(first.sessionId), { active: true });
  now += 11;
  assert.deepEqual(controller.inspectSession(first.sessionId), { active: false });
  assert.equal((await controller.handleRequest(new Request(first.url))).status, 404);
  const second = await controller.createSession({ html: "<p>second</p>", bootstrapJavaScript: "void 0;" });
  assert.deepEqual(controller.inspectSession(second.sessionId), { active: true });
  controller.revokeSession(second.sessionId);
  assert.deepEqual(controller.inspectSession(second.sessionId), { active: false });
  assert.deepEqual(controller.inspectSession("invalid"), { active: false });
});

test("refreshing a preview session keeps its id and replaces declared sibling assets", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "stemmio-preview-session-refresh-"),
  );
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await writeFile(path.join(temporaryRoot, "first.png"), "first");
  await writeFile(path.join(temporaryRoot, "second.png"), "second");
  const sourcePath = path.join(temporaryRoot, "report.html");
  await writeFile(sourcePath, '<img src="first.png">', "utf8");
  const fetched = [];
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async (url) => {
      fetched.push(url);
      return new Response("asset", { headers: { "content-type": "image/png" } });
    },
    randomSessionId: () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const first = await controller.createSession({
    html: '<img src="first.png">',
    bootstrapJavaScript: "void 0;",
    sourcePath,
  });
  const refreshed = await controller.createSession({
    html: '<img src="second.png">',
    bootstrapJavaScript: "void 0;",
    sourcePath,
    sessionId: first.sessionId,
  });
  assert.equal(refreshed.sessionId, first.sessionId);
  assert.equal(refreshed.url, first.url);
  assert.equal(controller.sessionCount(), 1);
  assert.equal((await controller.handleRequest(new Request(
    `stemmio-preview://${first.sessionId}/second.png`,
  ))).status, 200);
  assert.equal((await controller.handleRequest(new Request(
    `stemmio-preview://${first.sessionId}/first.png`,
  ))).status, 404);
  assert.equal(fetched.length, 1);
});
