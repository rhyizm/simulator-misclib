/**
 * 食料品の消費税 8% → 1% のシミュレーション。
 *
 * 架空の町の世帯 (既定 200 世帯) が、毎月スーパーで食料品 (外食・酒類を除く) を買う。
 * 2027 年 4 月から 36 か月を 1 か月ずつ進め、方針ごとに「税が 8% のままだった場合と比べて、
 * 各世帯がいくら得をしたか」を積み上げる。
 *
 * - 減税の世界: 食料品の税率が 24 か月だけ 1% になる。店が値下げに回す割合 (転嫁率) は設定で変える。
 *   値下げに回らなかった分は「お店の取り分」として世帯には届かない。
 * - 給付の世界: 減税で減る税収と同じ額を、現金で配る (毎年 10 月に一度)。
 *
 * React や DOM には依存しない純粋な TypeScript。
 */

/** 1 ステップ = 1/10 か月 */
export const DT = 0.1;
/** 減税の期間 (か月)。2027 年 4 月 〜 2029 年 3 月 */
export const CUT_MONTHS = 24;
/** 記録する期間 (か月)。減税が終わった後の 1 年も見る */
export const TOTAL_MONTHS = 36;
/** 現金を配る月 (0 = 2027 年 4 月)。2027 年 10 月と 2028 年 10 月 */
export const PAY_MONTHS = [6, 18];

export const RATE_NOW = 0.08;
export const RATE_CUT = 0.01;

export type HouseholdKind = "worker" | "pension";

export interface Household {
  id: number;
  kind: HouseholdKind;
  /** 世帯の年収 (円、税・社会保険料を引く前) */
  income: number;
  /** 世帯の人数 */
  size: number;
  /** 2027 年 3 月の値段で、1 年に買う食料品 (税込み 8%、外食・酒類を除く) */
  foodPerYear: number;
}

export type PolicyKind = "none" | "cut" | "flat" | "targeted";

export interface Policy {
  name: string;
  kind: PolicyKind;
  /** 減税と組み合わせる「就業者負担軽減支援金」の規模 (減税の税収減に対する割合)。0 ならなし */
  workerSupport: number;
}

export interface SimParams {
  households: number;
  /** 食料品の値上がり (年率、税抜きの値段) */
  inflation: number;
  /** 減税分を店が値下げに回す割合 (0〜1) */
  passThrough: number;
  /** 給付の対象を絞るときの年収の上限 (円) */
  targetIncome: number;
  /** 就業者支援金の対象になる年収の範囲 (円) */
  supportMin: number;
  supportMax: number;
  seed: number;
}

export interface SeriesPoint {
  t: number;
  /** 食料品の値段の指数 (2027 年 3 月 = 100、税込み) */
  price: number;
  /** 1 世帯あたりの得の累計 (円) */
  gain: number;
}

export interface SimState {
  params: SimParams;
  policy: Policy;
  households: Household[];
  /** 各世帯の得の累計 (円)。households と同じ並び */
  gain: number[];
  /** 減税のうち、値下げに回らずお店に残った分の累計 (円) */
  leak: number;
  /** 国の税収が 8% のままと比べて減った額の累計 (円) */
  cost: number;
  /** 給付で配る予算 (1 回分、町全体、円) */
  payBudget: number;
  /** 給付の 1 回あたりの単価 (円)。flat/targeted は 1 人あたり、支援金は 1 世帯あたり */
  payPerPerson: number;
  supportPerHousehold: number;
  paidCount: number;
  t: number;
  series: SeriesPoint[];
}

// ---- 乱数 ----

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pick<T>(rand: () => number, items: [T, number][]): T {
  let r = rand();
  for (const [v, p] of items) {
    if (r < p) return v;
    r -= p;
  }
  return items[items.length - 1][0];
}

/**
 * 町の世帯をつくる。年収の低い順に並べて返す。
 * - 3 割が年金で暮らす世帯 (年収の中央値 260 万円)、7 割が働く人のいる世帯 (中央値 500 万円)。
 * - 食料品の支出は人数の 0.55 乗、年収の 0.3 乗に比例 (収入が 2 倍でも食費は 1.23 倍)。
 *   単身・年収 300 万円で月 3.4 万円を基準にし、年金世帯は家で食べる分が 15% 多い。
 */
export function makeHouseholds(n: number, seed: number): Household[] {
  const rand = mulberry32(seed);
  const list: Household[] = [];
  for (let i = 0; i < n; i++) {
    const kind: HouseholdKind = rand() < 0.3 ? "pension" : "worker";
    const median = kind === "pension" ? 2_600_000 : 5_000_000;
    const sigma = kind === "pension" ? 0.45 : 0.55;
    const income = Math.max(600_000, Math.min(30_000_000, median * Math.exp(sigma * normal(rand))));
    const size =
      kind === "pension"
        ? pick(rand, [[1, 0.45], [2, 0.55]])
        : pick(rand, [[1, 0.35], [2, 0.2], [3, 0.2], [4, 0.2], [5, 0.05]]);
    const noise = Math.exp(0.15 * normal(rand));
    const foodPerYear =
      34_000 * 12 * Math.pow(size, 0.55) * Math.pow(income / 3_000_000, 0.3) * (kind === "pension" ? 1.15 : 1) * noise;
    list.push({ id: i, kind, income, size, foodPerYear });
  }
  list.sort((a, b) => a.income - b.income);
  return list.map((h, i) => ({ ...h, id: i }));
}

