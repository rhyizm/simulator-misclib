/**
 * 在宅避難シミュレーション: 純粋な計算モデル。
 *
 * 大きな地震のあと、ある町の 400 世帯が「家に残れるか、避難所へ移るか」を
 * 1 時間きざみで追う。水・食料・トイレの 3 つを別々に数え、
 * 断水や停電が続く間は各家庭の備蓄を取り崩していく。
 * 単位は「日」。描画や React に依存しない。
 */

export type Resource = "water" | "food" | "toilet";
export const RESOURCES: Resource[] = ["water", "food", "toilet"];

export type LeaveReason = "damage" | Resource;

export type HouseStatus = "home" | "low" | "shelter" | "overflow" | "damaged";

/** 町の 1 世帯。どの世界でも共有する (備蓄の量だけが世界ごとに違う) */
export interface Household {
  size: number;
  /** 家が壊れて、地震の直後から住めない */
  damaged: boolean;
  /** 集合住宅 (停電でポンプが止まると断水し、排水管の点検までトイレを流せない) */
  apartment: boolean;
  /** 給水所や避難所のトイレ、配給まで自力で通える */
  canFetch: boolean;
  /** 水道が戻る日 (集合住宅は停電の復旧も待つ) */
  waterDay: number;
  /** トイレを流せるようになる日 */
  toiletDay: number;
  /** 近くの店が開いて食料が買えるようになる日 */
  foodDay: number;
  /** 備えの度合い (0〜1)。資源ごとに少しずつ違う */
  prep: Record<Resource, number>;
  /** 我慢強さ。我慢できる日数にかける倍率 (0.5〜1.5) */
  patience: number;
}

export interface SimParams {
  days: number;
  households: number;
  /** 家が壊れて住めなくなる世帯の割合 */
  damageRate: number;
  /** 集合住宅の世帯の割合 */
  apartmentRate: number;
  /** 自力で給水所などへ通える世帯の割合 (ひとり暮らしの高齢者は下がる) */
  fetchRate: number;
  /** 断水する街区の割合 */
  waterOutRate: number;
  /** 断水した街区の水道が戻る日 (最短〜最長) */
  waterDays: [number, number];
  /** 停電する街区の割合 */
  powerOutRate: number;
  powerDays: [number, number];
  /** 集合住宅で排水管の点検が終わる日 (最短〜最長) */
  drainCheckDays: [number, number];
  /** 店が開き始める日 (最短〜最長) */
  shopDays: [number, number];
  /** 給水車・給水所が動き始める日 */
  reliefWaterDay: number;
  /** 避難所で食料の配給が始まる日 */
  reliefFoodDay: number;
  /** 避難所に仮設トイレが届く日 */
  reliefToiletDay: number;
  /** 避難所の定員 (町の人口に対する割合) */
  shelterRate: number;
  /** 備蓄が尽きてから、家に残って我慢できる日数 */
  tolerance: Record<Resource, number>;
  seed: number;
}

export interface Policy {
  id: string;
  label: string;
  desc: string;
  /** 各資源の備蓄を最低これだけの日数にそろえる (0 ならいまのまま) */
  minStock: Record<Resource, number>;
}

export interface SeriesPoint {
  t: number;
  /** 家で暮らせている人 */
  home: number;
  /** 避難所にいる人 (定員まで) */
  shelter: number;
  /** 避難所に入れず車中泊・軒先などで過ごす人 */
  overflow: number;
}

export interface HouseState {
  status: HouseStatus;
  stock: Record<Resource, number>;
  deficit: Record<Resource, number>;
  reason: LeaveReason | null;
  /** 避難所へ移った日 */
  leftAt: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  town: Household[];
  houses: HouseState[];
  population: number;
  capacity: number;
  t: number;
  /** 避難所に入れた順 (先に来た人から定員を埋める) */
  queue: number[];
  peakEvacuees: number;
  shelterPersonDays: number;
  overflowPersonDays: number;
  /** 家を出た理由ごとの人数 (延べではなく世帯の人数) */
  reasons: Record<LeaveReason, number>;
  /** 一度でも家を出た人 */
  everLeft: number;
  series: SeriesPoint[];
}

