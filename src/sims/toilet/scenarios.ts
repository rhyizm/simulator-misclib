import type { ArrivalPhase, Layout, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの配分 */
  layouts: [Layout, Layout];
}

/** 便器 16 個分の広さ (国交省の指針で例に挙がっている規模) */
export const TOTAL = 16;

const base: Omit<SimParams, "arrivals" | "durationSec" | "seed"> = {
  // 高速道路 SA の調査では女性の平均占有時間は 88 秒 (2007) → 117 秒 (2016)
  femaleStallSec: 100,
  urinalSec: 40,
  maleStallSec: 150,
  maleStallNeed: 0.12,
  flexIntervalSec: 120,
};

/** 駅の平均 (女性 : 男性 ≒ 0.63 : 1) に近い、これまでよくある配分 */
export const LEGACY: Layout = { name: "これまでの配分", femaleStalls: 6, maleStalls: 3, urinals: 7, flexStalls: 0 };
/** 指針の例: 16 個なら男性 6、女性 10 */
export const GUIDELINE: Layout = { name: "指針の配分", femaleStalls: 10, maleStalls: 2, urinals: 4, flexStalls: 0 };
/** 指針の配分のうち 4 個を可変にする */
export const FLEX: Layout = { name: "可変トイレ", femaleStalls: 7, maleStalls: 1, urinals: 4, flexStalls: 4 };

/** バスが着くたびに一気に人が来る到着パターン */
function busWaves(opts: {
  buses: number;
  intervalSec: number;
  passengers: number;
  unloadSec: number;
  femaleRatio: number;
  trickle: number;
}): ArrivalPhase[] {
  const phases: ArrivalPhase[] = [];
  for (let i = 0; i < opts.buses; i++) {
    const t0 = i * opts.intervalSec;
    phases.push({ from: t0, perMin: (opts.passengers / opts.unloadSec) * 60, femaleRatio: opts.femaleRatio });
    phases.push({ from: t0 + opts.unloadSec, perMin: opts.trickle, femaleRatio: opts.femaleRatio });
  }
  return phases;
}

export const scenarios: Scenario[] = [
  {
    id: "station",
    name: "駅の夕方",
    short: "駅",
    description:
      "乗換駅のトイレ。男女ほぼ半々で 1 分あたり 9 人ずつ来る状態が 20 分続く。便器の総数 16 個は同じまま、男女の分け方だけを変える。",
    params: {
      ...base,
      arrivals: [{ from: 0, perMin: 9, femaleRatio: 0.5 }],
      durationSec: 1200,
      seed: 20261019,
    },
    layouts: [LEGACY, GUIDELINE],
  },
  {
    id: "intermission",
    name: "劇場の休憩 15 分",
    short: "休憩時間",
    description:
      "観客 400 人のホール。休憩に入ると最初の 3 分で 140 人がトイレに向かう (女性 6 割)。休憩は 15 分で、それまでに済ませられない人は二幕の開演に間に合わない。",
    params: {
      ...base,
      arrivals: [
        { from: 0, perMin: 47, femaleRatio: 0.6 },
        { from: 180, perMin: 4, femaleRatio: 0.6 },
      ],
      durationSec: 900,
      seed: 20261019,
    },
    layouts: [LEGACY, GUIDELINE],
  },
  {
    id: "sa",
    name: "連休の SA",
    short: "SA",
    description:
      "連休の高速道路サービスエリア。4 分おきに観光バスが着き、そのたびに 30 人が 1 分でトイレに向かう。その間も自家用車から 1 分あたり 4 人。男女は半々。",
    params: {
      ...base,
      arrivals: busWaves({ buses: 5, intervalSec: 240, passengers: 30, unloadSec: 60, femaleRatio: 0.5, trickle: 4 }),
      durationSec: 1200,
      seed: 20261019,
    },
    layouts: [LEGACY, GUIDELINE],
  },
  {
    id: "stadium",
    name: "客層が入れ替わるアリーナ",
    short: "可変トイレ",
    description:
      "昼はスポーツの試合で男性 7 割、夕方はライブで女性 7 割。1 分あたり 9 人が来る状態が 15 分ずつ続く。指針どおりの固定配分と、4 個を 2 分ごとに男女で切り替えられる可変トイレを比べる。",
    params: {
      ...base,
      arrivals: [
        { from: 0, perMin: 9, femaleRatio: 0.3 },
        { from: 900, perMin: 9, femaleRatio: 0.7 },
      ],
      durationSec: 1800,
      seed: 20261019,
    },
    layouts: [GUIDELINE, FLEX],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
