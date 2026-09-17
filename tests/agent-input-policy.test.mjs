import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHttpAgentText, httpAgentSupportsTextAttachment,
  HTTP_AGENT_MAX_SERIALIZED_INPUT_BYTES,
} from "../shared/agent-input-policy.mjs";

test("HTTP serialized-input safety limit is an explicit local resource bound", () => {
  assert.equal(HTTP_AGENT_MAX_SERIALIZED_INPUT_BYTES, 2 * 1024 * 1024);
});

test("UTF-8 decoding preserves BOM and distinguishes empty rules from empty attachments", () => {
  const text = "\ufeff中文😀";
  assert.equal(decodeHttpAgentText(new TextEncoder().encode(text)), text);
  assert.equal(decodeHttpAgentText(new Uint8Array()), "");
  assert.equal(decodeHttpAgentText(new Uint8Array(), { allowEmpty: false }), null);
  assert.equal(decodeHttpAgentText(new Uint8Array([0xc3, 0x28])), null);
  assert.equal(decodeHttpAgentText(new Uint8Array([65, 0, 66])), null);
  assert.equal(httpAgentSupportsTextAttachment({ mediaType: "text/plain", fileName: "data.bin" }), true);
  assert.equal(httpAgentSupportsTextAttachment({ mediaType: "image/png", fileName: "data.txt" }), false);
  assert.equal(httpAgentSupportsTextAttachment({ mediaType: "application/octet-stream", fileName: "data.md" }), true);
});