export interface SimStats {
  t: number;
  home: number;
  shelter: number;
  overflow: number;
  evacuees: number;
  capacity: number;
  peakEvacuees: number;
  shelterPersonDays: number;
  overflowPersonDays: number;
  everLeft: number;
  reasons: Record<LeaveReason, number>;
  population: number;
}

/** 乱数 (mulberry32): seed が同じなら同じ結果になる */
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

/** 街区の大きさ (世帯数)。同じ街区は同じ日に水道や電気が戻る */
export const BLOCK = 20;

const NEVER = 0;

function between(rng: () => number, [lo, hi]: [number, number]): number {
  return lo + rng() * (hi - lo);
}

/**
 * 町を作る。seed だけで決まるので、備えの違う世界どうしで
 * まったく同じ家・同じ被害・同じ復旧の日程を共有できる。
 */
export function generateTown(p: SimParams): Household[] {
  const rng = mulberry32(p.seed ^ 0x7a11);
  const blocks = Math.ceil(p.households / BLOCK);
  const blockInfo = Array.from({ length: blocks }, () => {
    const waterOut = rng() < p.waterOutRate;
    const powerOut = rng() < p.powerOutRate;
    return {
      water: waterOut ? between(rng, p.waterDays) : NEVER,
      power: powerOut ? between(rng, p.powerDays) : NEVER,
      shop: between(rng, p.shopDays),
      apartment: rng() < p.apartmentRate,
    };
  });
  const town: Household[] = [];
  for (let i = 0; i < p.households; i++) {
    const b = blockInfo[Math.floor(i / BLOCK)];
    const r = rng();
    const size = r < 0.38 ? 1 : r < 0.66 ? 2 : r < 0.83 ? 3 : 4;
    // 集合住宅は街区ごとにまとめる (同じ建物の住人は同じ設備を共有する)
    const apartment = b.apartment;
    // ひとり暮らしは通えない人がやや多い
    const fetchP = size === 1 ? p.fetchRate - 0.15 : p.fetchRate + 0.06;
    const canFetch = rng() < fetchP;
    const damaged = rng() < p.damageRate;
    const waterDay = apartment ? Math.max(b.water, b.power) : b.water;
    const drain = apartment ? between(rng, p.drainCheckDays) : NEVER;
    const toiletDay = Math.max(waterDay, drain);
    // 備えはよく備える家・備えない家の傾向 (common) に、資源ごとのばらつきを足す
    const common = rng();
    const mix = () => Math.min(0.999, Math.max(0, 0.6 * common + 0.4 * rng()));
    town.push({
      size,
      damaged,
      apartment,
      canFetch,
      waterDay,
      toiletDay,
      foodDay: b.shop,
      prep: { water: mix(), food: mix(), toilet: mix() },
      patience: 0.5 + rng(),
    });
  }
  return town;
}

/**
 * いまの備え (日数) を、備えの度合い 0〜1 から決める。
 * 「3 日分以上ある」家が水 7 割、食料 6 割、携帯トイレ 3 割弱になるように置いた。
 * 内閣府の世論調査 (2025 年) の自己申告 (水 69.8%、食料 59.7%、携帯トイレ 27.5%) に合わせている。
 * 備えの度合いは 0.6U+0.4U の台形分布なので、しきい値はその分位点。
 */
export function baseStock(r: Resource, prep: number): number {
  if (r === "toilet") return prep < 0.53 ? 0 : prep < 0.64 ? 1 : prep < 0.817 ? 3 : 7;
  if (r === "water") return prep < 0.24 ? 0 : prep < 0.379 ? 1 : prep < 0.732 ? 3 : 7;
  return prep < 0.268 ? 0 : prep < 0.44 ? 1 : prep < 0.732 ? 3 : 7;
}

