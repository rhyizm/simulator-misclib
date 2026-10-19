/**
 * 男女トイレの便器数の配分シミュレーション: 純粋な計算モデル。
 *
 * 単位は「秒」。同じ広さ (便器の総数) を男女でどう分けるかを変えて、
 * 待ち時間がどう変わるかを見る。描画や React に依存しない。
 */

export type Gender = "f" | "m";
/** stall = 個室 (女性用・男性用の大便器), urinal = 小便器, flex = 時間帯で男女を切り替える個室 */
export type FixtureKind = "stall" | "urinal" | "flex";
export type Need = "stall" | "urinal";

export interface Layout {
  /** 画面に出す名前 */
  name: string;
  femaleStalls: number;
  maleStalls: number;
  urinals: number;
  /** 可変トイレ: 一定時間ごとに男女どちらかに割り当てる個室 */
  flexStalls: number;
}

export interface ArrivalPhase {
  /** このフェーズが始まる時刻 (秒) */
  from: number;
  /** 1 分あたりの到着人数 (男女合計) */
  perMin: number;
  /** 到着者のうち女性の割合 */
  femaleRatio: number;
}

export interface SimParams {
  arrivals: ArrivalPhase[];
  /** 女性が個室を使う平均時間 (秒、出入りを含む) */
  femaleStallSec: number;
  /** 男性が小便器を使う平均時間 (秒) */
  urinalSec: number;
  /** 男性が個室を使う平均時間 (秒) */
  maleStallSec: number;
  /** 男性のうち個室が必要な人の割合 */
  maleStallNeed: number;
  /** 可変トイレの割り当てを見直す間隔 (秒) */
  flexIntervalSec: number;
  durationSec: number;
  seed: number;
}

export interface Person {
  id: number;
  gender: Gender;
  need: Need;
  /** この人が便器を使う時間 (秒) */
  useSec: number;
  tArrive: number;
  tStart: number;
  tDone: number;
}

export interface Fixture {
  kind: FixtureKind;
  /** 今どちらの性別用か (flex 以外は固定) */
  side: Gender;
  /** 使っている人の id (空いていれば 0) */
  user: number;
  /** 使い終わる時刻 */
  until: number;
}

export interface SeriesPoint {
  t: number;
  female: number;
  male: number;
}

export interface SimState {
  layout: Layout;
  params: SimParams;
  t: number;
  people: Person[];
  fixtures: Fixture[];
  queues: Record<Gender, number[]>;
  served: Record<Gender, number>;
  sumWait: Record<Gender, number>;
  maxQueue: Record<Gender, number>;
  maxWait: Record<Gender, number>;
  series: SeriesPoint[];
  nextId: number;
  rng: () => number;
  nextFlexCheck: number;
}

export interface GenderStats {
  arrived: number;
  /** 便器を使い始めた人 */
  served: number;
  queue: number;
  maxQueue: number;
  /** 平均待ち時間。まだ並んでいる人はここまで待った分を数える */
  avgWait: number;
  maxWait: number;
}

