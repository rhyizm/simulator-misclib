import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの方針 (初期値) */
  policies: [PolicyId, PolicyId];
}

export type PolicyId = "now" | "split" | "mfa" | "monitor" | "all";

export const POLICIES: Record<PolicyId, Policy> = {
  now: { name: "1 本の鍵で全部", split: false, mfa: false, monitor: false },
  split: { name: "鍵を区画に分ける", split: true, mfa: false, monitor: false },
  mfa: { name: "多要素認証だけ", split: false, mfa: true, monitor: false },
  monitor: { name: "見張りだけ", split: false, mfa: false, monitor: true },
  all: { name: "全部のせ", split: true, mfa: true, monitor: true },
};

export const POLICY_IDS: PolicyId[] = ["now", "split", "mfa", "monitor", "all"];

const base: Omit<SimParams, "seed"> = {
  segments: 10,
  stealDays: 12,
  prepDays: 34,
  spreadPerDay: 17,
  jumpDays: 30,
  mfaFactor: 0.2,
  monitorDays: 10,
  loginAlertProb: 0.3,
  customerNoticePerCellDay: 0.00015,
  horizonDays: 120,
};

export const scenarios: Scenario[] = [
  {
    id: "quiet",
    name: "静かに潜む攻撃者",
    description:
      "今回の経緯に合わせた設定。入り込んで約 12 日で管理者の鍵を盗み、1 か月あまり準備してから、届く範囲の顧客サーバーに毎日少しずつマルウェアを入れていく。気づくのは顧客の問い合わせ頼み。",
    params: { ...base, seed: 20261107 },
    policies: ["now", "split"],
  },
  {
    id: "fast",
    name: "急ぐ攻撃者",
    description:
      "身代金目当てで、鍵を盗んだら 2 日で一気に配る攻撃者。配る速さは 1 日 100 マス (約 6700 台)。見張りが気づく前に終わってしまうかもしれない。",
    params: { ...base, stealDays: 6, prepDays: 2, spreadPerDay: 100, jumpDays: 8, seed: 20261107 },
    policies: ["monitor", "split"],
  },
  {
    id: "noisy",
    name: "警報が多すぎる",
    description:
      "見張りはいるが、ふだんから警報が多すぎて埋もれている。不審なログインに気づく確率は 5%、使われ続けていることに気づくまで平均 60 日。攻撃者は「静かに潜む」と同じ。",
    params: { ...base, monitorDays: 60, loginAlertProb: 0.05, seed: 20261107 },
    policies: ["monitor", "all"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
