import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

/** 備えの量だけが違う 3 つの世界 */
export const policies: Policy[] = [
  {
    id: "now",
    label: "いまの備え",
    desc: "3 日分以上ある家は水 7 割、食料 6 割、携帯トイレ 3 割弱",
    minStock: { water: 0, food: 0, toilet: 0 },
  },
  {
    id: "food7",
    label: "水と食料を 7 日分",
    desc: "全世帯が水と食料を 7 日分。トイレはいまのまま",
    minStock: { water: 7, food: 7, toilet: 0 },
  },
  {
    id: "all7",
    label: "トイレも 7 日分",
    desc: "全世帯が水・食料・携帯トイレを 7 日分",
    minStock: { water: 7, food: 7, toilet: 7 },
  },
];

const city: SimParams = {
  days: 21,
  households: 400,
  damageRate: 0.06,
  apartmentRate: 0.5,
  fetchRate: 0.72,
  waterOutRate: 0.45,
  waterDays: [3, 24],
  powerOutRate: 0.6,
  powerDays: [1, 5],
  drainCheckDays: [2, 6],
  shopDays: [3, 8],
  reliefWaterDay: 2,
  reliefFoodDay: 3,
  reliefToiletDay: 3,
  shelterRate: 0.12,
  tolerance: { water: 1.5, food: 3, toilet: 2 },
  seed: 20261020,
};

export const scenarios: Scenario[] = [
  {
    id: "city",
    name: "都市の住宅街",
    short: "都市",
    description:
      "首都直下地震のような都市の地震。半分が集合住宅で、停電でポンプが止まると水が出ず、排水管の点検が済むまでトイレも流せない。断水は 4 割あまりの街区で 3〜24 日。避難所の定員は人口の 12%。",
    params: city,
  },
  {
    id: "peninsula",
    name: "長い断水が続く半島",
    short: "半島",
    description:
      "能登半島地震のように、道路が寸断されて支援が遅れ、ほぼ全域の断水が 1〜2 か月続く町。家の被害が多く、高齢の世帯が多いので給水所まで通える人も少ない。避難所の定員は人口の 20%。",
    params: {
      ...city,
      days: 30,
      damageRate: 0.15,
      apartmentRate: 0.05,
      fetchRate: 0.55,
      waterOutRate: 0.95,
      waterDays: [20, 60],
      powerOutRate: 0.8,
      powerDays: [2, 10],
      shopDays: [7, 20],
      reliefWaterDay: 5,
      reliefFoodDay: 4,
      reliefToiletDay: 7,
      shelterRate: 0.2,
      seed: 20240101,
    },
  },
  {
    id: "tower",
    name: "停電したマンション街",
    short: "マンション",
    description:
      "水道管は無事でも、停電でポンプとエレベーターが止まる高層の街。全世帯が集合住宅で、停電は 2〜7 日。高い階から給水所へ水を運べる人は限られる。都心の避難所は狭く、定員は人口の 8%。",
    params: {
      ...city,
      days: 14,
      damageRate: 0.01,
      apartmentRate: 1,
      fetchRate: 0.4,
      waterOutRate: 0.1,
      waterDays: [3, 10],
      powerOutRate: 0.9,
      powerDays: [2, 7],
      drainCheckDays: [2, 5],
      shopDays: [2, 5],
      shelterRate: 0.08,
      seed: 20250901,
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
