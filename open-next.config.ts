import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// このサイトは全ページをビルド時に事前レンダリングする静的コンテンツなので、
// R2 / KV を使わず Workers Static Assets をキャッシュとして利用する。
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
