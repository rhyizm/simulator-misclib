import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
}

const HOURLY = [
  0.6, 0.5, 0.45, 0.4, 0.4, 0.45, 0.6, 0.85, 1.1, 1.25, 1.3, 1.25, 1.2, 1.2, 1.15, 1.1, 1.1, 1.1, 1.1, 1.05, 1.0, 0.9,
  0.8, 0.7,
];

const base: SimParams = {
  widthKm: 20,
  heightKm: 14,
  stations: [
    { name: "中央署", x: 10, y: 7, units: 3 },
    { name: "東署", x: 16, y: 5, units: 2 },
    { name: "西署", x: 4, y: 8, units: 2 },
    { name: "南分署", x: 11, y: 12, units: 1 },
  ],
  hospitals: [
    { name: "市立総合", x: 8.5, y: 6, large: true, slots: 3 },
    { name: "医療センター", x: 14, y: 8.5, large: true, slots: 3 },
    { name: "西病院", x: 5, y: 9.5, large: false, slots: 2 },
    { name: "南病院", x: 12, y: 11, large: false, slots: 2 },
    { name: "東病院", x: 17, y: 3.5, large: false, slots: 2 },
  ],
  centers: [
    { x: 10, y: 7, sd: 2.4, weight: 3 },
    { x: 15, y: 6, sd: 2, weight: 2 },
    { x: 5, y: 8.5, sd: 1.8, weight: 1.5 },
  ],
  uniformShare: 0.15,
  dailyDemand: 66,
  hourly: HOURLY,
  severityMix: [0.47, 0.42, 0.09, 0.02],
  perceiveLow: [0.6, 0.12, 0.048, 0],
  clearlyNonUrgentShare: 0.15,
  mildPrefersLarge: 0.57,
  deter: 0.42,
  speedKmh: 30,
  erMinutes: [50, 100, 140, 90],
  sceneMinutes: 15,
  durationSec: 86400,
  seed: 20261001,
};

export const scenarios: Scenario[] = [
  {
    id: "weekday",
    name: "いつもの日",
    description:
      "人口 40 万人ほどの市。4 つの署に救急車が 8 台、重い人を受け入れる大きな病院が 2 つ。無料なら 1 日に約 66 件の 119 番があり、半分近くが軽症。",
    params: base,
  },
  {
    id: "flu",
    name: "冬、インフルエンザの流行期",
    description:
      "119 番は 3 割増え、熱やせきの軽症が増える。大きな病院は入院の患者で埋まり、救急外来で診られる人数がそれぞれ 1 人ずつ減る。",
    params: {
      ...base,
      dailyDemand: 78,
      severityMix: [0.53, 0.37, 0.08, 0.02],
      hospitals: base.hospitals.map((h) => (h.large ? { ...h, slots: h.slots - 1 } : h)),
    },
  },
  {
    id: "heat",
    name: "猛暑日",
    description:
      "昼の 119 番が大きく増え、熱中症で入院が必要な中等症が多い。1 日の 119 番は約 80 件。",
    params: {
      ...base,
      dailyDemand: 80,
      hourly: HOURLY.map((w, h) => (h >= 10 && h <= 17 ? w * 1.6 : w)),
      severityMix: [0.44, 0.46, 0.08, 0.02],
    },
  },
  {
    id: "rural",
    name: "救急車の少ない広い町",
    description:
      "30 km × 20 km に人がまばらに住む町。署は 3 つで救急車は 4 台、大きな病院は 1 つだけ。1 日の 119 番は約 25 件。",
    params: {
      ...base,
      widthKm: 30,
      heightKm: 20,
      stations: [
        { name: "本署", x: 14, y: 10, units: 2 },
        { name: "北分署", x: 22, y: 4, units: 1 },
        { name: "西分署", x: 5, y: 14, units: 1 },
      ],
      hospitals: [
        { name: "中央病院", x: 15, y: 9, large: true, slots: 3 },
        { name: "北診療所", x: 23, y: 5, large: false, slots: 1 },
        { name: "西病院", x: 6, y: 13, large: false, slots: 2 },
      ],
      centers: [
        { x: 14, y: 10, sd: 3, weight: 3 },
        { x: 22, y: 5, sd: 2.5, weight: 1.2 },
        { x: 6, y: 14, sd: 2.5, weight: 1.2 },
      ],
      uniformShare: 0.3,
      dailyDemand: 25,
      speedKmh: 40,
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}

export const policies: Policy[] = [
  { id: "free", name: "いまのまま (無料)", fee: 0, scope: "none", triageLine: false, extraUnits: 0 },
  { id: "fee", name: "選定療養費 7,700 円", fee: 7700, scope: "nonUrgent", triageLine: false, extraUnits: 0 },
  { id: "fee7119", name: "7,700 円 + #7119 を案内", fee: 7700, scope: "nonUrgent", triageLine: true, extraUnits: 0 },
  { id: "all", name: "全員から 1 万円 (有料化)", fee: 10000, scope: "all", triageLine: false, extraUnits: 0 },
  { id: "units", name: "救急車を 2 台増やす", fee: 0, scope: "none", triageLine: false, extraUnits: 2 },
];

export function getPolicy(id: string): Policy {
  return policies.find((p) => p.id === id) ?? policies[0];
}

export const POLICY_NOTE: Record<string, string> = {
  free: "救急車も救急外来もいまのまま。誰が呼んでも費用はかからない",
  fee: "茨城県・松阪市・長崎市の方式。運ばれたあと病院で「緊急性がなかった」とされた人だけが払う",
  fee7119: "同じ 7,700 円に加え、迷った人の 8 割が #7119 に電話してから決める",
  all: "救急車を呼んだ人は誰でも 1 回 1 万円。比べるための仮の制度",
  units: "費用はとらず、人の多い署に救急車を 1 台ずつ足す (中央署・東署)",
};
