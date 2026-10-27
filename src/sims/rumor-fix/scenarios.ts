import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

/** 訂正を出すまでの時間だけが違う 3 つの世界 */
export const policies: Policy[] = [
  { id: "fast", label: "30 分で訂正", desc: "デマが出て 30 分後に公式が否定する", delay: 0.5 },
  { id: "mid", label: "3 時間後に訂正", desc: "事実を確かめてから、3 時間後に否定する", delay: 3 },
  { id: "late", label: "翌朝に訂正", desc: "12 時間後、翌朝の会見で否定する", delay: 12 },
];

const base: SimParams = {
  hours: 36,
  side: 20,
  localLink: 0.7,
  longLinks: 4,
  split: false,
  crossLink: 1,
  rumorSeeds: 3,
  rumorRate: 0.9,
  believe: 0.75,
  shareRumor: 0.55,
  activeHours: 2,
  fixRate: 0.9,
  shareFixConvert: 0.3,
  shareFixBystander: 0.12,
  acceptFresh: 0.75,
  acceptStale: 0.25,
  entrenchHours: 6,
  officialReach: 0.08,
  newsRate: 0.03,
  prebunked: 0,
  seed: 20261011,
};

export const scenarios: Scenario[] = [
  {
    id: "quake",
    name: "地震のあとのうわさ",
    short: "地震のうわさ",
    description:
      "「誤報はハッキングのせい」「本当は隠している」といったうわさ。見た人の 4 人に 3 人が信じ、半分ほどが広める。信じた直後なら訂正を見て 4 人に 3 人が考えを改めるが、時間が経つほど改めにくくなる。",
    params: base,
  },
  {
    id: "election",
    name: "選挙の偽情報",
    short: "選挙",
    description:
      "政治的な立場に結びついた偽情報。広がる速さは同じだが、信じた人は最初から訂正を受け入れにくい (直後でも 2 人に 1 人、時間が経つと 7 人に 1 人)。",
    params: { ...base, believe: 0.8, acceptFresh: 0.5, acceptStale: 0.15, seed: 20260208 },
  },
  {
    id: "split",
    name: "分断されたタイムライン",
    short: "分断",
    description:
      "左右の 2 つの集団で、つながりのほとんどが内側に閉じている。デマは左側から始まり、公式の訂正を直接見る人やニュースを見る人は右側に偏っている。",
    params: { ...base, split: true, crossLink: 0.08, seed: 20261016 },
  },
  {
    id: "prebunk",
    name: "2 割が手口を知っている",
    short: "プレバンキング",
    description:
      "「災害のあとにはこういうデマが出る」と前もって知っていて、デマを見ても信じない人が 2 割いる町。それ以外は「地震のあとのうわさ」と同じ。",
    params: { ...base, prebunked: 0.2 },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
