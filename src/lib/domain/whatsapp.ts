function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function extractWhatsAppMessageText(
  message: Record<string, unknown>,
) {
  const conversation = string(message.conversation);
  if (conversation) return conversation;

  const extended = record(message.extendedTextMessage);
  const extendedText = string(extended?.text);
  if (extendedText) return extendedText;

  const listResponse = record(message.listResponseMessage);
  const singleSelect = record(listResponse?.singleSelectReply);
  const selectedRowId = string(singleSelect?.selectedRowId);
  if (selectedRowId) return selectedRowId;

  const buttonResponse = record(message.buttonsResponseMessage);
  const selectedButtonId = string(buttonResponse?.selectedButtonId);
  if (selectedButtonId) return selectedButtonId;

  const interactiveResponse = record(message.interactiveResponseMessage);
  const nativeFlowResponse = record(
    interactiveResponse?.nativeFlowResponseMessage,
  );
  const paramsJson = string(nativeFlowResponse?.paramsJson);
  if (paramsJson) {
    try {
      const params = record(JSON.parse(paramsJson));
      return string(params?.id) || string(params?.rowId);
    } catch {
      return "";
    }
  }

  return "";
}
