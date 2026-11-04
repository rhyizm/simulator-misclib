/**
 * クマの出没シミュレーション: 純粋な計算モデル。
 *
 * 山と集落が接する 1 つの地域に住むツキノワグマを 1 頭ずつ動かす。
 * 1 年は冬眠明けの 4 月から 11 月までの 32 週。毎週、山の餌が足りないほど
 * クマは集落へ下りてくる (= 出没)。集落で柿や生ごみを食べたクマは
 * 「人里の味を覚えたクマ」になり、それからは山に餌があっても下りてくる。
 * 単位は「年」。描画や React に依存しない。
 */

/** ブナ・ミズナラなど秋の堅果類の実り */
export type Mast = "good" | "fair" | "poor";

export interface SimParams {
  /** 何年流すか */
  years: number;
  /** 1 年目の西暦 (表示用) */
  firstYear: number;
  /** はじめにいるクマの頭数 */
  initialBears: number;
  /** はじめから人里の味を覚えているクマの割合 (2025 年の大量出没の名残) */
  initialLearnedShare: number;
  /** この地域の山が養えるクマの頭数 (環境収容力) */
  capacity: number;
  /** 1 頭あたり 1 年に生まれる子の数 (並作の翌年、頭数が少ないとき) */
  birthRate: number;
  /** 1 年に自然に死ぬ割合 */
  naturalDeath: number;
  /** はじめの何年かの実りを固定する (残りは前年の実りから確率で決まる) */
  fixedMasts: Mast[];
  /** 人里を知らないクマが 1 週に集落へ下りる確率 = base + hunger × (1 − 山の餌)² */
  wildBase: number;
  wildHunger: number;
  /** 人里を覚えたクマが 1 週に集落へ下りる確率 = base + hunger × (1 − 山の餌) */
  learnedBase: number;
  learnedHunger: number;
  /** 出没 1 件あたり、人がけがをする確率 */
  injuryPerSighting: number;
  /** 人里を覚えたクマが、下りても餌がなかったときに諦める確率 */
  forgetProb: number;
  /** 人里を覚えた母グマの子が、同じく人里を覚える確率 */
  inheritLearned: number;
  seed: number;
}

export interface Policy {
  name: string;
  /** 集落に残る餌 (放置された柿・栗、生ごみ、畑) の多さ。下りてきたクマが餌にありつける確率 (秋) */
  attractant: number;
  /** 緩衝帯 (やぶの刈り払い) で、人里を知らないクマが下りてくる確率に掛かる係数。1 = なし */
  buffer: number;
  /** 出没 1 件あたり、そのクマが捕獲 (駆除) される確率 */
  cullOnSight: number;
  /** 毎年の春に、地域のクマのうち捕獲する割合 (個体数管理) */
  springCull: number;
  /** 対策を始める年 (0 = 1 年目)。それまでは「いまのまま」 */
  from: number;
}

export const WEEKS_PER_YEAR = 32;
export const DT = 1 / WEEKS_PER_YEAR;

/** 秋 (9〜11 月) の山の餌の量 */
export const MAST_FOOD: Record<Mast, number> = { good: 1, fair: 0.65, poor: 0.2 };
/** 豊作の翌年は子が多く、凶作の翌年は少ない */
const MAST_BIRTH: Record<Mast, number> = { good: 1.5, fair: 1, poor: 0.5 };

export const BASELINE: Omit<Policy, "name" | "from"> = {
  attractant: 0.6,
  buffer: 1,
  cullOnSight: 0.1,
  springCull: 0,
};

export interface Bear {
  id: number;
  learned: boolean;
  /** 最後に集落へ下りた時刻 (年)。まだなら −1 */
  lastVisit: number;
  /** 最後に下りたとき、餌にありつけたか */
  ate: boolean;
}

export interface VillageEvent {
  t: number;
  bearId: number;
  kind: "ate" | "nofood" | "culled";
  learned: boolean;
}

export interface YearRecord {
  year: number;
  mast: Mast;
  bearsAtStart: number;
  sightings: number;
  /** 人里の味を覚えたクマによる出没 */
  learnedSightings: number;
  injuries: number;
  culled: number;
  /** 年の終わりに人里の味を覚えているクマ */
  learnedAtEnd: number;
}

export interface SeriesPoint {
  t: number;
  /** 出没の累計 */
  sightings: number;
  /** 人里の味を覚えたクマの頭数 */
  learned: number;
  /** クマの頭数 */
  bears: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  masts: Mast[];
  t: number;
  /** 今年の何週目か (0〜31) */
  week: number;
  year: number;
  bears: Bear[];
  nextId: number;
  years: YearRecord[];
  sightings: number;
  injuries: number;
  culled: number;
  events: VillageEvent[];
  series: SeriesPoint[];
  rng: () => number;
}