export const DT = 1 / 24;

export function createSim(params: SimParams, policy: Policy, town?: Household[]): SimState {
  const t = town ?? generateTown(params);
  let population = 0;
  for (const h of t) population += h.size;
  const houses: HouseState[] = t.map((h) => {
    const stock = {} as Record<Resource, number>;
    for (const r of RESOURCES) stock[r] = Math.max(baseStock(r, h.prep[r]), policy.minStock[r]);
    return {
      status: "home",
      stock,
      deficit: { water: 0, food: 0, toilet: 0 },
      reason: null,
      leftAt: 0,
    };
  });
  const s: SimState = {
    policy,
    params,
    town: t,
    houses,
    population,
    capacity: Math.round(population * params.shelterRate),
    t: 0,
    queue: [],
    peakEvacuees: 0,
    shelterPersonDays: 0,
    overflowPersonDays: 0,
    reasons: { damage: 0, water: 0, food: 0, toilet: 0 },
    everLeft: 0,
    series: [],
  };
  // 家が壊れた世帯は地震の直後に避難所へ
  t.forEach((h, i) => {
    if (h.damaged) leave(s, i, "damage");
  });
  admit(s);
  s.series.push(snapshot(s));
  return s;
}

/** その資源が「備蓄を使わずに」手に入るか */
export function available(p: SimParams, h: Household, r: Resource, t: number): boolean {
  if (r === "water") return t >= h.waterDay || (h.canFetch && t >= p.reliefWaterDay);
  if (r === "food") return t >= h.foodDay || (h.canFetch && t >= p.reliefFoodDay);
  return t >= h.toiletDay || (h.canFetch && t >= p.reliefToiletDay);
}

function leave(s: SimState, i: number, reason: LeaveReason) {
  const hs = s.houses[i];
  hs.status = "overflow";
  hs.reason = reason;
  hs.leftAt = s.t;
  s.queue.push(i);
  s.reasons[reason] += s.town[i].size;
  s.everLeft += s.town[i].size;
}

/** 先に来た世帯から定員まで避難所に入れ、残りはあふれる */
function admit(s: SimState) {
  let used = 0;
  for (const i of s.queue) {
    const size = s.town[i].size;
    // 定員はきっちり守らない: 入り始めた世帯は入れる
    if (used < s.capacity) {
      s.houses[i].status = s.town[i].damaged ? "damaged" : "shelter";
      used += size;
    } else {
      s.houses[i].status = "overflow";
    }
  }
}

function counts(s: SimState) {
  let home = 0;
  let shelter = 0;
  let overflow = 0;
  s.houses.forEach((hs, i) => {
    const n = s.town[i].size;
    if (hs.status === "home" || hs.status === "low") home += n;
    else if (hs.status === "overflow") overflow += n;
    else shelter += n;
  });
  return { home, shelter, overflow };
}

function snapshot(s: SimState): SeriesPoint {
  const c = counts(s);
  return { t: Math.round(s.t * 100) / 100, ...c };
}

