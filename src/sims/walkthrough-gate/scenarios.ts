import type { PolicyId, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** このシナリオを選んだときに左右に並べる改札 */
  left: PolicyId;
  right: PolicyId;
}

const base: Omit<SimParams, "lanes" | "trains" | "tricklePerMin" | "wtShare" | "durationSec" | "seed"> = {
  ticketShare: 0.03,
  luggageShare: 0.05,
  // IC カードやスマホをタッチして通る人の間隔。自動改札 1 通路で毎分 50〜60 人程度
  touchHeadway: 1.15,
  // 歩く速さのまま通れる人の間隔。毎分 80 人程度
  wtHeadway: 0.75,
  ticketHeadway: 2.4,
  luggageExtra: 1.2,
  cardErrorRate: 0.012,
  wtMissRate: 0.01,
  wrongLaneRate: 0.03,
  blockSec: 5,
  wtBias: 3,
};

export const scenarios: Scenario[] = [
  {
    id: "rush",
    name: "朝のターミナル駅",
    description:
      "山手線の乗換駅、朝 8 時台の出場側。改札の出口は 6 通路。2 分 30 秒おきに電車が着き、そのたびに 450 人が 40 秒かけて階段を上がってくる。ウォークスルー対応のスマホを持つ人は IC 利用者の 1 割。",
    params: {
      ...base,
      lanes: 6,
      trains: { first: 5, intervalSec: 150, count: 4, passengers: 450, spreadSec: 40 },
      tricklePerMin: 20,
      wtShare: 0.1,
      durationSec: 600,
      seed: 20261122,
    },
    left: "touchOnly",
    right: "oneMixed",
  },
  {
    id: "airport",
    name: "空港の駅",
    description:
      "成田空港や羽田空港の駅。改札は 4 通路。5 分おきに 220 人が 60 秒かけて来るが、半分がスーツケースを引き、1 割 5 分が切符や QR、初めて来た人は専用通路の表示を見落としやすい (6%)。残高不足も多い (3%)。ウォークスルー対応は 5%。",
    params: {
      ...base,
      lanes: 4,
      trains: { first: 5, intervalSec: 300, count: 3, passengers: 220, spreadSec: 60 },
      tricklePerMin: 6,
      ticketShare: 0.15,
      luggageShare: 0.5,
      cardErrorRate: 0.03,
      wrongLaneRate: 0.06,
      wtShare: 0.05,
      durationSec: 900,
      seed: 20261122,
    },
    left: "oneMixed",
    right: "oneDedicated",
  },
  {
    id: "event",
    name: "試合のあとの最寄り駅",
    description:
      "スタジアムの最寄り駅、試合のあとの入場側。改札は 6 通路。8 分間、毎分 420 人が途切れずに来る。年に数回しか電車に乗らない人も多く、切符が 8%、残高不足が 2.5%。ウォークスルー対応は 2 割。",
    params: {
      ...base,
      lanes: 6,
      trains: { first: 0, intervalSec: 480, count: 1, passengers: 420 * 8, spreadSec: 480 },
      tricklePerMin: 30,
      ticketShare: 0.08,
      cardErrorRate: 0.025,
      wtShare: 0.2,
      durationSec: 720,
      seed: 20261122,
    },
    left: "touchOnly",
    right: "oneMixed",
  },
  {
    id: "future",
    name: "2031 年、2 人に 1 人が対応",
    description:
      "朝のターミナル駅と同じ混み方で、ウォークスルー対応のスマホを持つ人が IC 利用者の半分まで増えた未来。1 通路のままでいいのか、全通路を対応にすると何が変わるのか。",
    params: {
      ...base,
      lanes: 6,
      trains: { first: 5, intervalSec: 150, count: 4, passengers: 450, spreadSec: 40 },
      tricklePerMin: 20,
      wtShare: 0.5,
      durationSec: 600,
      seed: 20261122,
    },
    left: "oneMixed",
    right: "allMixed",
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