export interface SimStats {
  t: number;
  year: number;
  mast: Mast;
  bears: number;
  learned: number;
  sightings: number;
  sightingsThisYear: number;
  injuries: number;
  culled: number;
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

/** 前年の実りから今年の実りを決める。豊作の翌年は凶作になりやすい */
const MAST_NEXT: Record<Mast, [number, number, number]> = {
  // [豊作, 並作, 凶作]
  good: [0.05, 0.35, 0.6],
  fair: [0.3, 0.4, 0.3],
  poor: [0.45, 0.45, 0.1],
};

/** 実りの筋書きを作る。seed だけで決まるので、方針の違う世界どうしで共有できる */
export function generateMasts(p: SimParams): Mast[] {
  const rng = mulberry32(p.seed ^ 0x6b6d);
  const masts: Mast[] = [];
  for (let y = 0; y < p.years; y++) {
    if (y < p.fixedMasts.length) {
      masts.push(p.fixedMasts[y]);
      continue;
    }
    const prev = masts[y - 1] ?? "fair";
    const [g, f] = MAST_NEXT[prev];
    const r = rng();
    masts.push(r < g ? "good" : r < g + f ? "fair" : "poor");
  }
  return masts;
}

/** 今年のこの週の山の餌 (0〜1)。春は山菜や若葉、夏は端境期、秋は堅果類 */
export function forestFood(week: number, mast: Mast): number {
  if (week < 12) return 0.6;
  if (week < 20) return 0.45;
  return MAST_FOOD[mast];
}

/** 集落で餌が見つかる確率に掛かる季節の係数。秋は柿や栗が実る */
function villageSeason(week: number): number {
  return week >= 20 ? 1 : 0.6;
}

/** その年に効いている方針 (開始年より前は「いまのまま」) */
export function activePolicy(policy: Policy, year: number): Omit<Policy, "name" | "from"> {
  return year >= policy.from ? policy : BASELINE;
}

/** 1 頭が 1 週に集落へ下りてくる確率 */
export function approachProb(p: SimParams, pol: Omit<Policy, "name" | "from">, learned: boolean, food: number): number {
  const h = 1 - food;
  if (learned) {
    // 人里を覚えたクマはやぶがなくても下りてくる。緩衝帯の効きは 4 割ほど
    const buf = 1 - (1 - pol.buffer) * 0.4;
    return Math.min(1, (p.learnedBase + p.learnedHunger * h) * buf);
  }
  return Math.min(1, (p.wildBase + p.wildHunger * h * h) * pol.buffer);
}

export function createSim(params: SimParams, policy: Policy, masts?: Mast[]): SimState {
  const rng = mulberry32(params.seed);
  const bears: Bear[] = [];
  for (let i = 0; i < params.initialBears; i++) {
    bears.push({ id: i, learned: rng() < params.initialLearnedShare, lastVisit: -1, ate: false });
  }
  const s: SimState = {
    policy,
    params,
    masts: masts ?? generateMasts(params),
    t: 0,
    week: 0,
    year: 0,
    bears,
    nextId: bears.length,
    years: [],
    sightings: 0,
    injuries: 0,
    culled: 0,
    events: [],
    series: [],
    rng,
  };
  startYear(s, false);
  s.series.push(point(s));
  return s;
}

function countLearned(bears: Bear[]): number {
  let n = 0;
  for (const b of bears) if (b.learned) n++;
  return n;
}

function point(s: SimState): SeriesPoint {
  return {
    t: Math.round(s.t * 1000) / 1000,
    sightings: s.sightings,
    learned: countLearned(s.bears),
    bears: s.bears.length,
  };
}

/** 冬眠明け: 死亡・出産・春の捕獲をまとめて済ませ、今年の記録を始める */
function startYear(s: SimState, breed: boolean) {
  const p = s.params;
  const pol = activePolicy(s.policy, s.year);
  let culled = 0;
  if (breed) {
    const prevMast = s.masts[s.year - 1] ?? "fair";
    const survivors = s.bears.filter(() => s.rng() >= p.naturalDeath);
    const room = Math.max(0, 1 - survivors.length / p.capacity);
    const cubs: Bear[] = [];
    for (const mom of survivors) {
      if (s.rng() < p.birthRate * MAST_BIRTH[prevMast] * room) {
        const learned = mom.learned && s.rng() < p.inheritLearned;
        cubs.push({ id: s.nextId++, learned, lastVisit: -1, ate: false });
      }
    }
    s.bears = survivors.concat(cubs);
    for (const b of s.bears) b.lastVisit = -1;
  }
  if (pol.springCull > 0) {
    const before = s.bears.length;
    s.bears = s.bears.filter(() => s.rng() >= pol.springCull);
    culled = before - s.bears.length;
    s.culled += culled;
  }
  s.years.push({
    year: s.year,
    mast: s.masts[s.year],
    bearsAtStart: s.bears.length,
    sightings: 0,
    learnedSightings: 0,
    injuries: 0,
    culled,
    learnedAtEnd: countLearned(s.bears),
  });
}

function stepWeek(s: SimState) {
  const p = s.params;
  const pol = activePolicy(s.policy, s.year);
  const rec = s.years[s.year];
  const food = forestFood(s.week, s.masts[s.year]);
  const villageFood = Math.min(1, pol.attractant * villageSeason(s.week));
  const removed = new Set<number>();
  for (const b of s.bears) {
    if (s.rng() >= approachProb(p, pol, b.learned, food)) continue;
    // 出没
    const wasLearned = b.learned;
    s.sightings++;
    rec.sightings++;
    if (wasLearned) rec.learnedSightings++;
    s.injuries += p.injuryPerSighting;
    rec.injuries += p.injuryPerSighting;
    b.lastVisit = s.t;
    if (s.rng() < villageFood) {
      b.ate = true;
      b.learned = true;
    } else {
      b.ate = false;
      if (b.learned && s.rng() < p.forgetProb) b.learned = false;
    }
    let kind: VillageEvent["kind"] = b.ate ? "ate" : "nofood";
    if (s.rng() < pol.cullOnSight) {
      removed.add(b.id);
      s.culled++;
      rec.culled++;
      kind = "culled";
    }
    s.events.push({ t: s.t, bearId: b.id, kind, learned: wasLearned });
  }
  if (removed.size > 0) s.bears = s.bears.filter((b) => !removed.has(b.id));
  if (s.events.length > 200) s.events.splice(0, s.events.length - 200);
  rec.learnedAtEnd = countLearned(s.bears);
}

/** シミュレーションを 1 週進める */
export function step(s: SimState) {
  if (isFinished(s)) return;
  stepWeek(s);
  s.week++;
  s.t = s.year + s.week / WEEKS_PER_YEAR;
  if (s.week >= WEEKS_PER_YEAR) {
    s.week = 0;
    s.year++;
    s.t = s.year;
    if (s.year < s.params.years) startYear(s, true);
  }
  s.series.push(point(s));
}

export function isFinished(s: SimState): boolean {
  return s.year >= s.params.years;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s);
  return s;
}