/** シミュレーションを dt 日進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.days) return;
  const t1 = Math.min(p.days, s.t + dt);
  const span = t1 - s.t;
  let changed = false;
  for (let i = 0; i < s.houses.length; i++) {
    const h = s.town[i];
    const hs = s.houses[i];
    if (hs.status === "home" || hs.status === "low") {
      let low = false;
      let reason: LeaveReason | null = null;
      for (const r of RESOURCES) {
        if (available(p, h, r, s.t)) {
          hs.deficit[r] = 0;
          continue;
        }
        if (hs.stock[r] > 0) {
          hs.stock[r] = Math.max(0, hs.stock[r] - span);
          if (hs.stock[r] < 1) low = true;
        } else {
          hs.deficit[r] += span;
          low = true;
          if (hs.deficit[r] > p.tolerance[r] * h.patience && reason === null) reason = r;
        }
      }
      if (reason) {
        leave(s, i, reason);
        changed = true;
      } else {
        hs.status = low ? "low" : "home";
      }
    } else if (hs.status === "shelter" || hs.status === "overflow") {
      // 家が無事な世帯は、水・トイレ・食料が備蓄なしで回るようになったら帰る。
      // 帰る家の備蓄は使い切っている前提 (0 から)
      if (!h.damaged && RESOURCES.every((r) => available(p, h, r, s.t))) {
        hs.status = "home";
        for (const r of RESOURCES) {
          hs.stock[r] = 0;
          hs.deficit[r] = 0;
        }
        s.queue = s.queue.filter((q) => q !== i);
        changed = true;
      }
    }
  }
  if (changed) admit(s);
  s.t = t1;
  const c = counts(s);
  s.shelterPersonDays += c.shelter * span;
  s.overflowPersonDays += c.overflow * span;
  s.peakEvacuees = Math.max(s.peakEvacuees, c.shelter + c.overflow);
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 0.25 - 1e-9 || s.t >= p.days) s.series.push(snapshot(s));
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.days;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export function getStats(s: SimState): SimStats {
  const c = counts(s);
  return {
    t: s.t,
    home: c.home,
    shelter: c.shelter,
    overflow: c.overflow,
    evacuees: c.shelter + c.overflow,
    capacity: s.capacity,
    peakEvacuees: s.peakEvacuees,
    shelterPersonDays: s.shelterPersonDays,
    overflowPersonDays: s.overflowPersonDays,
    everLeft: s.everLeft,
    reasons: { ...s.reasons },
    population: s.population,
  };
}

export interface AggregateStats {
  runs: number;
  population: number;
  capacity: number;
  peakEvacuees: number;
  /** 避難者が定員を超えた回の割合 */
  overCapacityShare: number;
  shelterPersonDays: number;
  overflowPersonDays: number;
  everLeft: number;
  reasons: Record<LeaveReason, number>;
  /** 最終日に家で暮らせている人の割合 */
  homeAtEnd: number;
}

/** seed を変えて何回も回した平均。各回、どの世界も同じ町と同じ復旧日程を使う */
export function aggregate(params: SimParams, policies: Policy[], runs: number): AggregateStats[] {
  const acc = policies.map<AggregateStats>(() => ({
    runs,
    population: 0,
    capacity: 0,
    peakEvacuees: 0,
    overCapacityShare: 0,
    shelterPersonDays: 0,
    overflowPersonDays: 0,
    everLeft: 0,
    reasons: { damage: 0, water: 0, food: 0, toilet: 0 },
    homeAtEnd: 0,
  }));
  for (let r = 0; r < runs; r++) {
    const p = { ...params, seed: params.seed + r * 7919 };
    const town = generateTown(p);
    policies.forEach((pol, i) => {
      const st = getStats(runToEnd(createSim(p, pol, town)));
      const a = acc[i];
      a.population += st.population;
      a.capacity += st.capacity;
      a.peakEvacuees += st.peakEvacuees;
      if (st.peakEvacuees > st.capacity) a.overCapacityShare += 1;
      a.shelterPersonDays += st.shelterPersonDays;
      a.overflowPersonDays += st.overflowPersonDays;
      a.everLeft += st.everLeft;
      for (const k of Object.keys(a.reasons) as LeaveReason[]) a.reasons[k] += st.reasons[k];
      a.homeAtEnd += st.home / st.population;
    });
  }
  return acc.map((a) => {
    const reasons = { ...a.reasons };
    for (const k of Object.keys(reasons) as LeaveReason[]) reasons[k] /= runs;
    return {
      runs,
      population: a.population / runs,
      capacity: a.capacity / runs,
      peakEvacuees: a.peakEvacuees / runs,
      overCapacityShare: a.overCapacityShare / runs,
      shelterPersonDays: a.shelterPersonDays / runs,
      overflowPersonDays: a.overflowPersonDays / runs,
      everLeft: a.everLeft / runs,
      reasons,
      homeAtEnd: a.homeAtEnd / runs,
    };
  });
}
