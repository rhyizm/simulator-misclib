import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
}

const base: SimParams = {
  faultPerKm: 0.8,
  roadPerKm: 0.7,
  severity: 1,
  storms: [{ fromH: 0, hours: 30, weight: 1 }],
  workFromHour: 7,
  workToHour: 18,
  durationH: 7 * 24,
  seed: 20261120,
};

export const scenarios: Scenario[] = [
  {
    id: "wet",
    name: "11 月の湿った重い雪",
    description:
      "11 月 20 日 (金) の昼から 30 時間、湿った重い雪が降る。まだ葉の残る木に雪が張りつき、枝ごと折れて電線と道に倒れかかる。変電所から谷沿いに延びる配電線の先に、約 4,100 戸。",
    params: base,
  },
  {
    id: "dry",
    name: "真冬の乾いた雪",
    description:
      "同じ量の雪でも、葉が落ちた真冬の乾いた雪なら木に積もりにくい。倒れる木は 11 月の雪の 3 分の 1 とする。",
    params: { ...base, faultPerKm: base.faultPerKm / 3, roadPerKm: base.roadPerKm / 3 },
  },
  {
    id: "again",
    name: "復旧中にもう一度降る",
    description:
      "11 月の湿った雪がやんで 1 日半後、22 日 (日) の夜からもう一度 18 時間降る。2 回目の雪で倒れる木は 1 回目の 6 割。直したばかりの線がまた切れ、片づけた道がまたふさがる。",
    params: { ...base, storms: [...base.storms, { fromH: 54, hours: 18, weight: 0.6 }] },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}

const now: Policy = {
  id: "now",
  name: "いまのまま",
  crews: 6,
  extraCrews: 0,
  extraCrewsAtH: 24,
  roadTeams: 0,
  roadTeamsAtH: 24,
  trimmed: false,
  generators: 0,
  generatorsAtH: 18,
};

/** 左右の世界で選べる対策 */
export const POLICIES: { policy: Policy; note: string }[] = [
  { policy: now, note: "地元の作業班 6 班が、電気が戻る家の多い所から順に直していく" },
  {
    policy: { ...now, id: "crews", name: "作業班を倍に", extraCrews: 6 },
    note: "ほかの地域から応援の 6 班が、降り始めから 24 時間後 (21 日の昼) に着く",
  },
  {
    policy: { ...now, id: "road", name: "道の倒木を先に片づける", roadTeams: 3 },
    note: "自衛隊や地元の建設業者の 3 隊が、24 時間後から道の倒木だけを片づける。作業班の 2 倍の速さ",
  },
  {
    policy: { ...now, id: "trim", name: "電線沿いの木を伐っておく", trimmed: true },
    note: "支線沿いの木を前もって伐っておく。支線で電線が切れる倒木は 3 分の 1、道をふさぐ倒木は 6 割に減る",
  },
  {
    policy: { ...now, id: "gen", name: "電源車を出す", generators: 4 },
    note: "電源車 4 台が、降り始めから 18 時間後から、すぐには戻りそうにない集落へ行って電気を送る (1 台 1 集落)",
  },
  {
    policy: { ...now, id: "all", name: "全部のせ", extraCrews: 6, roadTeams: 3, trimmed: true, generators: 4 },
    note: "応援 6 班・道の片づけ 3 隊・事前の伐採・電源車 4 台をすべて",
  },
];

export function getPolicy(id: string): Policy {
  return (POLICIES.find((p) => p.policy.id === id) ?? POLICIES[0]).policy;
}

export function getPolicyNote(id: string): string {
  return (POLICIES.find((p) => p.policy.id === id) ?? POLICIES[0]).note;
}
