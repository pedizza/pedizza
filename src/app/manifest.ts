import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pedizza",
    short_name: "Pedizza",
    description: "Sua pizzaria, organizada.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f9",
    theme_color: "#171f2c",
    lang: "pt-BR",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
