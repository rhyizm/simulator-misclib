import type { SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

const base: Omit<SimParams, "roadLengthM" | "stopSpacingM" | "comfortKmh" | "sightMin" | "sightMax" | "dartPerKm" | "carsPerMin" | "seed"> = {
  stopPauseSec: 1.5,
  comfortSpread: 0.15,
  overshootKmh: 4,
  compliance: 1,
  accel: 1.5,
  comfortDecel: 2.5,
  emergencyDecel: 6.5,
  reactionMin: 0.75,
  reactionMax: 1.5,
  durationSec: 300,
};

export const scenarios: Scenario[] = [
  {
    id: "backstreet",
    name: "住宅街の抜け道",
    short: "抜け道",
    description:
      "幅 4.5 m ほど、中央線のない 500 m の道。100 m ごとに一時停止の交差点があり、塀や駐車車両の陰から人が出てくる。上限がなくても道幅のせいで 40 km/h 前後しか出さない道。",
    params: {
      ...base,
      roadLengthM: 500,
      stopSpacingM: 100,
      comfortKmh: 40,
      sightMin: 6,
      sightMax: 30,
      dartPerKm: 3,
      carsPerMin: 4,
      seed: 20261020,
    },
  },
  {
    id: "school",
    name: "通学路の朝",
    short: "通学路",
    description:
      "同じような住宅街の道を、登校する子どもが行き交う朝 7 時台。交差点は 150 m おき。見通しは悪く、飛び出しは抜け道の 2.5 倍。",
    params: {
      ...base,
      roadLengthM: 600,
      stopSpacingM: 150,
      comfortKmh: 38,
      sightMin: 5,
      sightMax: 25,
      dartPerKm: 8,
      carsPerMin: 3,
      seed: 20261020,
    },
  },
  {
    id: "farm",
    name: "郊外の広い農道",
    short: "広い農道",
    description:
      "中央線はないが幅が広く、見通しのよい 1.5 km の直線。一時停止は途中に 1 か所だけで、歩く人はまばら。これまでは 60 km/h 近くで流れていた道。",
    params: {
      ...base,
      roadLengthM: 1500,
      stopSpacingM: 750,
      comfortKmh: 58,
      sightMin: 25,
      sightMax: 80,
      dartPerKm: 0.4,
      carsPerMin: 2,
      durationSec: 420,
      seed: 20261020,
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
