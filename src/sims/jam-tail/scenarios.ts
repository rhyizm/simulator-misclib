import type { SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

const base: Omit<SimParams, "roadLengthM" | "queueStartM" | "tunnel" | "sightM" | "aebShare" | "seed"> = {
  truckShare: 0.55,
  truckKmhMin: 80,
  truckKmhMax: 90,
  carKmhMin: 90,
  carKmhMax: 110,
  vehPerMin: 6,
  reactionMin: 0.75,
  reactionMax: 1.5,
  truckDecel: 4.5,
  carDecel: 7,
  glanceEvery: 6,
  glanceMin: 0.4,
  glanceMax: 1.2,
  phoneShare: 0.5,
  phoneSec: 6,
  phoneEvery: 10,
  durationSec: 300,
};

export const scenarios: Scenario[] = [
  {
    id: "tunnel",
    name: "深夜のトンネル、工事渋滞の最後尾",
    short: "トンネル",
    description:
      "左カーブのトンネルの中で、先の工事規制から伸びた渋滞の列が止まっている。最後尾が見えるのは 180 m 手前から。夜間なのでトラックが半分以上を占める。",
    params: {
      ...base,
      roadLengthM: 1000,
      queueStartM: 820,
      tunnel: [380, 1000],
      sightM: 180,
      aebShare: 0,
      seed: 20261021,
    },
  },
  {
    id: "straight",
    name: "見通しのよい直線",
    short: "直線",
    description:
      "同じ渋滞の最後尾を、遮るもののない直線の先に置いた場合。ハザードを点けた最後尾が 400 m 手前から見える。それ以外の条件はトンネルと同じ。",
    params: {
      ...base,
      roadLengthM: 1400,
      queueStartM: 1220,
      tunnel: null,
      sightM: 400,
      aebShare: 0,
      seed: 20261021,
    },
  },
  {
    id: "aeb",
    name: "トンネル + 自動ブレーキ 8 割",
    short: "自動ブレーキ",
    description:
      "トンネルの場面で、8 割の車に衝突被害軽減ブレーキ (AEB) が付いている場合。ぶつかる 1.6 秒前になると、ドライバーが前を見ていなくても自動でブレーキがかかる。",
    params: {
      ...base,
      roadLengthM: 1000,
      queueStartM: 820,
      tunnel: [380, 1000],
      sightM: 180,
      aebShare: 0.8,
      seed: 20261021,
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
