// Native HTTP Agent resource-safety policy for frozen execution. This bound
// protects Bridge parsing and memory use; it is not a model-capacity estimate.
// Callers own bytes, identity, configuration snapshots and error presentation.
export const HTTP_AGENT_MAX_SERIALIZED_INPUT_BYTES = 2 * 1024 * 1024;
export const HTTP_AGENT_INPUT_POLICY_REVISION = "2026-09-17.1";

export function httpAgentSupportsTextAttachment({ mediaType, fileName } = {}) {
  const type = String(mediaType || "").toLowerCase();
  if (type.startsWith("text/")
    || ["application/json", "application/xml", "application/javascript"].includes(type)
    || type.endsWith("+json") || type.endsWith("+xml")) return true;
  if (type && type !== "application/octet-stream") return false;
  return /\.(?:txt|md|markdown|json|jsonl|csv|tsv|xml|html?|css|js|jsx|ts|tsx|yml|yaml|toml|ini|log|sql|py|rb|go|rs|java|c|h|cpp|hpp|sh|zsh|fish)$/iu
    .test(String(fileName || ""));
}

export function decodeHttpAgentText(bytes, { allowEmpty = true } = {}) {
  if (!(bytes instanceof Uint8Array) || (!allowEmpty && !bytes.byteLength) || bytes.includes(0)) return null;
  try {
    // Preserve a literal BOM rather than silently changing frozen source text.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
