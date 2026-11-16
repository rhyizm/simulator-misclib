import type { SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
}

const base: SimParams = {
  capacityPerMin: 30,
  capacityNoise: 0.03,
  totalCars: 4000,
  peakCenterMin: 7 * 60 + 55,
  peakSdMin: 28,
  floorShare: 0.25,
  incident: null,
  earlyShare: 0.5,
  rebound: 0,
  durationSec: 4 * 3600,
  seed: 20261109,
};

export const scenarios: Scenario[] = [
  {
    id: "weekday",
    name: "いつもの平日",
    description:
      "郊外から市の中心部へ入る片側 2 車線の幹線道路。手前の交差点が 1 分に通せるのは約 30 台 (1 時間 1,800 台)。そこへ 6:30〜10:00 に約 4,000 台が来て、8 時前に集中する。",
    params: base,
  },
  {
    id: "rain",
    name: "雨の朝",
    description:
      "雨の日は歩きや自転車の人が車に乗り換え、来る台数が 7% 増える。視界と路面のせいで車間が開き、交差点が通せる台数は 1 割落ちる。",
    params: { ...base, totalCars: 4300, capacityPerMin: 27 },
  },
  {
    id: "incident",
    name: "7:40 に事故",
    description:
      "いつもの平日の 7:40〜8:10 に、交差点の先で事故が起き 1 車線がふさがる。その 30 分間は通せる台数が半分になる。",
    params: { ...base, incident: { fromMin: 7 * 60 + 40, toMin: 8 * 60 + 10, factor: 0.5 } },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}

/** 右と左の世界で選べる参加率 */
export const PARTICIPATION_OPTIONS = [0, 0.01, 0.05, 0.1, 0.2] as const;
