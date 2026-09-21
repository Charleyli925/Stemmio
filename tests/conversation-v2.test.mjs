import test from "node:test";
import assert from "node:assert/strict";

import {
  appendConversationContext,
  createEmptyConversation,
  createEmptyConversationDraft,
  normalizeConversation,
  normalizeConversationDraft,
  sealConversationTurn,
  startConversationTurn,
} from "../shared/conversation.mjs";

const now = () => "2026-08-25T00:00:00.000Z";
const projectId = "project_conversation_v2";
const documentId = "doc_conversation_v2";
const contextId = "context_conversationv2";

function legacyConversation() {
  return {
    schemaVersion: "1.0.0",
    conversationId: "conversation_legacyv2test",
    projectId,
    documentId,
    title: "legacy",
    status: "active",
    createdAt: now(),
    updatedAt: now(),
    archivedAt: null,
    activeContextId: contextId,
    lastSequence: 1,
    revision: 1,
    futureRoot: { keep: true },
    contexts: [{
      contextId,
      projectId,
      documentId,
      workingCopyId: null,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      basedOnVersionId: null,
      exactVersionId: null,
      requestId: null,
      attemptId: null,
      candidateId: null,
      side: "working-copy",
      createdAt: now(),
    }],
    turns: [{
      turnId: "turn_legacyv2test12",
      contextId,
      mode: "discussion",
      status: "completed",
      startedMessageId: null,
      modelId: null,
      modelDisplayName: "Qoder",
      reasoningEffort: "qoder-default",
      startedAt: now(),
      completedAt: now(),
      interruptedAt: null,
      requestId: null,
      attemptId: null,
      candidateId: null,
      futureTurn: 7,
    }],
    messages: [{
      messageId: "message_legacyv2test",
      turnId: "turn_legacyv2test12",
      sequence: 1,
      actor: "qoder",
      kind: "text",
      status: "completed",
      text: "hello",
      contextId,
      createdAt: now(),
      completedAt: now(),
      parentMessageId: null,
      modelId: null,
      modelDisplayName: "Qoder",
      reasoningEffort: "qoder-default",
      requestId: null,
      attemptId: null,
      candidateId: null,
      futureMessage: true,
    }],
  };
}

test("v1 conversation records are explicitly unsupported", () => {
  const legacy = legacyConversation();
  assert.throws(
    () => normalizeConversation(legacy, { projectId, documentId }),
    (error) => error.code === "UNSUPPORTED_CONVERSATION_SCHEMA",
  );
});

test("v3 writer stores generic Agent actor and provider-bound actual model", () => {
  let conversation = createEmptyConversation({
    conversationId: "conversation_writerv2test",
    projectId,
    documentId,
    now,
  });
  conversation = appendConversationContext(conversation, {
    contextId,
    sourceSha256: `sha256:${"b".repeat(64)}`,
    side: "working-copy",
  }, { now });
  conversation = startConversationTurn(conversation, {
    turnId: "turn_writerv2test123",
    contextId,
    mode: "discussion",
    status: "running",
    providerSelection: {
      providerId: "synthetic",
      runtimeId: "rpc",
      requestedModelId: "synthetic:model-a",
      resolvedModelId: "synthetic:model-a",
      reasoning: { requested: "high", applied: "high", resolution: "exact" },
    },
    providerBinding: { providerId: "synthetic", runtimeId: "rpc" },
    capabilitySnapshotFingerprint: `sha256:${"c".repeat(64)}`,
  }, { now });
  conversation = sealConversationTurn(conversation, {
    turnId: "turn_writerv2test123",
    status: "completed",
    messages: [{
      messageId: "message_writerv2test1",
      actor: "agent",
      providerId: "synthetic",
      actualModelId: "synthetic:model-a",
      kind: "text",
      status: "completed",
      text: "done",
    }],
  }, { now });
  assert.equal(conversation.schemaVersion, "3.0.0");
  assert.equal(conversation.messages[0].actor, "agent");
  assert.equal(JSON.stringify(conversation).includes('"actor":"qoder"'), false);
});

test("v2 conversation records are explicitly unsupported", () => {
  const current = createEmptyConversation({
    conversationId: "conversation_v2unsupported",
    projectId,
    documentId,
    now,
  });
  assert.throws(
    () => normalizeConversation({ ...current, schemaVersion: "2.0.0" }, { projectId, documentId }),
    (error) => error.code === "UNSUPPORTED_CONVERSATION_SCHEMA",
  );
});

test("v1 conversation drafts are explicitly unsupported", () => {
  const legacy = {
    schemaVersion: "1.0.0",
    conversationId: "conversation_draftv2test12",
    revision: 2,
    updatedAt: now(),
    text: "draft",
    intent: "discuss",
    modelId: "model-a",
    modelDisplayName: "Model A",
    deliveryMode: "qoder-acp",
    futureDraft: { keep: true },
  };
  assert.throws(
    () => normalizeConversationDraft(legacy),
    (error) => error.code === "UNSUPPORTED_CONVERSATION_SCHEMA",
  );

  const created = createEmptyConversationDraft({
    conversationId: "conversation_draftwriter2",
    now,
  });
  assert.equal(created.schemaVersion, "2.0.0");
});
