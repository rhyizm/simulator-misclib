import type { ArrivalPhase, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

const base: Omit<SimParams, "arrivals" | "walkerRatio" | "durationSec" | "seed"> = {
  // 高低差 8 m 程度、長さ約 16 m の駅のエスカレーターを想定
  lengthSteps: 40,
  // 0.5 m/s ÷ 0.4 m (1 段の奥行き) ≒ 1.25 段/秒
  beltSpeed: 1.25,
  // 歩く人はベルトに対して +1.5 段/秒 (地上換算で 1.1 m/s 程度)
  walkSpeed: 1.5,
  reluctantWalkSpeed: 1.0,
  standGapMin: 1.0,
  standGapMax: 1.6,
  walkGap: 3.0,
  switchQueueThreshold: 30,
  switchProb: 0.15,
  standOnWalkLaneRatio: 0,
};

/** 電車が着くたびに一気に人が降りてくる到着パターン */
function trainWaves(opts: {
  trains: number;
  intervalSec: number;
  passengers: number;
  unloadSec: number;
  trickle: number;
}): ArrivalPhase[] {
  const phases: ArrivalPhase[] = [];
  for (let i = 0; i < opts.trains; i++) {
    const t0 = i * opts.intervalSec;
    phases.push({ from: t0, perMin: (opts.passengers / opts.unloadSec) * 60 });
    phases.push({ from: t0 + opts.unloadSec, perMin: opts.trickle });
  }
  return phases;
}

export const scenarios: Scenario[] = [
  {
    id: "rush",
    name: "朝のラッシュ",
    short: "ラッシュ",
    description:
      "朝 8 時台の乗換駅。改札からホームへ向かう人が 1 分あたり 130 人ほど押し寄せ、3 分後に落ち着く。歩きたい人は 3 割。",
    params: {
      ...base,
      walkerRatio: 0.3,
      arrivals: [
        { from: 0, perMin: 130 },
        { from: 180, perMin: 40 },
      ],
      durationSec: 300,
      seed: 20251013,
    },
  },
  {
    id: "offpeak",
    name: "昼の閑散時",
    short: "閑散時",
    description:
      "平日 14 時。1 分あたり 15 人ほどがぱらぱらと来る。行列はできないので、急ぎたい人がどれだけ早く上がれるかが焦点。歩きたい人は 4 割。",
    params: {
      ...base,
      walkerRatio: 0.4,
      arrivals: [{ from: 0, perMin: 15 }],
      durationSec: 240,
      seed: 20251013,
    },
  },
  {
    id: "train",
    name: "電車が着いた直後の波",
    short: "電車の波",
    description:
      "ホームから改札へ上がるエスカレーター。160 秒おきに電車が着き、そのたびに 240 人が 25 秒で降りてくる。次の電車が来る前に行列をさばききれるか。歩きたい人は 3 割。",
    params: {
      ...base,
      walkerRatio: 0.3,
      arrivals: trainWaves({ trains: 3, intervalSec: 160, passengers: 240, unloadSec: 25, trickle: 6 }),
      durationSec: 480,
      seed: 20251013,
    },
  },
  {
    id: "blocker",
    name: "歩く側に立つ人がいる",
    short: "歩く側に立つ人",
    description:
      "観光客や大きな荷物の人が混じる夕方の駅。1 分あたり 90 人が来て、立ちたい人のうち 1 割は歩く側のレーンに立ち止まってしまう。後ろの歩く人はその人を追い越せない。歩きたい人は 3.5 割。",
    params: {
      ...base,
      walkerRatio: 0.35,
      arrivals: [{ from: 0, perMin: 90 }],
      standOnWalkLaneRatio: 0.1,
      durationSec: 300,
      seed: 20251013,
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