export function getStats(s: SimState): SimStats {
  const y = Math.min(s.year, s.params.years - 1);
  return {
    t: s.t,
    year: y,
    mast: s.masts[y],
    bears: s.bears.length,
    learned: countLearned(s.bears),
    sightings: s.sightings,
    sightingsThisYear: s.years[y]?.sightings ?? 0,
    injuries: s.injuries,
    culled: s.culled,
  };
}

export interface AggregateStats {
  runs: number;
  /** 期間全体の出没件数 */
  sightings: number;
  /** 2 年目 (凶作が予想される年) の出没件数 */
  sightingsYear2: number;
  /** 凶作の年 1 年あたりの出没件数 */
  sightingsPoorYear: number;
  /** 豊作・並作の年 1 年あたりの出没件数 */
  sightingsOtherYear: number;
  injuries: number;
  culled: number;
  finalBears: number;
  finalLearned: number;
}

/** seed を変えて何回も回した平均。各回、どの世界も同じ実りの筋書きを使う */
export function aggregate(params: SimParams, policies: Policy[], runs: number): AggregateStats[] {
  const acc = policies.map(() => ({
    sightings: 0,
    sightingsYear2: 0,
    poor: 0,
    poorYears: 0,
    other: 0,
    otherYears: 0,
    injuries: 0,
    culled: 0,
    finalBears: 0,
    finalLearned: 0,
  }));
  for (let r = 0; r < runs; r++) {
    const p = { ...params, seed: params.seed + r * 7919 };
    const masts = generateMasts(p);
    policies.forEach((pol, i) => {
      const s = runToEnd(createSim(p, pol, masts));
      const a = acc[i];
      a.sightings += s.sightings;
      a.sightingsYear2 += s.years[1]?.sightings ?? 0;
      for (const y of s.years) {
        if (y.mast === "poor") {
          a.poor += y.sightings;
          a.poorYears++;
        } else {
          a.other += y.sightings;
          a.otherYears++;
        }
      }
      a.injuries += s.injuries;
      a.culled += s.culled;
      a.finalBears += s.bears.length;
      a.finalLearned += countLearned(s.bears);
    });
  }
  return acc.map((a) => ({
    runs,
    sightings: a.sightings / runs,
    sightingsYear2: a.sightingsYear2 / runs,
    sightingsPoorYear: a.poorYears > 0 ? a.poor / a.poorYears : NaN,
    sightingsOtherYear: a.otherYears > 0 ? a.other / a.otherYears : NaN,
    injuries: a.injuries / runs,
    culled: a.culled / runs,
    finalBears: a.finalBears / runs,
    finalLearned: a.finalLearned / runs,
  }));
}
