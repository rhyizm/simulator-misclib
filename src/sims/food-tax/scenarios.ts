import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの方針 (初期値) */
  policies: [PolicyId, PolicyId];
}

export type PolicyId = "none" | "cut" | "plan" | "flat" | "targeted";

/** 政府の支援金 0.6 兆円/年 ÷ 減税による税収減 約 4.4 兆円/年 */
export const SUPPORT_RATIO = 0.14;

export const POLICIES: Record<PolicyId, Policy> = {
  none: { name: "8% のまま", kind: "none", workerSupport: 0 },
  cut: { name: "食料品 1%", kind: "cut", workerSupport: 0 },
  plan: { name: "1% + 就業者支援金", kind: "cut", workerSupport: SUPPORT_RATIO },
  flat: { name: "同じ額を全員に給付", kind: "flat", workerSupport: 0 },
  targeted: { name: "同じ額を年収 350 万円以下に", kind: "targeted", workerSupport: 0 },
};

export const POLICY_IDS: PolicyId[] = ["none", "cut", "plan", "flat", "targeted"];

const base: Omit<SimParams, "inflation" | "passThrough"> = {
  households: 200,
  targetIncome: 3_500_000,
  supportMin: 1_000_000,
  supportMax: 3_500_000,
  seed: 20261110,
};

export const scenarios: Scenario[] = [
  {
    id: "calm",
    name: "物価が落ち着いた 2 年",
    description:
      "食料品の値上がりは年 1%。店は減税分をすべて値下げに回す。減税がいちばんきれいに効く条件で、同じ額を現金で配った場合と比べる。",
    params: { ...base, inflation: 0.01, passThrough: 1 },
    policies: ["cut", "flat"],
  },
  {
    id: "inflation",
    name: "値上がりが続く",
    description:
      "食料品の値上がりが年 4% 続く (2025〜26 年なみ)。減税で一度は 6.5% 下がるが、2 年で値札はほぼ元に戻り、2029 年 4 月に 7% 跳ね上がる。",
    params: { ...base, inflation: 0.04, passThrough: 1 },
    policies: ["none", "cut"],
  },
  {
    id: "sticky",
    name: "値下げが店で止まる",
    description:
      "店が減税分の 6 割しか値下げに回さない (原材料や人件費の値上がり分を据え置く)。国の税収は同じだけ減るが、世帯に届くのは 6 割。",
    params: { ...base, inflation: 0.02, passThrough: 0.6 },
    policies: ["plan", "targeted"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
