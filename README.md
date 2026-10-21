# 社会シミュレーション観察記 (simulator-misclib)

身近な社会課題をうんと単純化したモデルに落とし込み、ブラウザの中で動かして眺めるブログ型の Web アプリです。
記事ごとにルールの異なる複数の世界を並べてアニメーションし、数字とグラフで比べます。

- 第 1 回: **エスカレーター、片側を空けるべきか、両側に立つべきか** (`/sims/escalator`)
  - 朝のラッシュ / 昼の閑散時 / 電車が着いた直後の波 / 歩く側に立つ人がいる の 4 シナリオ
  - 「片側を空ける」と「両側に立つ」を同じ乱数で同時に動かして比較
  - 100 回試行の平均、待ち行列・輸送人数の時系列グラフ
- 第 2 回: **トラックの荷待ち、予約制にすれば消えるのか** (`/sims/truck-berth`)
  - いつもの平日 / 渋滞で遅れる日 / 予約しないトラックが多い / 荷物が多すぎる日 の 4 シナリオ
  - 物流センターの荷降ろしを「先着順」と「バース予約制」で、同じトラック・同じ遅れのまま同時に動かして比較
  - 荷待ち時間、荷待ち+荷役の 2 時間超え割合、時間帯に遅れた割合、予約なし車の荷待ちを 100 日試行で集計
- 第 2 回: **地震の警報、どこで鳴らせばいちばん多くの人を守れるか** (`/sims/quake-alert`)
  - 2026 年 10 月 16 日の緊急地震速報「M9.9」誤報がきっかけ
  - 鳴らす震度のしきい値だけが違う 3 つの町で、同じ 30 年分の地震を流して比較
  - 空振りで警報への信頼が下がる「オオカミ少年」効果、誤作動、大きな揺れがまれな町などのシナリオ
- 第 2 回: **女性トイレの行列は、便器を何個ずつに分ければ消えるのか** (`/sims/toilet`)
  - 国交省の便器数ガイドライン (2026 年 6 月) を題材に、16 個の便器の男女の分け方を変えて比較
  - 駅の夕方 / 劇場の休憩 15 分 / 連休の SA / 客層が入れ替わるアリーナ (可変トイレ) の 4 シナリオ
  - 右の世界の配分をスライダーで変えて、男女の待ち時間が釣り合う点を探せる

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
npm run og        # OG 画像 (public/og/*.png) を再生成。記事を追加したら実行する
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
4. `npm run og` で OG 画像を生成してコミットする (sitemap と構造化データは一覧から自動生成)

モデルは React や DOM に依存しない純粋関数として書くと、`node --test` で検証でき、100 回試行などの集計にもそのまま使えます。

## 免責

ここで示す結果は単純化したモデルによる思考実験であり、現実の予測や安全対策・政策の根拠ではありません。
