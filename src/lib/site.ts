/** サイト名とブランド情報。表示文言はここに集約する */
export const SITE_NAME = "Misclib Lab";
export const SITE_TAGLINE = "社会シミュレーション観察記";
export const SITE_DESCRIPTION =
  "Misclib LLC の遊びプロジェクト。身近な社会課題を思考実験としてシミュレーションし、その結果をアニメーションとグラフで眺めるブログ。";

export const COMPANY = {
  name: "Misclib LLC",
  nameJa: "Misclib合同会社",
  url: "https://www.misclib.com/ja/",
  services: "https://www.misclib.com/ja/#services",
  company: "https://www.misclib.com/ja/#company",
  contact: "https://www.misclib.com/ja/contact/",
  blog: "https://www.misclib.com/blog/",
  /** 本業の一行説明 (会社サイトの文言に合わせる) */
  summary: "自社開発の SaaS と、生成AI・ゼロトラストの導入支援。小さなチームで、設計から運用までを一貫して手がけています。",
  products: [
    { name: "DB Loom", desc: "文書を、使えるデータベースへ", url: "https://www.db-loom.com/ja" },
    { name: "アポハブ", desc: "移動時間を考慮する予約管理", url: "https://www.appointment-hub.com" },
    { name: "フレキシブルQR", desc: "後からリンク先を変えられる QR", url: "https://qr.misclib.com" },
    { name: "Kichō AI", desc: "領収書をスキャンして自動仕訳", url: "https://www.kichoai.com" },
  ],
} as const;
