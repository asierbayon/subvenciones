import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [
      {
        source: "/:path*",
        missing: [{ type: "header", key: "RSC" }],
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=120, stale-while-revalidate=600",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
