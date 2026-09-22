import assert from "node:assert/strict";
import test from "node:test";

import { createCommentCanvasPort } from "../app/workbench/comment-canvas-port.js";

test("comment canvas port publishes selection without storing comment facts", () => {
  const port = createCommentCanvasPort();
  const initial = port.getSnapshot();
  let notifications = 0;
  const unsubscribe = port.subscribe(() => {
    notifications += 1;
  });
  const selection = {
    id: "hero",
    label: "Hero",
    selector: "#hero",
    level: "element",
    tagName: "section",
    resolution: "exact",
    sourceAnchor: null,
  };

  port.setSelection(selection);
  assert.equal(port.getSnapshot().selection, selection);
  assert.equal(notifications, 1);
  port.setSelection(selection);
  assert.equal(notifications, 1);
  port.setSelection(null);
  assert.equal(notifications, 2);
  assert.notEqual(port.getSnapshot(), initial);

  unsubscribe();
  port.setSelection(selection);
  assert.equal(notifications, 2);
});

test("comment canvas port stabilizes geometry and suppresses identical layout publications", () => {
  const port = createCommentCanvasPort();
  let notifications = 0;
  port.subscribe(() => {
    notifications += 1;
  });
  const target = {
    targetId: "hero",
    status: "visible",
    resolution: "exact",
    top: 120,
    height: 42,
  };
  const layout = {
    sourceSha256: "sha256:source",
    viewContextGeneration: 3,
    targetIds: ["hero"],
    targets: [target],
    contentHeight: 980,
    ready: true,
    textEditing: false,
  };

  port.publishLayout(layout);
  const published = port.getSnapshot();
  assert.equal(published.layoutAuthority.ready, true);
  assert.equal(published.layoutAuthority.targetIdsKey, "hero");
  assert.equal(published.targetLayouts.hero, target);
  assert.equal(published.canvasDocumentHeight, 980);
  assert.equal(notifications, 1);

  port.publishLayout({ ...layout, targets: [{ ...target }] });
  assert.equal(port.getSnapshot(), published);
  assert.equal(notifications, 1);

  port.publishLayout({
    ...layout,
    ready: false,
    textEditing: true,
    targets: [],
  });
  assert.equal(port.getSnapshot().layoutAuthority.ready, true);
  assert.equal(port.getSnapshot().layoutAuthority.textEditing, true);
  assert.equal(port.getSnapshot().targetLayouts.hero, target);
  assert.equal(notifications, 2);

  port.resetLayout();
  assert.equal(port.getSnapshot().layoutAuthority.ready, false);
  assert.deepEqual(port.getSnapshot().targetLayouts, {});
  assert.equal(port.getSnapshot().canvasDocumentHeight, 760);
});

test("comment canvas port sequences reveal, rail reset and composer focus intents", () => {
  const port = createCommentCanvasPort();
  const target = { id: "hero" };

  port.requestReveal(target, "comment_one");
  const reveal = port.getSnapshot().revealRequest;
  assert.equal(reveal.target, target);
  assert.equal(reveal.itemKey, "comment_one");
  port.settleReveal(reveal.requestId + 1);
  assert.equal(port.getSnapshot().revealRequest, reveal);
  port.settleReveal(reveal.requestId);
  assert.equal(port.getSnapshot().revealRequest, null);

  port.resetRail();
  port.requestComposerFocus();
  assert.equal(port.getSnapshot().railResetRevision, 1);
  assert.equal(port.getSnapshot().composerFocusRevision, 1);

  port.requestCommentEditFocus("comment_edit", true);
  const editFocus = port.getSnapshot().editFocusRequest;
  assert.equal(editFocus.commentId, "comment_edit");
  assert.equal(editFocus.select, true);
  port.settleCommentEditFocus(editFocus.requestId + 1);
  assert.equal(port.getSnapshot().editFocusRequest, editFocus);
  port.settleCommentEditFocus(editFocus.requestId);
  assert.equal(port.getSnapshot().editFocusRequest, null);
});

test("comment canvas port owns cross-region rail presentation without comment facts", () => {
  const port = createCommentCanvasPort();

  port.setComposerOpen(true);
  port.setEditingCommentId("comment_edit");
  port.setFocusedCommentId("comment_focus");
  assert.equal(port.getSnapshot().composerOpen, true);
  assert.equal(port.getSnapshot().editingCommentId, "comment_edit");
  assert.equal(port.getSnapshot().focusedCommentId, "comment_focus");

  port.beginRelink("comment_relink");
  assert.equal(port.getSnapshot().relinkingTarget, "comment_relink");
  assert.equal(port.getSnapshot().relinkSelectionArmed, false);
  assert.equal(port.getSnapshot().editingCommentId, null);
  port.armRelinkSelection();
  assert.equal(port.getSnapshot().relinkSelectionArmed, true);
  port.clearRelink();
  assert.equal(port.getSnapshot().relinkingTarget, null);
  assert.equal(port.getSnapshot().relinkSelectionArmed, false);

  const target = { kind: "composer", commentId: "comment_draft" };
  port.requestAttachmentPicker(target, "image");
  const picker = port.getSnapshot().attachmentPickerRequest;
  assert.equal(picker.target, target);
  assert.equal(picker.accept, "image");
  port.settleAttachmentPicker(picker.requestId);
  assert.equal(port.getSnapshot().attachmentPickerRequest, null);

  port.resetLayout();
  assert.equal(port.getSnapshot().composerOpen, false);
  assert.equal(port.getSnapshot().focusedCommentId, null);
});


test("new reading or document intent retires a reveal before save returns", () => {
  const port = createCommentCanvasPort();
  const target = { id: "original" };
  const beforeSave = port.captureRevealIntent();
  port.cancelReveal();
  port.requestReveal(target, "saved-comment", beforeSave);
  assert.equal(port.getSnapshot().revealRequest, null);
  port.requestReveal(target, "fresh-click");
  assert.equal(port.getSnapshot().revealRequest.itemKey, "fresh-click");
  const oldRequest = port.getSnapshot().revealRequest;
  port.cancelReveal();
  assert.equal(port.getSnapshot().revealRequest, null);
  port.requestReveal(target, "new-click");
  port.settleReveal(oldRequest.requestId);
  assert.equal(port.getSnapshot().revealRequest.itemKey, "new-click");
  const beforeSwitch = port.captureRevealIntent();
  port.resetLayout();
  port.requestReveal(target, "old-document-save", beforeSwitch);
  assert.equal(port.getSnapshot().revealRequest, null);
});
