/**
 * 時差出勤シミュレーション: 純粋な計算モデル。
 *
 * 市の中心部へ入る幹線道路の 1 か所のボトルネック (交差点) を「1 分に何台通せるか」だけで表し、
 * そこに朝の車が集まってくる様子を秒単位で動かす。待ち行列は道の上に並ぶ「点の行列」として扱う。
 *
 * 時刻はすべて「6:30 からの経過秒」。描画や React に依存しない。
 */

/** シミュレーションの開始時刻 (時計の分。6:30) */
export const START_MIN = 6 * 60 + 30;
/** 朝のピーク (時計の分)。鹿児島市の社会実験が避けてほしいとしている 7:30〜8:30 */
export const PEAK_FROM_MIN = 7 * 60 + 30;
export const PEAK_TO_MIN = 8 * 60 + 30;
/** 早めにずらす人が交差点を通る時間帯 (7:30 までに職場に着く) */
export const EARLY_FROM_MIN = 6 * 60 + 45;
export const EARLY_TO_MIN = 7 * 60 + 20;
/** 遅めにずらす人が交差点を通る時間帯 (8:30 以降に家を出る) */
export const LATE_FROM_MIN = 8 * 60 + 45;
export const LATE_TO_MIN = 9 * 60 + 15;
/** 1 台が行列で占める長さ (m) と車線数。行列の長さ (km) の換算に使う */
export const CAR_SPACING_M = 7;
export const LANES = 2;
/** 1 ステップの長さ (秒) */
export const DT = 1;
/** グラフ用の記録間隔 (秒) */
export const SERIES_EVERY = 30;

export interface Incident {
  /** 始まる時刻 (時計の分) */
  fromMin: number;
  toMin: number;
  /** その間の通せる台数の倍率 (0.5 なら半分) */
  factor: number;
}

export interface SimParams {
  /** 交差点が 1 分に通せる台数 */
  capacityPerMin: number;
  /** 日によって通せる台数がぶれる幅 (標準偏差、割合) */
  capacityNoise: number;
  /** 6:30〜10:00 に交差点へ来る車の台数 (平均) */
  totalCars: number;
  /** いちばん車が集まる時刻 (時計の分) */
  peakCenterMin: number;
  /** 集まり方の広がり (標準偏差、分) */
  peakSdMin: number;
  /** ピークと関係なく一様に来る車の割合 */
  floorShare: number;
  /** 事故や工事で一時的に通せる台数が落ちる時間帯 */
  incident: Incident | null;
  /** ずらす人のうち「早めに出る」を選ぶ割合 (残りは遅めに出る) */
  earlyShare: number;
  /** 空いた分を埋めに戻ってくる車: ずらした台数に対する割合 */
  rebound: number;
  /** シミュレーションを回す長さ (秒) */
  durationSec: number;
  seed: number;
}

export interface Policy {
  name: string;
  /** 7:30〜8:30 に通るつもりだった車のうち、時間をずらす割合 */
  participation: number;
}

export type CarKind = "normal" | "early" | "late" | "rebound";

export interface Car {
  id: number;
  kind: CarKind;
  /** もともと交差点を通りたかった時刻 (秒) */
  tWant: number;
  /** 行列の最後尾に着く時刻 (秒) */
  tArrive: number;
  /** 交差点を通り抜けた時刻 (秒、まだなら -1) */
  tPass: number;
}

export interface SeriesPoint {
  t: number;
  /** 行列の台数 */
  queue: number;
  /** いま最後尾に着いたら何分待つか */
  waitMin: number;
}

export interface SimState {
  params: SimParams;
  policy: Policy;
  t: number;
  /** 着く順に並べた全部の車 */
  cars: Car[];
  /** 次に行列へ加わる車の添字 */
  nextArrival: number;
  /** 行列の先頭の添字 (cars の中で、まだ通っていない最初の車) */
  head: number;
  /** その日の「1 分に通せる台数」 */
  capacityToday: number;
  /** 通せる台数の端数のたまり */
  credit: number;
  maxQueue: number;
  /** 行列で待った秒数の合計 (いま並んでいる車の分も含む) */
  waitSecTotal: number;
  /** 行列が 1 分待ち以上だった最後の時刻 (秒) */
  lastJamT: number;
  series: SeriesPoint[];
}

