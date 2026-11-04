import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの方針 (初期値) */
  policies: [PolicyId, PolicyId];
}

export type PolicyId = "now" | "cull" | "fruit" | "buffer" | "both" | "bothLate" | "all";

export const POLICIES: Record<PolicyId, Policy> = {
  now: { name: "いまのまま", attractant: 0.6, buffer: 1, cullOnSight: 0.1, springCull: 0, from: 0 },
  cull: { name: "捕獲を強める", attractant: 0.6, buffer: 1, cullOnSight: 0.25, springCull: 0.05, from: 0 },
  fruit: { name: "柿の木を伐る", attractant: 0.15, buffer: 1, cullOnSight: 0.1, springCull: 0, from: 0 },
  buffer: { name: "緩衝帯を刈る", attractant: 0.6, buffer: 0.45, cullOnSight: 0.1, springCull: 0, from: 0 },
  both: { name: "伐る + 刈る", attractant: 0.15, buffer: 0.45, cullOnSight: 0.1, springCull: 0, from: 0 },
  bothLate: { name: "伐る + 刈る (大量出没のあとで)", attractant: 0.15, buffer: 0.45, cullOnSight: 0.1, springCull: 0, from: 2 },
  all: { name: "全部のせ", attractant: 0.15, buffer: 0.45, cullOnSight: 0.25, springCull: 0.05, from: 0 },
};

export const POLICY_IDS: PolicyId[] = ["now", "cull", "fruit", "buffer", "both", "bothLate", "all"];

const base: SimParams = {
  years: 10,
  firstYear: 2026,
  initialBears: 90,
  initialLearnedShare: 0.15,
  capacity: 160,
  birthRate: 0.45,
  naturalDeath: 0.07,
  fixedMasts: ["good", "poor"],
  wildBase: 0.003,
  wildHunger: 0.06,
  learnedBase: 0.04,
  learnedHunger: 0.12,
  injuryPerSighting: 0.012,
  forgetProb: 0.25,
  inheritLearned: 0.6,
  seed: 20261104,
};

export const scenarios: Scenario[] = [
  {
    id: "now",
    name: "いまから (豊作 → 凶作)",
    description:
      "2026 年は東北でブナが豊作、2027 年は凶作の見込み。去年の大量出没で人里の味を覚えたクマが 15% いる地域で、2026 年から 10 年間を流す。3 年目からの実りは確率で決まる。",
    params: base,
    policies: ["now", "both"],
  },
  {
    id: "late",
    name: "いつ始めるか",
    description:
      "「いまから」と同じ地域と実り。同じ「伐る + 刈る」を、豊作の今年のうちに始めるか、凶作の大量出没を経験してから 2028 年に始めるかで比べる。",
    params: base,
    policies: ["both", "bothLate"],
  },
  {
    id: "growing",
    name: "クマが増え続ける",
    description:
      "山が養えるクマが 1.6 倍 (耕作放棄地や里山の荒廃で森が広がった地域)。はじめの頭数は同じだが、放っておくと 10 年で大きく増える。餌を断つだけで十分か、捕獲も要るか。",
    params: { ...base, capacity: 260 },
    policies: ["both", "all"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