export interface SimStats {
  t: number;
  female: GenderStats;
  male: GenderStats;
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

export const DT = 0.5;

export function totalFixtures(l: Layout): number {
  return l.femaleStalls + l.maleStalls + l.urinals + l.flexStalls;
}

/** 女性用の便器数 ÷ 男性用 (大小合計)。可変トイレは含めない */
export function femaleMaleRatio(l: Layout): number {
  const m = l.maleStalls + l.urinals;
  return m > 0 ? l.femaleStalls / m : Infinity;
}

/**
 * 総数 total のうち女性用を female 個にしたときの配分。
 * 男性用は約 3 分の 1 を個室、残りを小便器にする (最低 1 個室)。
 */
export function splitLayout(name: string, total: number, female: number): Layout {
  const male = Math.max(0, total - female);
  const maleStalls = male === 0 ? 0 : Math.max(1, Math.round(male / 3));
  return { name, femaleStalls: female, maleStalls, urinals: male - maleStalls, flexStalls: 0 };
}

export function arrivalAt(phases: ArrivalPhase[], t: number): ArrivalPhase {
  let cur: ArrivalPhase = { from: 0, perMin: 0, femaleRatio: 0.5 };
  for (const p of phases) {
    if (t >= p.from) cur = p;
  }
  return cur;
}

export function createSim(params: SimParams, layout: Layout): SimState {
  const fixtures: Fixture[] = [];
  const add = (n: number, kind: FixtureKind, side: Gender) => {
    for (let i = 0; i < n; i++) fixtures.push({ kind, side, user: 0, until: 0 });
  };
  add(layout.femaleStalls, "stall", "f");
  add(layout.flexStalls, "flex", "f");
  add(layout.maleStalls, "stall", "m");
  add(layout.urinals, "urinal", "m");
  // 可変トイレは最初は男女半々に割り当てる
  const flex = fixtures.filter((f) => f.kind === "flex");
  flex.forEach((f, i) => (f.side = i < Math.ceil(flex.length / 2) ? "f" : "m"));
  return {
    layout,
    params,
    t: 0,
    people: [],
    fixtures,
    queues: { f: [], m: [] },
    served: { f: 0, m: 0 },
    sumWait: { f: 0, m: 0 },
    maxQueue: { f: 0, m: 0 },
    maxWait: { f: 0, m: 0 },
    series: [{ t: 0, female: 0, male: 0 }],
    nextId: 1,
    rng: mulberry32(params.seed),
    nextFlexCheck: params.flexIntervalSec,
  };
}

/** 平均 mean のガンマ分布 (形状 4): ばらつきはあるが極端に短い人は少ない */
function sampleUseTime(rng: () => number, mean: number): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += -Math.log(1 - rng());
  return (sum / 4) * mean;
}

function arrive(s: SimState, dt: number) {
  const ph = arrivalAt(s.params.arrivals, s.t);
  const expected = (ph.perMin / 60) * dt;
  // ポアソン到着を dt 刻みで近似
  let n = 0;
  let rest = expected;
  while (rest > 0) {
    if (s.rng() < Math.min(1, rest)) n++;
    rest -= 1;
  }
  const p = s.params;
  for (let i = 0; i < n; i++) {
    const gender: Gender = s.rng() < ph.femaleRatio ? "f" : "m";
    let need: Need = "stall";
    let useSec: number;
    if (gender === "f") {
      useSec = sampleUseTime(s.rng, p.femaleStallSec);
    } else if (s.rng() < p.maleStallNeed) {
      useSec = sampleUseTime(s.rng, p.maleStallSec);
    } else {
      need = "urinal";
      useSec = sampleUseTime(s.rng, p.urinalSec);
    }
    s.people.push({ id: s.nextId, gender, need, useSec, tArrive: s.t, tStart: -1, tDone: -1 });
    s.queues[gender].push(s.nextId);
    s.nextId++;
  }
}

function release(s: SimState) {
  for (const f of s.fixtures) {
    if (f.user !== 0 && f.until <= s.t) {
      s.people[f.user - 1].tDone = s.t;
      f.user = 0;
    }
  }
}

/**
 * 可変トイレ: 一定時間ごとに、行列の長いほう (待っている人数 × 平均利用時間) に割り当てる。
 * 使用中の個室は、今の人が出てから切り替わる (side を変えても使用中の人はそのまま)。
 */
