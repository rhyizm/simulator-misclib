# 社会シミュレーション観察記 (simulator-misclib)

身近な社会課題をうんと単純化したモデルに落とし込み、ブラウザの中で動かして眺めるブログ型の Web アプリです。
記事ごとにルールの異なる複数の世界を並べてアニメーションし、数字とグラフで比べます。

- 第 1 回: **エスカレーター、片側を空けるべきか、両側に立つべきか** (`/sims/escalator`)
  - 朝のラッシュ / 昼の閑散時 / 酔っ払いが転倒 の 3 シナリオ
  - 「片側を空ける」と「両側に立つ」を同じ乱数で同時に動かして比較
  - 100 回試行の平均、待ち行列・輸送人数の時系列グラフ

## 技術構成

| 役割 | 使っているもの |
| --- | --- |
| フレームワーク | Next.js 16 (App Router, Turbopack)。全ページ静的生成 |
| UI | React 19, Tailwind CSS 4, Canvas 2D / SVG |
| デプロイ | Cloudflare Workers (Static Assets) + [@opennextjs/cloudflare](https://opennext.js.org/cloudflare) |
| シミュレーション | 依存なしの純粋 TypeScript (`src/sims/*/model.ts`)。Node の test runner で検証 |

## 開発

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # シミュレーションモデルのテスト
npm run lint
npm run typecheck
```

## Cloudflare へのデプロイ

```bash
npm run preview    # OpenNext でビルドし、ローカルの Workers ランタイム (wrangler) で確認
npm run deploy     # ビルドして Cloudflare Workers へデプロイ
```

- 本番 URL は `https://simu.misclib.com` です。`wrangler.jsonc` の `routes` に custom_domain として設定してあり、
  Cloudflare アカウントに `misclib.com` のゾーンがあれば、デプロイ時に DNS レコードと証明書が自動で作られます。
- CI やこのような自動セッションからデプロイするには、環境変数 `CLOUDFLARE_API_TOKEN`
  (Workers Scripts: Edit、Workers Routes: Edit、Zone DNS: Edit、Account Settings: Read) と
  `CLOUDFLARE_ACCOUNT_ID` が必要です。
- 設定は `wrangler.jsonc` と `open-next.config.ts` にあります。
  全ページがビルド時に静的生成されるので、キャッシュは R2 / KV を使わず Workers Static Assets を利用しています。
- Cloudflare ダッシュボードから Git 連携でデプロイする場合は、ビルドコマンドに `npx opennextjs-cloudflare build`、
  デプロイコマンドに `npx opennextjs-cloudflare deploy` を指定してください。
- ローカルで `next dev` を使うときは `.dev.vars` に `NEXTJS_ENV=development` を置きます (gitignore 済み、`.dev.vars.example` をコピー)。
- Next.js は 16.3.8 に固定しています。16.4.0 は `@opennextjs/cloudflare` 1.20.x がまだ対応しておらず、
  Workers 上で `Unexpected loadManifest(preview-props.json)` で起動に失敗します
  ([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355))。
  アダプタ側の修正が公開されたら `next` と `eslint-config-next` を上げてください。
- `cacheComponents` (PPR) はオフにしています。OpenNext 1.20 時点では workerd 上でストリーミングがハングする
  既知の問題があり ([#1225](https://github.com/opennextjs/opennextjs-cloudflare/issues/1225))、
  このサイトは静的生成だけで足りるためです。

## 新しいシミュレーションを追加する

1. `src/sims/<slug>/` にモデル (`model.ts`)、シナリオ、描画コンポーネント、記事本文 (`article.tsx`) を置く
2. `src/lib/sims.ts` の一覧にタイトル・要約・日付を追加する
3. `src/sims/index.ts` で slug とコンポーネントを対応づける

モデルは React や DOM に依存しない純粋関数として書くと、`node --test` で検証でき、100 回試行などの集計にもそのまま使えます。

## 免責

ここで示す結果は単純化したモデルによる思考実験であり、現実の予測や安全対策・政策の根拠ではありません。
