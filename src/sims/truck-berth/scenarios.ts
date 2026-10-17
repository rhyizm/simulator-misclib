import type { SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

const base: SimParams = {
  trucks: 40,
  berths: 4,
  // 1 台の荷降ろし・検品は 20〜70 分 (平均 45 分)
  serviceMin: 20,
  serviceMax: 70,
  // 8:00 から荷受け開始。午前便 8:00〜12:00、午後便 12:00〜16:00
  openAt: 120,
  amRatio: 0.55,
  amWindow: [120, 360],
  pmWindow: [360, 600],
  rushRatio: 0.5,
  rushLeadMax: 90,
  lateProb: 0.1,
  lateMean: 30,
  walkInRatio: 0.1,
  earlyMin: 15,
  graceMin: 15,
  slotUtil: 0.95,
  protectMin: 20,
  // 6:00〜22:00
  durationMin: 960,
  seed: 20261017,
};

export const scenarios: Scenario[] = [
  {
    id: "normal",
    name: "いつもの平日",
    short: "平日",
    description:
      "バース 4 本の物流センターに 40 台が来る日。荷受けは 8 時から。先着順の世界では半分のドライバーが「早く並べば早く終わる」と考えて、時間帯の始まりより最大 90 分前に着いて並ぶ。予約制の世界では 9 割が予約を取る。",
    params: { ...base },
  },
  {
    id: "traffic",
    name: "渋滞で遅れる日",
    short: "渋滞",
    description:
      "雨と事故渋滞で、3 割のトラックが平均 50 分遅れる。予約制では枠から 15 分以上遅れると優先権を失い、飛び込みと同じ扱いになる。予約の前提である「時間どおりに着く」が崩れたらどうなるか。",
    params: { ...base, lateProb: 0.3, lateMean: 50 },
  },
  {
    id: "walkin",
    name: "予約しないトラックが多い",
    short: "飛び込み",
    description:
      "予約システムを入れたものの、運送会社の 4 割は予約を取らずに来る (多重下請けの末端まで予約の話が届かない、など)。予約車は待たずに済むが、飛び込みのトラックはどうなるか。",
    params: { ...base, walkInRatio: 0.4 },
  },
  {
    id: "overload",
    name: "荷物が多すぎる日",
    short: "繁忙日",
    description:
      "月末や年末の繁忙日。同じバース 4 本に 52 台が来る。8 時間で降ろせるのはおよそ 43 台なので、どちらのやり方でも 16 時までには終わらない。予約は荷待ちを減らせるのか、それとも待ちの場所を変えるだけなのか。",
    params: { ...base, trucks: 52 },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
