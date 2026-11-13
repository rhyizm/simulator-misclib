import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
  /** 左右に並べて比べる 2 つの方針 (初期値) */
  policies: [PolicyId, PolicyId];
}

export type PolicyId = "now" | "strict" | "target" | "online" | "staff" | "targetStaff";

export const POLICIES: Record<PolicyId, Policy> = {
  now: { name: "無作為に 1 割を検査", redRate: 0.1, targeted: false, onlineShare: 0, extraInspectors: 0 },
  strict: { name: "無作為に 2 割を検査", redRate: 0.2, targeted: false, onlineShare: 0, extraInspectors: 0 },
  target: { name: "高額の人を重点検査", redRate: 0, targeted: true, onlineShare: 0, extraInspectors: 0 },
  online: { name: "4 割がスマホで事前申告", redRate: 0.1, targeted: false, onlineShare: 0.4, extraInspectors: 0 },
  staff: { name: "検査員を 3 人増やす", redRate: 0.1, targeted: false, onlineShare: 0, extraInspectors: 3 },
  targetStaff: { name: "重点検査 + 検査員 4 人増", redRate: 0, targeted: true, onlineShare: 0, extraInspectors: 4 },
};

export const POLICY_IDS: PolicyId[] = ["now", "strict", "target", "online", "staff", "targetStaff"];

const base: Omit<SimParams, "arrivalsPerHour" | "waveAmp" | "kioskSec" | "inspectors" | "seed"> = {
  wavePeriodSec: 2700,
  kiosks: 24,
  slackMinMin: 20,
  slackExtraMin: 40,
  durationSec: 4 * 3600,
};

export const scenarios: Scenario[] = [
  {
    id: "normal",
    name: "ふだんの昼",
    description:
      "免税品を持って出国する人が 1 時間に 600 人。端末は 24 台、税関の検査員は 6 人。端末の操作には慣れていて 1 人 1 分。",
    params: { ...base, arrivalsPerHour: 600, waveAmp: 0, kioskSec: 60, inspectors: 6, seed: 20261113 },
    policies: ["now", "strict"],
  },
  {
    id: "first",
    name: "始まったばかり",
    description:
      "人数はふだんと同じだが、初めての端末に戸惑い、言葉の選び直しや係員の手助けで 1 人 2 分半かかる。11 月 1 日の開始直後の空港。",
    params: { ...base, arrivalsPerHour: 600, waveAmp: 0, kioskSec: 150, inspectors: 6, seed: 20261113 },
    policies: ["now", "online"],
  },
  {
    id: "wave",
    name: "団体客の波",
    description:
      "大型連休の朝。ツアーバスが 45 分おきに着き、1 時間平均 750 人が波になって押し寄せる (多い時は平均の 1.8 倍)。検査員は 1 人増やして 7 人。",
    params: { ...base, arrivalsPerHour: 750, waveAmp: 0.8, kioskSec: 60, inspectors: 7, seed: 20261113 },
    policies: ["now", "target"],
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
