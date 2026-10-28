import type { ArrivalPhase, Policy, PolicyId, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの対策 (初期値。画面で選び直せる) */
  pair: [PolicyId, PolicyId];
}

const H = 3600;

const none: Policy = {
  id: "none",
  name: "ごみ箱なし・見回りなし",
  patrollers: 0,
  bins: 0,
  binCapacity: 0,
  emptyEverySec: 0,
  notifyDelaySec: 0,
  cleanEverySec: 0,
};

export const POLICIES: Record<PolicyId, Policy> = {
  none,
  patrol: { ...none, id: "patrol", name: "見回り + 過料 2,000 円", patrollers: 4 },
  // 45 L 程度のごみ箱にカップやペットボトルが 80 個。3 時間おきに回収
  bins: { ...none, id: "bins", name: "ごみ箱 4 つ (3 時間おきに回収)", bins: 4, binCapacity: 80, emptyEverySec: 3 * H },
  // 圧縮して 5 倍入り、8 割で通知が飛んで 30 分で回収に来る
  smart: {
    ...none,
    id: "smart",
    name: "スマートごみ箱 4 つ (満杯通知)",
    bins: 4,
    binCapacity: 400,
    notifyDelaySec: 30 * 60,
  },
  clean: { ...none, id: "clean", name: "2 時間おきに清掃", cleanEverySec: 2 * H },
};

export const POLICY_ORDER: PolicyId[] = ["none", "patrol", "bins", "smart", "clean"];

const base: Omit<SimParams, "arrivals" | "startHour" | "durationSec" | "seed"> = {
  // きれいな道で、ごみを持ったまま 200 m 歩くと 1 割強が捨てる
  baseHazardPerM: 0.0007,
  // 散らかった道では最大 3.5 倍 (Cialdini らや Keizer らの実験では、散らかった場所で捨てる人が 2〜3 倍に)
  litterMultiplier: 3.5,
  litterSaturation: 8,
  patrolAwareness: 0.75,
  patrolNearFactor: 0.1,
  overflowShare: 0.6,
  dumpPerBinHour: 0,
};

/** 平日の繁華街: 昼休みと夕方に山がある */
const WEEKDAY: ArrivalPhase[] = [
  { from: 0, perHour: 150 },
  { from: 2 * H, perHour: 400 },
  { from: 4 * H, perHour: 250 },
  { from: 8 * H, perHour: 450 },
];

export const scenarios: Scenario[] = [
  {
    id: "weekday",
    name: "平日の繁華街",
    description:
      "駅前から続く 400 m の商店街、10 時から 22 時まで。歩きながら飲み物や軽食を買い、この通りでごみを 1 つ出す人が 1 時間に 150〜450 人。営業中は誰も掃除しない。",
    params: {
      ...base,
      arrivals: WEEKDAY,
      startHour: 10,
      durationSec: 12 * H,
      seed: 20261028,
    },
    pair: ["none", "patrol"],
  },
  {
    id: "broken",
    name: "ごみがごみを呼ぶ",
    description:
      "平日の繁華街と同じ人出のまま、何もしない世界と、2 時間おきに通りを掃除するだけの世界を比べる。捨てる人の数は、落ちているごみの量で変わるのか。",
    params: {
      ...base,
      arrivals: WEEKDAY,
      startHour: 10,
      durationSec: 12 * H,
      seed: 20261028,
    },
    pair: ["none", "clean"],
  },
  {
    id: "weekend",
    name: "週末の夜",
    description:
      "金曜の 17 時から 24 時。飲み歩く人が増え、ごみを出す人は 1 時間に 600〜1,000 人。ごみ箱を置いたときに、回収が追いつくかどうかを見る。",
    params: {
      ...base,
      arrivals: [
        { from: 0, perHour: 600 },
        { from: 2 * H, perHour: 1000 },
        { from: 5 * H, perHour: 700 },
      ],
      startHour: 17,
      durationSec: 7 * H,
      seed: 20261028,
    },
    pair: ["bins", "smart"],
  },
  {
    id: "halloween",
    name: "ハロウィン級の夜",
    description:
      "19 時から翌 3 時。ピークの 21 時〜翌 1 時は、ごみを出す人が 1 時間に 2,500 人。見回りを立てる世界と、こまめに掃除する世界を比べる。",
    params: {
      ...base,
      arrivals: [
        { from: 0, perHour: 800 },
        { from: 2 * H, perHour: 2500 },
        { from: 6 * H, perHour: 1200 },
      ],
      startHour: 19,
      durationSec: 8 * H,
      seed: 20261031,
    },
    pair: ["patrol", "clean"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