// ---- 値段 ----

/** 税抜きの値段の伸び (2027 年 3 月 = 1) */
export function inflationFactor(t: number, inflation: number): number {
  return Math.pow(1 + inflation, t / 12);
}

/** 減税の世界で、店頭の税込み値段にかかる倍率 (8% のときを 1.08 とする) */
export function taxMultiplier(t: number, cut: boolean, passThrough: number): number {
  if (!cut || t >= CUT_MONTHS) return 1 + RATE_NOW;
  return 1 + RATE_NOW - (RATE_NOW - RATE_CUT) * passThrough;
}

/** 食料品の値段の指数 (2027 年 3 月の税込み = 100) */
export function priceIndex(t: number, inflation: number, cut: boolean, passThrough: number): number {
  return (100 * inflationFactor(t, inflation) * taxMultiplier(t, cut, passThrough)) / (1 + RATE_NOW);
}

/** 減税の 24 か月で、町全体の税収がいくら減るか (円)。給付の予算はこれに合わせる */
export function cutCost(households: Household[], inflation: number): number {
  let total = 0;
  const steps = CUT_MONTHS / DT;
  let infl = 0;
  for (let i = 0; i < steps; i++) infl += inflationFactor((i + 0.5) * DT, inflation) * DT;
  for (const h of households) {
    const pretaxPerMonth = h.foodPerYear / 12 / (1 + RATE_NOW);
    total += pretaxPerMonth * (RATE_NOW - RATE_CUT) * infl;
  }
  return total;
}

export function isCut(policy: Policy): boolean {
  return policy.kind === "cut";
}

export function inSupport(h: Household, p: SimParams): boolean {
  return h.kind === "worker" && h.income >= p.supportMin && h.income <= p.supportMax;
}

export function isTargeted(h: Household, p: SimParams): boolean {
  return h.income <= p.targetIncome;
}

// ---- シミュレーション ----

export function createSim(params: SimParams, policy: Policy): SimState {
  const households = makeHouseholds(params.households, params.seed);
  const total = cutCost(households, params.inflation);
  // 給付は 2 回に分けて配る
  const payBudget = total / PAY_MONTHS.length;
  let payPerPerson = 0;
  if (policy.kind === "flat") {
    const persons = households.reduce((s, h) => s + h.size, 0);
    payPerPerson = payBudget / persons;
  } else if (policy.kind === "targeted") {
    const persons = households.filter((h) => isTargeted(h, params)).reduce((s, h) => s + h.size, 0);
    payPerPerson = persons > 0 ? payBudget / persons : 0;
  }
  let supportPerHousehold = 0;
  if (policy.workerSupport > 0) {
    const n = households.filter((h) => inSupport(h, params)).length;
    supportPerHousehold = n > 0 ? (payBudget * policy.workerSupport) / n : 0;
  }
  const s: SimState = {
    params,
    policy,
    households,
    gain: households.map(() => 0),
    leak: 0,
    cost: 0,
    payBudget,
    payPerPerson,
    supportPerHousehold,
    paidCount: 0,
    t: 0,
    series: [],
  };
  record(s);
  return s;
}

function record(s: SimState) {
  const n = s.households.length;
  const gain = s.gain.reduce((a, b) => a + b, 0) / n;
  s.series.push({
    t: s.t,
    price: priceIndex(s.t, s.params.inflation, isCut(s.policy), s.params.passThrough),
    gain,
  });
}

export function isFinished(s: SimState): boolean {
  return s.t >= TOTAL_MONTHS - 1e-9;
}

export function step(s: SimState, dt: number = DT) {
  if (isFinished(s)) return;
  const p = s.params;
  const t0 = s.t;
  const tm = t0 + dt / 2;
  const infl = inflationFactor(tm, p.inflation);

  // 減税: 毎月の買い物のたびに少しずつ得をする
  if (isCut(s.policy) && tm < CUT_MONTHS) {
    for (let i = 0; i < s.households.length; i++) {
      const h = s.households[i];
      const pretax = (h.foodPerYear / 12 / (1 + RATE_NOW)) * infl * dt;
      const taxCut = pretax * (RATE_NOW - RATE_CUT);
      s.gain[i] += taxCut * p.passThrough;
      s.leak += taxCut * (1 - p.passThrough);
      s.cost += taxCut;
    }
  }

  s.t = Math.min(TOTAL_MONTHS, t0 + dt);

  // 現金: 決まった月にまとめて振り込まれる
  for (const m of PAY_MONTHS) {
    if (t0 < m && s.t >= m) pay(s);
  }

  // 0.5 か月ごとに記録
  if (Math.floor(s.t * 2 + 1e-9) !== Math.floor(t0 * 2 + 1e-9)) record(s);
}

