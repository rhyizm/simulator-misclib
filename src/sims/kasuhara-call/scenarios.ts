import type { SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

const base: SimParams = {
  calls: 380,
  harassRatio: 0.02,
  operators: 8,
  // 普通の電話は 2 分 + 平均 4 分 (平均 6 分)、後処理 1 分
  serviceMin: 2,
  serviceMean: 6,
  wrapupMin: 1,
  patienceMean: 8,
  // カスハラの電話は「納得するまで」20 分 + 平均 40 分 (平均 60 分)
  harassMin: 20,
  harassMean: 60,
  recoverMin: 10,
  capMin: 30,
  callbackProb: 0.5,
  callbackDelay: [5, 30],
  stressLimit: 120,
  stressDecay: 0.1,
  // 9:00〜17:00 受付、20:00 で打ち切り
  closeAt: 480,
  durationMin: 660,
  seed: 20261001,
};

export const scenarios: Scenario[] = [
  {
    id: "normal",
    name: "いつもの平日",
    short: "平日",
    description:
      "オペレーター 8 人の窓口に、9 時から 17 時までで約 380 本の電話がかかる。そのうち 2% (1 日 7〜8 本) が、暴言や同じ要求の繰り返しで「納得するまで切らせない」電話。右の世界では 30 分で方針を伝えて切り、半分は掛け直してくる。",
    params: { ...base },
  },
  {
    id: "rare",
    name: "カスハラがまれな窓口",
    short: "まれ",
    description:
      "カスハラの電話が 0.5% (1 日 2 本ほど) しかない窓口。長電話が 1 本あっても 8 人いれば吸収できるのか。打ち切りのルールは、まれな窓口でも意味があるのか。",
    params: { ...base, harassRatio: 0.005, seed: 20261016 },
  },
  {
    id: "callback",
    name: "切っても掛け直してくる",
    short: "掛け直し",
    description:
      "切られた相手の 9 割が、5〜15 分後に掛け直してくる。打ち切っても同じ人の電話がまた列に並ぶ。1 回を短く切るルールは、掛け直しで帳消しになるのか。",
    params: { ...base, callbackProb: 0.9, callbackDelay: [5, 15], seed: 20261017 },
  },
  {
    id: "small",
    name: "役所の小さな窓口",
    short: "小窓口",
    description:
      "職員 3 人で 1 日 130 本ほどを受ける市役所の課。カスハラの電話は 3% (1 日 4 本ほど)。1 人が 1 時間つかまると、窓口の力が 3 分の 1 減る。",
    params: { ...base, operators: 3, calls: 130, harassRatio: 0.03, seed: 20261023 },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
