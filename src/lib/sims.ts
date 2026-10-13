export const SITE_NAME = "社会シミュレーション観察記";

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
    slug: "escalator",
    no: 1,
    title: "エスカレーター、片側を空けるべきか、両側に立つべきか",
    question: "歩く人のために片側を空ける習慣は、全体として得なのか損なのか。",
    summary:
      "朝のラッシュ、昼の閑散時、そして酔っ払いの転倒。3 つの場面で「片側空け」と「両側立ち」を並べて動かし、運べる人数・待ち時間・巻き込まれる人数を比べます。",
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
