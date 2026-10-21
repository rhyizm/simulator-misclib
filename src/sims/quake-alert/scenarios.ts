import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

/** しきい値だけが違う 3 つの世界 */
export const policies: Policy[] = [
  { id: "early", label: "早めに鳴らす", desc: "推定震度 3.5 (震度 4 程度) から鳴らす", threshold: 3.5 },
  { id: "standard", label: "震度 5 弱で鳴らす", desc: "推定震度 4.5 (震度 5 弱) 以上で鳴らす", threshold: 4.5 },
  { id: "strict", label: "確実なときだけ", desc: "推定震度 5.5 (震度 6 弱) 以上でだけ鳴らす", threshold: 5.5 },
];

const base: SimParams = {
  years: 30,
  population: 400,
  // 震度 3 程度以上を感じる地震が年に 8 回ほど来る町
  quakesPerYear: 8,
  // 震度 5 弱以上 (4.5 以上) が全体の約 5%、30 年で 12 回ほど
  intensityScale: 0.67,
  estimateSigma: 0.6,
  glitchProb: 0.004,
  strongIntensity: 4.5,
  falseAlarmPenalty: 0.15,
  missPenalty: 0.05,
  hitRecovery: 0.3,
  driftPerYear: 0.15,
  trustBase: 0.85,
  trustInitMin: 0.75,
  trustInitMax: 0.95,
  seed: 20261016,
};

export const scenarios: Scenario[] = [
  {
    id: "standard",
    name: "ふだんの 30 年",
    short: "ふだん",
    description:
      "揺れを感じる地震が年に 8 回ほど、震度 5 弱以上は 30 年で 12 回ほど来る町。推定震度は ±0.6 ほどずれる。誤作動はめったにない。",
    params: base,
  },
  {
    id: "glitch",
    name: "誤作動が混じる",
    short: "誤作動",
    description:
      "10 月 16 日の速報のように、遠い地震を大地震と取り違える誤作動が 30 年で 8 回ほど起きる。誤作動はしきい値に関係なくどの世界でも警報を鳴らす。",
    params: { ...base, glitchProb: 0.035 },
  },
  {
    id: "rare",
    name: "大きな揺れがまれな町",
    short: "まれな町",
    description:
      "揺れを感じる地震の回数は同じだが、震度 5 弱以上は 30 年で 4 回ほど。当たりがまれだと、同じ精度の警報でも外れの比率が上がる。",
    params: { ...base, intensityScale: 0.5 },
  },
  {
    id: "forgiving",
    name: "外れても信頼が減りにくい",
    short: "減りにくい",
    description:
      "「ふだんの 30 年」と同じ地震で、空振り 1 回で失われる信頼を半分にした町。取り消しがすぐ届く、外れた理由が説明される、といった場合を想定。",
    params: { ...base, falseAlarmPenalty: 0.075 },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
