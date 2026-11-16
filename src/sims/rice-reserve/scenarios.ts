import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの方針 (初期値) */
  policies: [PolicyId, PolicyId];
}

export type PolicyId = "now" | "early" | "small" | "big" | "rotate3" | "band" | "rush";

const basePolicy: Omit<Policy, "name"> = {
  target: 100,
  annualBuy: 20,
  rotationYears: 5,
  releaseTrigger: 1.3,
  decisionLag: 6,
  deliveryLag: 3,
  releasePerMonth: 15,
  buyBackBelow: 1.0,
  buyBackMax: 15,
  holdCap: 100,
};

export const POLICIES: Record<PolicyId, Policy> = {
  now: { ...basePolicy, name: "いまの備蓄" },
  early: { ...basePolicy, name: "早めに放出", releaseTrigger: 1.15, decisionLag: 1, deliveryLag: 1 },
  small: { ...basePolicy, name: "備蓄 50 万 t", target: 50, annualBuy: 10, holdCap: 50 },
  big: { ...basePolicy, name: "備蓄 150 万 t", target: 150, annualBuy: 30, holdCap: 150 },
  rotate3: { ...basePolicy, name: "3 年で入れ替え", annualBuy: 33, rotationYears: 3 },
  band: {
    ...basePolicy,
    name: "値段の帯で売り買い",
    releaseTrigger: 1.15,
    decisionLag: 1,
    deliveryLag: 1,
    buyBackBelow: 0.9,
    buyBackMax: 30,
    holdCap: 150,
  },
  rush: { ...basePolicy, name: "すぐ買い戻す", buyBackBelow: Infinity, buyBackMax: 30 },
};

export const POLICY_IDS: PolicyId[] = ["now", "early", "small", "big", "rotate3", "band", "rush"];

export function describePolicy(p: Policy): string {
  const parts: string[] = [];
  parts.push(`目標 ${p.target} 万 t、毎年 ${p.annualBuy} 万 t を買って ${p.rotationYears} 年で飼料用に`);
  parts.push(
    `値段が ${p.releaseTrigger.toFixed(2)} 倍を ${p.decisionLag} か月続けたら月 ${p.releasePerMonth} 万 t 放出 (店まで ${p.deliveryLag} か月)`,
  );
  if (p.buyBackBelow === Infinity) parts.push(`値段に関係なく毎年 ${p.buyBackMax} 万 t まで買い戻す`);
  else
    parts.push(
      `${p.buyBackBelow.toFixed(1)} 倍より安い年だけ ${p.buyBackMax} 万 t まで買い戻す${p.holdCap > p.target ? ` (${p.holdCap} 万 t まで積む)` : ""}`,
    );
  return parts.join("。");
}

const base: SimParams = {
  years: 30,
  refPrice: 3000,
  demand: 705,
  demandTrend: -0.008,
  badYearProb: 0.12,
  disasterProb: 0.03,
  surgeProb: 0.08,
  startPrivate: 200,
  startGov: 100,
  startPriceRatio: 1,
  seed: 11,
};

export const scenarios: Scenario[] = [
  {
    id: "normal",
    name: "ふつうの 30 年",
    description:
      "不作は 8 年に 1 度くらい (作況 92〜96)、1993 年級の大凶作は 30 年に 1 度くらい。需要は毎年 0.8% ずつ減り、ときどき訪日客や買いだめで 3% 跳ねる。備蓄は目標どおり 100 万 t から始める。",
    params: { ...base, seed: 11 },
    policies: ["now", "early"],
  },
  {
    id: "reiwa",
    name: "令和の米騒動をもう一度",
    description:
      "2023 年のような猛暑の年 (作況 96) と、需要が 3% 跳ねる年が 2 年続く。民間在庫は少なめの 160 万 t から始まる。2024〜25 年に起きたことを、方針を変えてやり直す。",
    params: {
      ...base,
      seed: 23,
      startPrivate: 160,
      startGov: 91,
      forced: { 0: { yieldIdx: 97, surge: 1.015 }, 1: { yieldIdx: 100, surge: 1.03 }, 2: { yieldIdx: 101, surge: 1 } },
    },
    policies: ["now", "early"],
  },
  {
    id: "disaster",
    name: "1993 年級の大凶作",
    description:
      "6 年目に作況 74 の大凶作が来る (1993 年の全国の作況と同じ)。前の年も不作。いつもの年の 4 分の 1 の米が消えるとき、150 万 t をゆっくり出すのと、100 万 t をすぐ出すのとでは、どちらが持ちこたえるか。",
    params: { ...base, seed: 37, forced: { 4: { yieldIdx: 95 }, 5: { yieldIdx: 74 } } },
    policies: ["big", "early"],
  },
  {
    id: "today",
    name: "いまから (在庫は余り、備蓄は半分)",
    description:
      "2026 年 7 月の状況から始める。民間在庫は 243 万 t と積み上がり、値段は下がり始めた。政府備蓄は買い入れ後でも約 53 万 t で、目標の半分しかない。この先 30 年、買い戻しをいつ・どれだけするか。",
    params: { ...base, seed: 41, startPrivate: 243, startGov: 53, startPriceRatio: 1.05 },
    policies: ["now", "rush"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
