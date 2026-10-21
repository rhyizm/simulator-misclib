/**
 * 公開中のシミュレーション記事の一覧。
 * 描画コンポーネント本体は src/sims/index.ts で slug に対応づける。
 */
export interface SimEntry {
  slug: string;
  no: number;
  title: string;
  question: string;
  summary: string;
  date: string;
  tags: string[];
}

export const simEntries: SimEntry[] = [
  {
    slug: "truck-berth",
    no: 2,
    title: "トラックの荷待ち、予約制にすれば消えるのか",
    question: "物流センターの荷降ろしを先着順からバース予約制に変えると、ドライバーの待ち時間はどこへ行くのか。",
    summary:
      "いつもの平日、渋滞で遅れる日、予約しないトラックが多い日、荷物が多すぎる日。4 つの場面で「先着順」と「バース予約制」を並べて動かし、荷待ち時間と 2 時間ルールの達成度を比べます。",
    date: "2026-10-17",
    tags: ["物流", "労働", "2024年問題"],
  },
  {
    slug: "escalator",
    no: 1,
    title: "エスカレーター、片側を空けるべきか、両側に立つべきか",
    question: "歩く人のために片側を空ける習慣は、全体として得なのか損なのか。",
    summary:
      "朝のラッシュ、昼の閑散時、電車が着いた直後の波、歩く側に立つ人がいる日。4 つの場面で「片側空け」と「両側立ち」を並べて動かし、運べる人数と待ち時間を比べます。",
    date: "2026-10-13",
    tags: ["交通", "都市", "安全"],
  },
];

export function getSimEntry(slug: string): SimEntry | undefined {
  return simEntries.find((e) => e.slug === slug);
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}
