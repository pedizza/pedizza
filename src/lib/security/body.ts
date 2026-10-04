import { AppError } from "@/lib/errors";
export async function boundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(
          413,
          "Arquivo ou solicitação maior que o limite permitido.",
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}
