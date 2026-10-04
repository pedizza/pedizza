import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
for (const size of [192, 512]) {
  const logo = await sharp("logo.png")
    .resize(Math.round(size * 0.76), Math.round(size * 0.76), { fit: "inside" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#ffffff" },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(`public/icons/icon-${size}.png`);
}
await sharp("public/icons/icon-192.png")
  .resize(180, 180)
  .toFile("public/icons/apple-touch-icon.png");
