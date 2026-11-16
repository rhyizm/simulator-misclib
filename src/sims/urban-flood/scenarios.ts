import type { PolicyId, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 最初に左右に並べる対策 */
  policies: [PolicyId, PolicyId];
}

const base = {
  rainScale: 1,
  rainJitter: 0.15,
  warningCompliance: 0.4,
  seed: 20261116,
};

export const scenarios: Scenario[] = [
  {
    id: "shower",
    name: "夏の夕立",
    description:
      "夕方に 40 分ほど、いちばん強いときで 1 時間 70 mm の雨。下水道の能力 (50 mm) を少し超えるくらいで、毎年どこかで起きる強さ。帰宅の車が 1 分に 8 台アンダーパスに来る。",
    params: {
      ...base,
      rain: { base: 0, baseFrom: 0, baseTo: 0, bursts: [{ start: 10, dur: 40, peak: 70 }] },
      carsPerMin: 8,
      durationMin: 120,
    },
    policies: ["now", "tank"],
  },
  {
    id: "guerrilla",
    name: "ゲリラ豪雨",
    description:
      "1 時間あまり、1 時間 120 mm の猛烈な雨が続く。下水道の能力の 2 倍以上で、記録的短時間大雨情報が出るような強さ。車は 1 分に 6 台。",
    params: {
      ...base,
      rain: {
        base: 10,
        baseFrom: 0,
        baseTo: 120,
        bursts: [{ start: 20, dur: 70, peak: 120 }],
      },
      carsPerMin: 6,
      durationMin: 210,
    },
    policies: ["now", "pipe65"],
  },
  {
    id: "senjo",
    name: "線状降水帯 (8 時間)",
    description:
      "2026 年 8 月の千葉豪雨のように、夜通し 8 時間、強い雨の帯が 4 回通過する。合計はおよそ 350 mm。間の時間も雨はやまない。夜なので車は 1 分に 2 台。",
    params: {
      ...base,
      rain: {
        base: 12,
        baseFrom: 0,
        baseTo: 480,
        bursts: [
          { start: 30, dur: 60, peak: 100 },
          { start: 150, dur: 50, peak: 90 },
          { start: 270, dur: 60, peak: 110 },
          { start: 390, dur: 50, peak: 95 },
        ],
      },
      carsPerMin: 2,
      durationMin: 600,
    },
    policies: ["now", "tank"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
