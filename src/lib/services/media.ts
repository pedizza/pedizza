import "server-only";
import sharp from "sharp";
import { invariant } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
export function detectMedia(data: Buffer) {
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return "image/jpeg";
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (data.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (data.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (
    data.toString("ascii", 0, 3) === "ID3" ||
    (data[0] === 255 && (data[1] & 224) === 224)
  )
    return "audio/mpeg";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WAVE"
  )
    return "audio/wav";
  if (data.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  return null;
}
export async function storeMedia(
  tenant: string,
  folder: string,
  data: Buffer,
  name: string,
  imagesOnly = false,
) {
  invariant(
    data.length > 0 && data.length <= (imagesOnly ? 4 : 20) * 1024 * 1024,
    "Arquivo fora do limite permitido.",
  );
  let mime = detectMedia(data);
  invariant(
    mime && (!imagesOnly || mime.startsWith("image/")),
    "Formato não suportado. Use JPG, PNG, WebP, PDF, MP3, OGG, WAV ou MP4.",
  );
  if (mime.startsWith("image/")) {
    data = await sharp(data, { limitInputPixels: 25000000 })
      .rotate()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    mime = "image/webp";
  }
  const ext = (
    {
      "image/webp": "webp",
      "application/pdf": "pdf",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "video/mp4": "mp4",
    } as Record<string, string>
  )[mime];
  const path = `${tenant}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin()
    .storage.from("conversation-media")
    .upload(path, data, { contentType: mime, upsert: false });
  invariant(!error, "Não foi possível armazenar o arquivo.", 503);
  return {
    path,
    mime,
    name:
      name.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 150) || "anexo." + ext,
  };
}
