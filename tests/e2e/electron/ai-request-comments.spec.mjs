import { expect, test } from "@playwright/test";
import {
  ORIGINAL_TEXT,
  activateNativeEdit,
  caseSelector,
  chooseClipboardDelivery,
  closeStemmioGracefully,
  createSourceFixture,
  sha256,
  existsSync,
  loadedDiskFrame,
  launchStemmio,
  managedProjectRoots,
  mkdtempSync,
  openRailGlobalCommentComposer,
  path,
  readFileSync,
  realpathSync,
  rmSync,
  removeSourceFixture,
  rewriteWorkspaceDraftComment,
  seedLegacyV3Project,
  setTextSelection,
  stopStemmio,
  tmpdir,
  waitForProjectReady,
  writeFileSync,
  workspaceContainsDraftComment,
} from "./ai-closed-loop-helpers.mjs";

test("opening a pre-v4 project imports its HTML as a new v4 V1", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("supplement-ai-loop.html");
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "stemmio-native-e2e-ai-loop-"),
  );
  const legacy = await seedLegacyV3Project({
    isolatedUserData,
    sourcePath: fixture.sourcePath,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    isolatedUserData,
  });
  try {
    await waitForProjectReady(launched.page);
    const externalSourcePath = realpathSync(fixture.sourcePath);
    await expect.poll(async () => {
      const active = await launched.page.evaluate(
        async () => await window.stemmioProjects?.getActiveProject(),
      );
      return active?.sourcePath && active.sourcePath !== externalSourcePath
        ? active
        : null;
    }, { timeout: 45_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/supplement-ai-loop\.html$/u),
    });
    const active = await launched.page.evaluate(
      async () => await window.stemmioProjects?.getActiveProject(),
    );
    expect(active.sourcePath).not.toBe(externalSourcePath);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    const activeCanonicalPath = realpathSync(active.sourcePath);
    const projectRoot = managedProjectRoots(launched.workspace).find((root) => (
      activeCanonicalPath.startsWith(`${realpathSync(root)}${path.sep}`)
    ));
    expect(projectRoot).toBeTruthy();
    const project = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "project.json"),
      "utf8",
    ));
    expect(project.projectId).not.toBe(legacy.projectId);
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "manifest.json"),
      "utf8",
    ));
    expect(manifest.versions.map((version) => version.versionId)).toEqual(["ver_0001"]);
    await expect((await loadedDiskFrame(launched.page, active.sourcePath))
      .locator(caseSelector("list-item"))).toHaveText(ORIGINAL_TEXT);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a persisted global comment stays exact after restart and sends directly", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("global-comment-restart.html");
  const firstLaunch = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  const commentText = "重启后仍然保持整个页面的视觉层级。";
  let activeLaunch = firstLaunch;
  try {
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath);
    await openRailGlobalCommentComposer(firstLaunch.page);
    await firstLaunch.page.getByRole("textbox", { name: "评论内容" })
      .fill(commentText);
    await firstLaunch.page.getByRole("button", { name: "评论", exact: true }).click();
    await expect(firstLaunch.page.locator(".comment-card")
      .filter({ hasText: commentText }))
      .toHaveAttribute("data-resolution", "exact");
    const externalSourcePath = realpathSync(fixture.sourcePath);
    await expect.poll(async () => {
      const activeSourcePath = await firstLaunch.page.evaluate(
        async () => (await window.stemmioProjects?.getActiveProject())?.sourcePath || "",
      );
      return activeSourcePath && activeSourcePath !== externalSourcePath
        ? activeSourcePath
        : "";
    }, { timeout: 45_000 }).not.toBe("");
    const managedSourcePath = await firstLaunch.page.evaluate(
      async () => (await window.stemmioProjects?.getActiveProject())?.sourcePath || "",
    );
    const frame = await loadedDiskFrame(firstLaunch.page, managedSourcePath);
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_TEXT.length);
    await firstLaunch.page.keyboard.insertText("重启兼容测试");
    await expect.poll(
      () => existsSync(managedSourcePath)
        ? readFileSync(managedSourcePath, "utf8")
        : "",
      { timeout: 20_000 },
    ).toContain("重启兼容测试");
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, commentText),
      { timeout: 20_000 },
    ).toBe(true);

    await closeStemmioGracefully(firstLaunch.electronApp, firstLaunch.page);
    expect(workspaceContainsDraftComment(firstLaunch.workspace, commentText)).toBe(true);
    expect(rewriteWorkspaceDraftComment(
      firstLaunch.workspace,
      commentText,
      (comment) => {
        delete comment.target.fingerprint;
        comment.target.resolution = "orphaned";
      },
    )).toBe(true);
    activeLaunch = await launchStemmio({
      activeSourcePath: managedSourcePath,
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    await expect.poll(
      () => workspaceContainsDraftComment(activeLaunch.workspace, commentText),
      { timeout: 20_000 },
    ).toBe(true);
    await loadedDiskFrame(activeLaunch.page, managedSourcePath);
    const recoveredComment = activeLaunch.page.locator(".comment-card")
      .filter({ hasText: commentText });
    await expect(recoveredComment).toHaveAttribute("data-resolution", "exact");
    await expect(recoveredComment.getByText("原位置已变化")).toHaveCount(0);

    await activeLaunch.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(activeLaunch.page);
    // The copied-task fact now lives in the sidebar action bar instead of a toast.
    await expect(activeLaunch.page.getByTestId("ai-conversation-action-bar")
      .getByText("任务已复制，等你的 AI 改完", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(activeLaunch.page.getByText(/评论需要重新定位/u)).toHaveCount(0);
  } finally {
    await stopStemmio(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a file attachment is frozen as Request bytes before the AI handoff", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("attachment-ai-loop.html");
  const attachmentBytes = Buffer.from([0, 1, 2, 3, 13, 10, 254, 255]);
  const attachmentSourcePath = path.join(fixture.sourceDirectory, "reference.bin");
  writeFileSync(attachmentSourcePath, attachmentBytes);
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    const active = await launched.page.evaluate(
      () => window.stemmioProjects?.getActiveProject(),
    );
    const frame = await loadedDiskFrame(
      launched.page,
      active?.sourcePath || fixture.sourcePath,
    );
    const target = frame.locator(caseSelector("list-item"));
    await launched.page.keyboard.press("Escape");
    await frame.locator("body").click({ position: { x: 2, y: 2 } });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    const commentButton = launched.page.getByRole("button", { name: /给.+留评论/u })
      .filter({ visible: true })
      .first();
    await expect(commentButton).toBeVisible();
    await commentButton.click();
    await expect(launched.page.getByRole("textbox", { name: "评论内容" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "添加附件", exact: true }).click();
    await launched.page.locator('input[type="file"]').last().setInputFiles(attachmentSourcePath);
    await expect(launched.page.locator(".comment-composer").getByText("reference.bin"))
      .toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();
    await expect(launched.page.getByRole("textbox", { name: "评论内容" }))
      .toBeHidden({ timeout: 45_000 });

    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(launched.page);
    let promptPath = "";
    await expect.poll(async () => {
      const copied = await launched.electronApp.evaluate(
        ({ clipboard }) => clipboard.readText(),
      );
      promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
      return Boolean(promptPath && existsSync(promptPath));
    }, { timeout: 20_000 }).toBe(true);
    const requestRoot = path.dirname(promptPath);
    const requestRecord = JSON.parse(
      readFileSync(path.join(requestRoot, "request.json"), "utf8"),
    );
    const frozenComment = requestRecord.request.comments[0];
    const frozenAttachment = frozenComment.attachments[0];
    const requestRelativePath = frozenAttachment.requestRelativePath;
    const frozenPath = path.join(requestRoot, ...requestRelativePath.split("/"));
    const projectRoot = path.resolve(requestRoot, "../../..");
    const draftPath = path.join(
      projectRoot,
      ...frozenAttachment.relativePath.split("/"),
    );
    expect(readFileSync(draftPath).equals(attachmentBytes)).toBe(true);
    expect(readFileSync(frozenPath).equals(attachmentBytes)).toBe(true);
    expect(frozenAttachment.byteLength).toBe(attachmentBytes.byteLength);
    expect(frozenAttachment.sha256).toBe(sha256(attachmentBytes));
    const manifest = JSON.parse(
      readFileSync(path.join(requestRoot, "input-manifest.json"), "utf8"),
    );
    expect(manifest.files).toContainEqual({
      path: requestRelativePath,
      role: "comment-attachment",
      mediaType: frozenAttachment.mediaType,
      byteLength: attachmentBytes.byteLength,
      sha256: sha256(attachmentBytes),
    });
    expect(JSON.parse(
      readFileSync(path.join(requestRoot, "input", "annotations", "records.json"), "utf8"),
    ).comments[0].attachments[0].requestRelativePath).toBe(requestRelativePath);
    expect(readFileSync(path.join(requestRoot, "PROMPT.md"), "utf8"))
      .toContain(requestRelativePath);

    rmSync(draftPath);
    expect(readFileSync(frozenPath).equals(attachmentBytes)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("two image comments keep their attachment identity through AI freeze", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("two-image-comments.html");
  const imageBytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db40000000049454e44ae426082",
    "hex",
  );
  const secondImageBytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cff01f00040101ff71eb47e50000000049454e44ae426082",
    "hex",
  );
  const attachments = [
    { fileName: "first.png", text: "第一张参考图只服务于第一条评论。", bytes: imageBytes },
    { fileName: "second.png", text: "第二张参考图只服务于第二条评论。", bytes: secondImageBytes },
  ];
  for (const attachment of attachments) {
    writeFileSync(path.join(fixture.sourceDirectory, attachment.fileName), attachment.bytes);
  }
  const discardedImagePath = path.join(fixture.sourceDirectory, "discarded.png");
  writeFileSync(discardedImagePath, imageBytes);
  const firstLaunch = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  let activeLaunch = firstLaunch;
  try {
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath);
    for (const attachment of attachments) {
      await openRailGlobalCommentComposer(activeLaunch.page);
      const composer = activeLaunch.page.locator(".comment-composer");
      await composer.getByRole("textbox", { name: "评论内容" }).fill(attachment.text);
      if (attachment.fileName === "first.png") {
        await composer.getByRole("button", { name: "添加图片", exact: true }).click();
        await activeLaunch.page.locator('input[type="file"]').last()
          .setInputFiles(discardedImagePath);
        await expect(composer.getByRole("button", { name: "预览图片 discarded.png" }))
          .toBeVisible({ timeout: 30_000 });
        await composer.getByRole("button", { name: "移除图片 discarded.png" }).click();
        await expect(composer.getByRole("button", { name: "预览图片 discarded.png" }))
          .toHaveCount(0);
      }
      await composer.getByRole("button", { name: "添加图片", exact: true }).click();
      await activeLaunch.page.locator('input[type="file"]').last()
        .setInputFiles(path.join(fixture.sourceDirectory, attachment.fileName));
      await expect(composer.getByRole("button", {
        name: `预览图片 ${attachment.fileName}`,
        exact: true,
      })).toBeVisible({ timeout: 30_000 });
      await composer.getByRole("button", { name: "评论", exact: true }).click();
      await expect(composer.getByRole("textbox", { name: "评论内容" }))
        .toBeHidden({ timeout: 45_000 });
    }
    for (const attachment of attachments) {
      await expect(activeLaunch.page.getByRole("button", {
        name: `预览图片 ${attachment.fileName}`,
        exact: true,
      })).toBeVisible({ timeout: 30_000 });
    }
    const firstPreview = activeLaunch.page.getByRole("button", {
      name: "预览图片 first.png",
      exact: true,
    });
    await firstPreview.scrollIntoViewIfNeeded();
    await firstPreview.evaluate((button) => button.click());
    await expect(activeLaunch.page.getByRole("dialog", {
      name: "预览图片 first.png",
      exact: true,
    })).toBeVisible();
    await activeLaunch.page.getByRole("button", { name: "关闭图片预览" }).click();

    await activeLaunch.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(activeLaunch.page);
    let promptPath = "";
    await expect.poll(async () => {
      const copied = await activeLaunch.electronApp.evaluate(
        ({ clipboard }) => clipboard.readText(),
      );
      promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
      return Boolean(promptPath && existsSync(promptPath));
    }, { timeout: 20_000 }).toBe(true);
    const requestRoot = path.dirname(promptPath);
    const requestRecord = JSON.parse(
      readFileSync(path.join(requestRoot, "request.json"), "utf8"),
    );
    const comments = requestRecord.request.comments.filter((comment) => (
      attachments.some((attachment) => comment.text === attachment.text)
    ));
    expect(comments).toHaveLength(2);
    const frozenAttachments = requestRecord.request.taskSpec.attachments;
    expect(frozenAttachments).toHaveLength(2);
    for (const comment of comments) {
      expect(comment.attachments).toHaveLength(1);
      const attachment = comment.attachments[0];
      const expected = attachments.find((candidate) => candidate.text === comment.text);
      expect(expected).toBeTruthy();
      expect(attachment.relativePath)
        .toMatch(new RegExp(`^draft/attachments/${comment.commentId}/`));
      const instruction = requestRecord.request.taskSpec.instructions.find((candidate) => (
        candidate.instructionId === `instruction_${comment.commentId.replace(/^comment_/u, "")}`
      ));
      expect(instruction.attachmentRefs).toEqual([attachment.attachmentId]);
      const frozen = frozenAttachments.find((candidate) => (
        candidate.attachmentId === attachment.attachmentId
      ));
      expect(frozen.commentId).toBe(comment.commentId);
      expect(readFileSync(path.join(requestRoot, ...frozen.requestRelativePath.split("/")))
        .equals(expected.bytes)).toBe(true);
    }
  } finally {
    await stopStemmio(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
