import type { Policy, SimParams } from "./model";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  params: SimParams;
}

const base: SimParams = {
  bears: 40,
  mast: 0.7,
  habituated: 0.05,
  trees: 36,
  garbage: 12,
  seed: 20261117,
};

export const scenarios: Scenario[] = [
  {
    id: "poor",
    name: "ブナ大凶作の秋",
    description:
      "ブナもナラも実らない秋 (2026 年の群馬県など)。森の木の実は並作の 3 割。山の 40 頭は冬眠までに太るため、里へ食べ物を探しに下りてくる。",
    params: { ...base, mast: 0.3 },
  },
  {
    id: "normal",
    name: "並作の秋",
    description: "木の実がふつうに実る秋。おなかをすかせて里へ下りるクマは少ないが、畑の柿や栗はいつもどおり実る。",
    params: base,
  },
  {
    id: "good",
    name: "豊作の秋",
    description: "ブナが豊作の秋 (2026 年の秋田県など)。山で十分に太れるので、ほとんどのクマは里に用がない。",
    params: { ...base, mast: 1.1 },
  },
  {
    id: "habit",
    name: "凶作 2 年目",
    description:
      "前の年も凶作で、40 頭のうち 3 割がすでに里の柿やごみの味を覚えている。木の実は並作の 4 割。覚えたクマは空腹でなくても通ってくる。",
    params: { ...base, mast: 0.4, habituated: 0.3 },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}

export interface PolicyOption {
  id: string;
  label: string;
  note: string;
  policy: Policy;
}

const none: Policy = {
  name: "いまのまま",
  springCull: 0,
  attractantRemoval: 0,
  buffer: false,
  capture: "normal",
};

export const POLICIES: PolicyOption[] = [
  {
    id: "none",
    label: "いまのまま",
    note: "柿や栗の木はそのまま、やぶもそのまま。出てきたクマは猟友会がわなで捕る (週 1 頭まで)。",
    policy: none,
  },
  {
    id: "cull",
    label: "春に 3 割減らす",
    note: "春のうちに山の 40 頭のうち 3 割 (12 頭) を捕獲しておく (個体数調整)。秋の対策はいまのまま。",
    policy: { ...none, name: "春に 3 割減らす", springCull: 0.3 },
  },
  {
    id: "capture",
    label: "出たら必ず捕る",
    note: "専従の捕獲チームとわなを増やし、町では緊急銃猟も使う (週 3 頭まで)。通報されたクマを素早く捕る。",
    policy: { ...none, name: "出たら必ず捕る", capture: "strong" },
  },
  {
    id: "attract",
    label: "柿とごみを片づける",
    note: "持ち主のいない柿・栗の木の 8 割を切るか早めに収穫し、ごみ置き場の 8 割を囲う。",
    policy: { ...none, name: "柿とごみを片づける", attractantRemoval: 0.8 },
  },
  {
    id: "buffer",
    label: "やぶを刈る",
    note: "里山の縁のやぶを幅 300 m 刈り払い、見通しのよい緩衝帯にする。クマは身を隠せない草地を嫌って引き返しやすい。",
    policy: { ...none, name: "やぶを刈る", buffer: true },
  },
  {
    id: "all",
    label: "全部のせ",
    note: "柿とごみを片づけ、やぶを刈り、出てきたクマは必ず捕る。春の個体数調整はしない。",
    policy: { ...none, name: "全部のせ", attractantRemoval: 0.8, buffer: true, capture: "strong" },
  },
];

export function getPolicy(id: string): PolicyOption {
  return POLICIES.find((p) => p.id === id) ?? POLICIES[0];
}
