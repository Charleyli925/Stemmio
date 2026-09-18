export function settingsCredentialRemoveAction({
  card,
  rememberedKey,
  onRemoveRememberedKey,
}) {
  const reconcile = card.credentialPersist?.operationKind === "clear"
    && ["pending", "unknown", "unavailable", "unreadable"]
      .includes(String(card.credentialPersist.status || ""));
  if (
    card.selection.providerId !== "stemmio"
    || !onRemoveRememberedKey
    || (!rememberedKey && !reconcile)
  ) return null;
  return Object.freeze({
    label: reconcile ? "确认移除结果" : "移除 API Key",
    description: reconcile ? "继续确认上次移除操作" : "移除后需要重新填写",
    reconcile,
    trigger: (options) => Promise.resolve(onRemoveRememberedKey(card.selection, options)),
  });
}
