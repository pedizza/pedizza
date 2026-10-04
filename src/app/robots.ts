import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/app", "/master", "/api", "/login", "/cadastro"],
    },
  };
}
