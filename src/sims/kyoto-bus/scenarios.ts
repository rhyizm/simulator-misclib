import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの方針 (初期値) */
  policies: [PolicyId, PolicyId];
}

export type PolicyId = "now" | "dual" | "express" | "reserve" | "all";

export const POLICIES: Record<PolicyId, Policy> = {
  now: { name: "いまのまま", dualFare: false, expressDrivers: 0, originFill: 1 },
  dual: { name: "二重運賃", dualFare: true, expressDrivers: 0, originFill: 1 },
  express: { name: "観光特急に回す", dualFare: false, expressDrivers: 3, originFill: 1 },
  reserve: { name: "始発で 2 割空ける", dualFare: false, expressDrivers: 0, originFill: 0.8 },
  all: { name: "全部のせ", dualFare: true, expressDrivers: 3, originFill: 0.8 },
};

export const POLICY_IDS: PolicyId[] = ["now", "dual", "express", "reserve", "all"];

const base: Omit<SimParams, "touristPerHour" | "residentPerHour" | "busesPerHour" | "segmentSec" | "seed"> = {
  capacity: 70,
  elasticity: -0.3,
  expressPreference: 0.4,
  expressPatienceSec: 600,
  residentGiveUpSec: 1800,
  luggageShare: 0.25,
  durationSec: 7200,
};

export const scenarios: Scenario[] = [
  {
    id: "weekday",
    name: "平日の昼",
    description:
      "観光客は京都駅から 1 時間に 350 人、沿線の市民は 1 時間に 240 人。バスは 6 分おき (1 時間 10 台)。席に余裕がある日。",
    params: { ...base, touristPerHour: 350, residentPerHour: 240, busesPerHour: 10, segmentSec: 110, seed: 20261025 },
    policies: ["now", "dual"],
  },
  {
    id: "autumn",
    name: "紅葉の週末",
    description:
      "観光客が 1 時間に 750 人に増え、道も混んで停留所の間を走る時間が 1.4 倍に。バスは臨時便を足して 1 時間 12 台。京都駅を出るバスはどれも満員になる。",
    params: { ...base, touristPerHour: 750, residentPerHour: 220, busesPerHour: 12, segmentSec: 150, seed: 20261025 },
    policies: ["now", "dual"],
  },
  {
    id: "driver",
    name: "運転士が足りない",
    description:
      "紅葉の週末と同じ人出だが、運転士が足りず臨時便が出せない。バスは 8 分おき (1 時間 8 台)。台数を増やさずに何ができるか。",
    params: { ...base, touristPerHour: 750, residentPerHour: 220, busesPerHour: 8, segmentSec: 150, seed: 20261025 },
    policies: ["now", "reserve"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