function pay(s: SimState) {
  const p = s.params;
  s.paidCount++;
  for (let i = 0; i < s.households.length; i++) {
    const h = s.households[i];
    let amount = 0;
    if (s.policy.kind === "flat") amount = s.payPerPerson * h.size;
    else if (s.policy.kind === "targeted" && isTargeted(h, p)) amount = s.payPerPerson * h.size;
    if (s.policy.workerSupport > 0 && inSupport(h, p)) amount += s.supportPerHousehold;
    s.gain[i] += amount;
    s.cost += amount;
  }
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s, DT);
  return s;
}

// ---- 集計 ----

export interface QuintileStats {
  /** 1 世帯あたり 1 年の得 (円) */
  perYear: number;
  /** 年収に対する割合 */
  ofIncome: number;
  /** 平均年収 */
  income: number;
}

export interface SimStats {
  t: number;
  /** 1 世帯あたり 1 年の得 (円、24 か月の累計を 2 で割る) */
  perYear: number;
  /** お店に残った分 (1 世帯あたり 1 年、円) */
  leakPerYear: number;
  /** 国の負担 (1 世帯あたり 1 年、円) */
  costPerYear: number;
  quintiles: QuintileStats[];
  /** 年収の低い 20% が受け取った割合 */
  bottomShare: number;
  /** 年収の低い 20% にいる年金世帯の、1 世帯あたり 1 年の得 */
  lowPension: number;
  /** 何も受け取らなかった世帯の割合 */
  zeroShare: number;
  /** いまの食料品の値段の指数 */
  price: number;
  /** 減税が終わった月 (2029 年 4 月) に値段が跳ね上がる割合 */
  cliff: number;
}

export function getStats(s: SimState): SimStats {
  const n = s.households.length;
  const years = CUT_MONTHS / 12;
  const total = s.gain.reduce((a, b) => a + b, 0);
  const quintiles: QuintileStats[] = [];
  for (let q = 0; q < 5; q++) {
    const from = Math.floor((q * n) / 5);
    const to = Math.floor(((q + 1) * n) / 5);
    let g = 0;
    let inc = 0;
    let share = 0;
    for (let i = from; i < to; i++) {
      g += s.gain[i];
      inc += s.households[i].income;
      share += s.gain[i] / years / s.households[i].income;
    }
    const m = Math.max(1, to - from);
    quintiles.push({ perYear: g / years / m, ofIncome: share / m, income: inc / m });
  }
  const bottomTo = Math.floor(n / 5);
  let bottom = 0;
  let lp = 0;
  let lpn = 0;
  for (let i = 0; i < bottomTo; i++) {
    bottom += s.gain[i];
    if (s.households[i].kind === "pension") {
      lp += s.gain[i];
      lpn++;
    }
  }
  const zero = s.gain.filter((g) => g < 1).length;
  const p = s.params;
  const cut = isCut(s.policy);
  const before = priceIndex(CUT_MONTHS - 1e-6, p.inflation, cut, p.passThrough);
  const after = priceIndex(CUT_MONTHS, p.inflation, cut, p.passThrough);
  return {
    t: s.t,
    perYear: total / n / years,
    leakPerYear: s.leak / n / years,
    costPerYear: s.cost / n / years,
    quintiles,
    bottomShare: total > 0 ? bottom / total : 0,
    lowPension: lpn > 0 ? lp / lpn / years : 0,
    zeroShare: s.t > 0 ? zero / n : 0,
    price: priceIndex(s.t, p.inflation, cut, p.passThrough),
    cliff: after / before - 1,
  };
}

export interface AggregateStats {
  runs: number;
  stats: SimStats;
}

/** 乱数の種を変えた町で最後まで回し、指標を平均する */
export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const list: SimStats[] = [];
  for (let r = 0; r < runs; r++) {
    list.push(getStats(runToEnd(createSim({ ...params, seed: params.seed + r * 7919 }, policy))));
  }
  const avg = (f: (s: SimStats) => number) => list.reduce((a, s) => a + f(s), 0) / list.length;
  return {
    runs,
    stats: {
      t: avg((s) => s.t),
      perYear: avg((s) => s.perYear),
      leakPerYear: avg((s) => s.leakPerYear),
      costPerYear: avg((s) => s.costPerYear),
      quintiles: [0, 1, 2, 3, 4].map((q) => ({
        perYear: avg((s) => s.quintiles[q].perYear),
        ofIncome: avg((s) => s.quintiles[q].ofIncome),
        income: avg((s) => s.quintiles[q].income),
      })),
      bottomShare: avg((s) => s.bottomShare),
      lowPension: avg((s) => s.lowPension),
      zeroShare: avg((s) => s.zeroShare),
      price: avg((s) => s.price),
      cliff: avg((s) => s.cliff),
    },
  };
}
