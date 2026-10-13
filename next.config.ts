import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// `next dev` 中でも Cloudflare のバインディング (getCloudflareContext) を使えるようにする。
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Cache Components (PPR) は @opennextjs/cloudflare 1.20 時点で workerd 上の
  // ストリーミングがハングする既知の問題があるため使わない。
  // このサイトは全ページをビルド時に静的生成するので不要。
  // https://github.com/opennextjs/opennextjs-cloudflare/issues/1225
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
