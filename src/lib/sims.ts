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
      "朝のラッシュ、昼の閑散時、電車が着いた直後の波、歩く側に立つ人がいる日。4 つの場面で「片側空け」と「両側立ち」を並べて動かし、運べる人数と待ち時間を比べます。",
    date: "2026-10-13",
    tags: ["交通", "都市", "安全"],
  },
  {
    slug: "quake-alert",
    no: 2,
    title: "地震の警報、どこで鳴らせばいちばん多くの人を守れるか",
    question: "空振りを恐れれば見逃しが増え、見逃しを恐れれば空振りで信頼が削られる。その釣り合いはどこにあるのか。",
    summary:
      "10 月 16 日の「M9.9」誤報をきっかけに、しきい値だけが違う 3 つの町で同じ 30 年間の地震を流します。空振りで警報への信頼が下がる「オオカミ少年」効果を入れ、強い揺れのときに身を守れた人の数を比べます。",
    date: "2026-10-18",
    tags: ["防災", "情報", "信頼"],
  },
];

export function getSimEntry(slug: string): SimEntry | undefined {
  return simEntries.find((e) => e.slug === slug);
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}