export interface SimStats {
  t: number;
  arrived: number;
  passed: number;
  queue: number;
  queueKm: number;
  /** いま最後尾に着いたら何分待つか */
  waitNowMin: number;
  maxQueue: number;
  maxQueueKm: number;
  /** 通り抜けた車の平均の待ち (分) */
  avgWaitMin: number;
  /** いちばん長く待った車 (分) */
  maxWaitMin: number;
  /** 10 分以上待った車の割合 */
  over10Share: number;
  /** 待ちの合計 (台・時間) */
  waitHours: number;
  /** 7:30〜8:30 に行列の最後尾に着いた台数 (= その時間帯に来た車) */
  peakArrived: number;
  /** 7:30〜8:30 に交差点を通り抜けた台数 (= 交通量の調査で数える台数) */
  peakPassed: number;
  /** 時間をずらした台数 */
  shifted: number;
  /** ずらした人 1 人あたり、もとの時刻から動かした時間 (分) */
  avgShiftMin: number;
  /** 空いた分を埋めに来た台数 */
  reboundCars: number;
  /** 1 分待ち以上の行列が最後に消えた時刻 (時計の分、渋滞がなければ -1) */
  jamEndMin: number;
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

function normal(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** 時計の分 → 6:30 からの経過秒 */
export function clockToT(min: number): number {
  return (min - START_MIN) * 60;
}

/** 6:30 からの経過秒 → 時計の分 */
export function tToClock(t: number): number {
  return START_MIN + t / 60;
}

export function queueKm(queue: number): number {
  return (queue * CAR_SPACING_M) / LANES / 1000;
}

/** 来る時刻 (時計の分) を 1 台分引く。6:30〜10:00 の外に出たら引き直す */
function sampleWantMin(p: SimParams, rng: () => number): number {
  const lo = START_MIN;
  const hi = START_MIN + 210;
  for (;;) {
    const m = rng() < p.floorShare ? lo + rng() * (hi - lo) : p.peakCenterMin + p.peakSdMin * normal(rng);
    if (m >= lo && m < hi) return m;
  }
}

function inPeak(min: number): boolean {
  return min >= PEAK_FROM_MIN && min < PEAK_TO_MIN;
}

/**
 * その日の車を全部作る。
 * どちらの世界でも同じ seed なら同じ車・同じ「ずらすかどうかのくじ」になるので、
 * 参加率だけが違う 2 つの世界を公平に比べられる (参加 1% の人は参加 10% の世界でもずらす)。
 */
export function createSim(params: SimParams, policy: Policy): SimState {
  const rng = mulberry32(params.seed);
  const capacityToday = params.capacityPerMin * Math.max(0.5, 1 + params.capacityNoise * normal(rng));
  const n = Math.max(0, Math.round(params.totalCars * (1 + 0.03 * normal(rng))));

  const cars: Car[] = [];
  let shifted = 0;
  for (let i = 0; i < n; i++) {
    const want = sampleWantMin(params, rng);
    // くじは全員が同じ順番で引く (参加率に関係なく乱数の消費を一定にする)
    const lot = rng();
    const side = rng();
    const pos = rng();
    let kind: CarKind = "normal";
    let arrive = want;
    if (inPeak(want) && lot < policy.participation) {
      if (side < params.earlyShare) {
        kind = "early";
        arrive = EARLY_FROM_MIN + pos * (EARLY_TO_MIN - EARLY_FROM_MIN);
      } else {
        kind = "late";
        arrive = LATE_FROM_MIN + pos * (LATE_TO_MIN - LATE_FROM_MIN);
      }
      shifted++;
    }
    cars.push({ id: i + 1, kind, tWant: clockToT(want), tArrive: clockToT(arrive), tPass: -1 });
  }

  // 空いた分を埋めに戻ってくる車 (ふだんはバスや早出をしていた人)。ピークの中に来る。
  const reboundRng = mulberry32(params.seed ^ 0x5bd1e995);
  const extra = Math.round(shifted * params.rebound);
  for (let i = 0; i < extra; i++) {
    let m = 0;
    do m = sampleWantMin(params, reboundRng);
    while (!inPeak(m));
    const t = clockToT(m);
    cars.push({ id: n + i + 1, kind: "rebound", tWant: t, tArrive: t, tPass: -1 });
  }

  cars.sort((a, b) => a.tArrive - b.tArrive || a.id - b.id);

  return {
    params,
    policy,
    t: 0,
    cars,
    nextArrival: 0,
    head: 0,
    capacityToday,
    credit: 0,
    maxQueue: 0,
    waitSecTotal: 0,
    lastJamT: -1,
    series: [{ t: 0, queue: 0, waitMin: 0 }],
  };
}

/** 時刻 t に交差点が 1 分に通せる台数 */
export function capacityAt(s: SimState, t: number): number {
  const inc = s.params.incident;
  if (inc) {
    const m = tToClock(t);
    if (m >= inc.fromMin && m < inc.toMin) return s.capacityToday * inc.factor;
  }
  return s.capacityToday;
}

export function queueLength(s: SimState): number {
  return s.nextArrival - s.head;
}

/** いま最後尾に着いたら何分待つか (いまの通せる台数で行列がはけるまで) */
export function waitNowMin(s: SimState): number {
  const q = queueLength(s);
  if (q === 0) return 0;
  return q / Math.max(1e-6, capacityAt(s, s.t));
}

export function step(s: SimState, dt: number = DT) {
  if (isFinished(s)) return;
  const t1 = s.t + dt;
  // 行列に加わる
  while (s.nextArrival < s.cars.length && s.cars[s.nextArrival].tArrive < t1) s.nextArrival++;
  // 通せる分だけ前から通す
  const q0 = queueLength(s);
  if (q0 === 0) {
    s.credit = 0;
  } else {
    s.credit += (capacityAt(s, s.t) / 60) * dt;
    while (s.credit >= 1 && s.head < s.nextArrival) {
      s.cars[s.head].tPass = t1;
      s.head++;
      s.credit -= 1;
    }
    if (s.head === s.nextArrival) s.credit = Math.min(s.credit, 1);
  }
  const q = queueLength(s);
  s.waitSecTotal += q * dt;
  if (q > s.maxQueue) s.maxQueue = q;
  s.t = t1;
  if (waitNowMin(s) >= 1) s.lastJamT = t1;
  if (Math.floor(t1 / SERIES_EVERY) !== Math.floor((t1 - dt) / SERIES_EVERY)) {
    s.series.push({ t: t1, queue: q, waitMin: Math.round(waitNowMin(s) * 10) / 10 });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export function getStats(s: SimState): SimStats {
  const peakFrom = clockToT(PEAK_FROM_MIN);
  const peakTo = clockToT(PEAK_TO_MIN);
  let passed = 0;
  let waitSum = 0;
  let maxWait = 0;
  let over10 = 0;
  let peakArrived = 0;
  let peakPassed = 0;
  let shifted = 0;
  let shiftSum = 0;
  let reboundCars = 0;
  for (let i = 0; i < s.nextArrival; i++) {
    const c = s.cars[i];
    if (c.tArrive >= peakFrom && c.tArrive < peakTo) peakArrived++;
    if (c.tPass >= 0) {
      passed++;
      const w = c.tPass - c.tArrive;
      waitSum += w;
      if (w > maxWait) maxWait = w;
      if (w >= 600) over10++;
      if (c.tPass >= peakFrom && c.tPass < peakTo) peakPassed++;
    } else {
      // まだ並んでいる車も、ここまで待った分で最長を更新する
      maxWait = Math.max(maxWait, s.t - c.tArrive);
    }
  }
  // ずらした人は、まだ来ていなくても数える (朝の計画として決まっている)
  for (const c of s.cars) {
    if (c.kind === "early" || c.kind === "late") {
      shifted++;
      shiftSum += Math.abs(c.tArrive - c.tWant);
    } else if (c.kind === "rebound") {
      reboundCars++;
    }
  }
  const q = queueLength(s);
  return {
    t: s.t,
    arrived: s.nextArrival,
    passed,
    queue: q,
    queueKm: queueKm(q),
    waitNowMin: waitNowMin(s),
    maxQueue: s.maxQueue,
    maxQueueKm: queueKm(s.maxQueue),
    avgWaitMin: passed > 0 ? waitSum / passed / 60 : 0,
    maxWaitMin: maxWait / 60,
    over10Share: passed > 0 ? over10 / passed : 0,
    waitHours: s.waitSecTotal / 3600,
    peakArrived,
    peakPassed,
    shifted,
    avgShiftMin: shifted > 0 ? shiftSum / shifted / 60 : 0,
    reboundCars,
    jamEndMin: s.lastJamT >= 0 ? tToClock(s.lastJamT) : -1,
  };
}

export type AggregateStats = Omit<SimStats, "t" | "queue" | "queueKm" | "waitNowMin"> & {
  /** 渋滞 (1 分待ち以上) が起きた日の割合 */
  jamDayShare: number;
};

/** 乱数を変えて runs 回まわした平均 */
export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc = {
    arrived: 0,
    passed: 0,
    maxQueue: 0,
    maxQueueKm: 0,
    avgWaitMin: 0,
    maxWaitMin: 0,
    over10Share: 0,
    waitHours: 0,
    peakArrived: 0,
    peakPassed: 0,
    shifted: 0,
    avgShiftMin: 0,
    reboundCars: 0,
    jamEndMin: 0,
  };
  let jamDays = 0;
  for (let r = 0; r < runs; r++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + r * 7919 }, policy)));
    acc.arrived += st.arrived;
    acc.passed += st.passed;
    acc.maxQueue += st.maxQueue;
    acc.maxQueueKm += st.maxQueueKm;
    acc.avgWaitMin += st.avgWaitMin;
    acc.maxWaitMin += st.maxWaitMin;
    acc.over10Share += st.over10Share;
    acc.waitHours += st.waitHours;
    acc.peakArrived += st.peakArrived;
    acc.peakPassed += st.peakPassed;
    acc.shifted += st.shifted;
    acc.avgShiftMin += st.avgShiftMin;
    acc.reboundCars += st.reboundCars;
    if (st.jamEndMin >= 0) {
      jamDays++;
      acc.jamEndMin += st.jamEndMin;
    }
  }
  const out = {} as Record<keyof typeof acc, number>;
  for (const k of Object.keys(acc) as (keyof typeof acc)[]) out[k] = acc[k] / runs;
  out.jamEndMin = jamDays > 0 ? acc.jamEndMin / jamDays : -1;
  return { ...out, jamDayShare: jamDays / runs };
}

/** 時計の分 → "7:42" */
export function fmtClockMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
