import type { SimParams } from "./model";

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
};

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
    id: "drunk",
    name: "酔っ払いが転倒",
    short: "転倒事故",
    description:
      "金曜 23 時、そこそこ混んだ帰宅ラッシュ (1 分あたり 60 人)。開始 45 秒後に千鳥足の酔っ払いが列の先頭に現れ、25 段目で足を滑らせて転げ落ちる。転倒の 3 秒後に誰かが非常停止ボタンを押し、90 秒間止まる。",
    params: {
      ...base,
      walkerRatio: 0.35,
      arrivals: [{ from: 0, perMin: 60 }],
      durationSec: 240,
      seed: 20251013,
      incident: {
        atSec: 45,
        atStep: 25,
        tumbleSpeed: 4,
        knockProbWalker: 0.7,
        knockProbStander: 0.25,
        stopDelay: 3,
        stopDuration: 90,
      },
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