function rebalanceFlex(s: SimState) {
  if (s.layout.flexStalls === 0 || s.t < s.nextFlexCheck) return;
  s.nextFlexCheck += s.params.flexIntervalSec;
  const p = s.params;
  const maleMean = p.maleStallNeed * p.maleStallSec + (1 - p.maleStallNeed) * p.urinalSec;
  const fixed = (side: Gender) =>
    s.fixtures.filter((f) => f.kind !== "flex" && f.side === side).length;
  // 待ち行列をさばくのにかかる時間 (秒) の目安を、可変トイレを 1 つずつ配りながら比べる
  const load = (side: Gender, extra: number) => {
    const work = s.queues[side].length * (side === "f" ? p.femaleStallSec : maleMean);
    return work / Math.max(1, fixed(side) + extra);
  };
  // 行列がどちらにもなければ割り当てを変えない
  if (s.queues.f.length === 0 && s.queues.m.length === 0) return;
  let toF = 0;
  let toM = 0;
  for (let i = 0; i < s.layout.flexStalls; i++) {
    if (load("f", toF) >= load("m", toM)) toF++;
    else toM++;
  }
  let i = 0;
  for (const f of s.fixtures) {
    if (f.kind !== "flex") continue;
    f.side = i < toF ? "f" : "m";
    i++;
  }
}

/** 空いている便器に行列の人を案内する。行列の前から順に、使える便器がある人を入れる */
function assign(s: SimState) {
  for (const g of ["f", "m"] as const) {
    const q = s.queues[g];
    for (let qi = 0; qi < q.length; ) {
      const person = s.people[q[qi] - 1];
      const fx = pickFixture(s, person);
      if (!fx) {
        qi++;
        // 先頭の数人だけ見る (行列の奥の人が割り込むことはない)
        if (qi >= 3) break;
        continue;
      }
      fx.user = person.id;
      fx.until = s.t + person.useSec;
      person.tStart = s.t;
      const wait = s.t - person.tArrive;
      s.sumWait[g] += wait;
      if (wait > s.maxWait[g]) s.maxWait[g] = wait;
      s.served[g]++;
      q.splice(qi, 1);
    }
  }
}

function pickFixture(s: SimState, person: Person): Fixture | undefined {
  const free = (kind: FixtureKind) =>
    s.fixtures.find((f) => f.user === 0 && f.side === person.gender && f.kind === kind);
  if (person.gender === "m" && person.need === "urinal") {
    // 小便器が埋まっていれば個室も使う
    return free("urinal") ?? free("stall") ?? free("flex");
  }
  return free("stall") ?? free("flex");
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s, dt);
  release(s);
  rebalanceFlex(s);
  assign(s);
  s.t = Math.round((s.t + dt) * 1000) / 1000;
  for (const g of ["f", "m"] as const) {
    if (s.queues[g].length > s.maxQueue[g]) s.maxQueue[g] = s.queues[g].length;
  }
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 5 - 1e-9) {
    s.series.push({ t: Math.round(s.t), female: s.queues.f.length, male: s.queues.m.length });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

function genderStats(s: SimState, g: Gender): GenderStats {
  let waitingSum = 0;
  let waitingMax = 0;
  for (const id of s.queues[g]) {
    const w = s.t - s.people[id - 1].tArrive;
    waitingSum += w;
    if (w > waitingMax) waitingMax = w;
  }
  const n = s.served[g] + s.queues[g].length;
  return {
    arrived: n,
    served: s.served[g],
    queue: s.queues[g].length,
    maxQueue: s.maxQueue[g],
    avgWait: n > 0 ? (s.sumWait[g] + waitingSum) / n : 0,
    maxWait: Math.max(s.maxWait[g], waitingMax),
  };
}

export function getStats(s: SimState): SimStats {
  return { t: s.t, female: genderStats(s, "f"), male: genderStats(s, "m") };
}

/** 同じシナリオを seed を変えて何回も回した平均 */
export interface AggregateStats {
  runs: number;
  female: GenderStats;
  male: GenderStats;
}

export function aggregate(params: SimParams, layout: Layout, runs: number): AggregateStats {
  const zero = (): GenderStats => ({ arrived: 0, served: 0, queue: 0, maxQueue: 0, avgWait: 0, maxWait: 0 });
  const acc: AggregateStats = { runs, female: zero(), male: zero() };
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, layout)));
    for (const g of ["female", "male"] as const) {
      for (const k of Object.keys(acc[g]) as (keyof GenderStats)[]) acc[g][k] += st[g][k] / runs;
    }
  }
  return acc;
}
