import type { ElectionParams, Party } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: ElectionParams;
}

/** 比べる 3 つの比例定数: 現行、自民の折衷案 (31 減)、与党の法案 (45 減) */
export const PR_TOTALS = [176, 145, 131] as const;

const base = { swingSigma: 0.06, regionSigma: 0.12, districtSigma: 0.7, seed: 20261024 };

/** 近畿で強く、ほかでは弱い党の偏り */
const KINKI_STRONG: Record<string, number> = {
  北海道: 0.6, 東北: 0.6, 北関東: 0.7, 南関東: 0.75, 東京: 0.8, 北陸信越: 0.65,
  東海: 0.8, 近畿: 2.6, 中国: 0.8, 四国: 0.8, 九州: 0.7,
};

/** 2024 年衆院選の比例代表の得票率に近い割合。党名は伏せてある */
const LIKE_2024: Party[] = [
  { name: "A 党", share: 26.7, smd: 1.3 },
  { name: "B 党", share: 21.2, smd: 1.4 },
  { name: "C 党", share: 11.3, smd: 0.7 },
  { name: "D 党", share: 10.9, smd: 0.35 },
  { name: "E 党", share: 9.4, smd: 0.9, bias: KINKI_STRONG },
  { name: "F 党", share: 7.0, smd: 0.35 },
  { name: "G 党", share: 6.2, smd: 0.4 },
  { name: "H 党", share: 3.4, smd: 0.3 },
  { name: "その他", share: 3.9, smd: 0, minor: true },
];

const TWO_PARTY: Party[] = [
  { name: "A 党", share: 36, smd: 1.3 },
  { name: "B 党", share: 31, smd: 1.25 },
  { name: "C 党", share: 9, smd: 0.6 },
  { name: "D 党", share: 8, smd: 0.35 },
  { name: "E 党", share: 6, smd: 0.4 },
  { name: "F 党", share: 5, smd: 0.35 },
  { name: "G 党", share: 3, smd: 0.3 },
  { name: "その他", share: 2, smd: 0, minor: true },
];

const FRAGMENTED: Party[] = [
  { name: "A 党", share: 22, smd: 1.35 },
  { name: "B 党", share: 16, smd: 1.15 },
  { name: "C 党", share: 13, smd: 0.9 },
  { name: "D 党", share: 12, smd: 0.6 },
  { name: "E 党", share: 11, smd: 0.6 },
  { name: "F 党", share: 9, smd: 0.45 },
  { name: "G 党", share: 8, smd: 0.4 },
  { name: "H 党", share: 5, smd: 0.3 },
  { name: "その他", share: 4, smd: 0, minor: true },
];

export const scenarios: Scenario[] = [
  {
    id: "like2024",
    name: "前回 (2024 年) に近い票",
    description:
      "2024 年衆院選の比例代表の得票率に近い割合で、8 つの党が争う。党名は伏せてある。E 党は近畿で強い。小選挙区は大きな党ほど強い。",
    params: { ...base, parties: LIKE_2024 },
  },
  {
    id: "two-party",
    name: "二大政党に近い",
    description: "大きな 2 党で 7 割近くを取り、残りを 5 つの小さな党が分け合う。",
    params: { ...base, parties: TWO_PARTY },
  },
  {
    id: "fragmented",
    name: "小さな党が多い",
    description: "第 1 党でも 2 割強。5〜13% の党が 6 つ並ぶ、多党化が進んだ選挙。",
    params: { ...base, parties: FRAGMENTED },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
