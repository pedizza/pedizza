import { normalizeText } from "@/lib/domain/normalization";

const keycapDigits: Record<string, string> = {
  "0": "0️⃣",
  "1": "1️⃣",
  "2": "2️⃣",
  "3": "3️⃣",
  "4": "4️⃣",
  "5": "5️⃣",
  "6": "6️⃣",
  "7": "7️⃣",
  "8": "8️⃣",
  "9": "9️⃣",
};

export function keycapNumber(value: number) {
  return String(value)
    .split("")
    .map((digit) => keycapDigits[digit] || digit)
    .join("");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function mainMenuOption(input: string): "1" | "2" | "3" | null {
  const text = normalizeText(input).replace(/[!,?.]+/g, "");
  if (
    /^(1|pedido|pedir|fazer (um )?pedido|quero (fazer (um )?pedido|pedir))( por favor)?$/.test(
      text,
    )
  )
    return "1";
  if (
    /^(2|cardapio|ver (o )?cardapio|quero ver (o )?cardapio)( por favor)?$/.test(
      text,
    )
  )
    return "2";
  if (
    /^(3|acompanhar (meu |o )?pedido|meu pedido|status do pedido|rastrear (meu |o )?pedido)( por favor)?$/.test(
      text,
    )
  )
    return "3";
  return null;
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
