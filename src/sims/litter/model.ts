/**
 * 繁華街のポイ捨てシミュレーション: 純粋な計算モデル。
 *
 * 単位は「秒」と「メートル」。長さ 400 m の通りを、ごみ (飲み終えたカップや缶) を
 * 1 つ持つことになる人だけが歩く。人は「見回り」「ごみ箱」「清掃」の違う世界を、
 * 同じ顔ぶれ・同じ気分のまま歩くので、違いは対策だけから生まれる。
 * 描画や React に依存しない。
 */

export type PolicyId = "none" | "patrol" | "bins" | "smart" | "clean";

export interface Policy {
  id: PolicyId;
  /** 画面に出す名前 */
  name: string;
  /** 通りを歩いて見回る人の数 (過料を取る) */
  patrollers: number;
  /** ごみ箱の数 (通りに等間隔に置く) */
  bins: number;
  /** ごみ箱 1 つに入る個数 */
  binCapacity: number;
  /** 決まった間隔で回収する (秒)。0 なら定期回収なし */
  emptyEverySec: number;
  /** 満杯に近づくと通知が飛び、この時間 (秒) で回収に来る。0 なら通知なし */
  notifyDelaySec: number;
  /** 通り全体を掃除する間隔 (秒)。0 なら営業時間中は掃除しない */
  cleanEverySec: number;
}

export interface ArrivalPhase {
  /** このフェーズが始まる時刻 (秒) */
  from: number;
  /** 1 時間あたりに、この通りでごみを 1 つ出す人の数 */
  perHour: number;
}

export interface SimParams {
  arrivals: ArrivalPhase[];
  /** 画面に出す開始時刻 (時) */
  startHour: number;
  durationSec: number;
  /** きれいな道で、ごみを持って 1 m 歩くあいだに捨ててしまう確率 (ハザード) */
  baseHazardPerM: number;
  /** まわりにごみが散らかっていると、捨てやすさが最大で何倍になるか */
  litterMultiplier: number;
  /** 周囲 ±10 m にこの個数のごみがあると、捨てやすさが最大になる */
  litterSaturation: number;
  /** 過料の制度と見回りがあることが知られているときの捨てやすさ (倍) */
  patrolAwareness: number;
  /** 見回りの人の近く (±25 m) での捨てやすさ (倍) */
  patrolNearFactor: number;
  /** ごみ箱が満杯のとき、横や上に置いていく人の割合 */
  overflowShare: number;
  /** 家庭ごみなど、通りの外から 1 時間にごみ箱 1 つへ持ち込まれる個数 */
  dumpPerBinHour: number;
  seed: number;
}

export const STREET_M = 400;
export const CELL_M = 5;
export const CELLS = STREET_M / CELL_M;
export const NEAR_PATROL_M = 25;
/** ごみ箱にこの距離まで近づいたら入れる */
export const BIN_REACH_M = 6;
export const DT = 2;

export interface Walker {
  id: number;
  /** 通りに入る時刻 (秒) */
  t0: number;
  /** +1 なら 0 m から 400 m へ、-1 なら逆向き */
  dir: 1 | -1;
  x: number;
  speed: number;
  /** 通りに入ってから飲み終える (ごみになる) までの距離 */
  finishAt: number;
  /** 通りを出る (横道や駅に入る) までの距離 */
  leaveAt: number;
  walked: number;
  /** 0: 飲食中、1: ごみを持っている、2: 済み (どこかへ捨てた・持ち帰った) */
  phase: 0 | 1 | 2;
  /** これまでに積み上がった「捨てたい気持ち」 */
  urge: number;
  /** urge がこれを超えたら捨てる (人ごとに違う、指数分布) */
  tolerance: number;
  /** ごみ箱が満杯だったときに横へ置くかどうかを決める乱数 */
  overflowDraw: number;
}

export interface Bin {
  x: number;
  fill: number;
  /** 回収に来る予定の時刻 (通知を受けたとき)。なければ -1 */
  pickupAt: number;
}

export interface Patroller {
  x: number;
  dir: 1 | -1;
}

export interface SeriesPoint {
  t: number;
  /** 道に落ちているごみの数 */
  street: number;
  /** ここまでのポイ捨ての累計 */
  littered: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  /** 出てくる予定の人 (時刻順)。世界をまたいで同じ顔ぶれにするため、最初に全員作る */
  queue: Walker[];
  nextIdx: number;
  walkers: Walker[];
  /** 5 m ごとの区画に落ちているごみの数 */
  litter: number[];
  bins: Bin[];
  patrollers: Patroller[];
  /** ごみを出した人 */
  produced: number;
  /** 歩いている途中で道に捨てた */
  dropped: number;
  /** 満杯のごみ箱の横や上に置いた */
  overflowed: number;
  /** 持ち込みのごみが満杯のごみ箱からあふれた */
  dumpOverflow: number;
  binned: number;
  carriedOut: number;
  fined: number;
  /** ごみ箱の回収回数 */
  pickups: number;
  /** 清掃で拾ったごみ */
  swept: number;
  sweeps: number;
  maxStreet: number;
  series: SeriesPoint[];
  nextSweep: number;
  dumpAcc: number;
  dumpRng: () => number;
}

export interface SimStats {
  t: number;
  produced: number;
  /** 道に捨てられたごみ (歩きながら + ごみ箱の横に置いた + 持ち込みのあふれ) */
  littered: number;
  /** ごみを出した人のうち、道に捨てた人の割合 */
  litterRate: number;
  overflowed: number;
  binned: number;
  carriedOut: number;
  fined: number;
  street: number;
  maxStreet: number;
  pickups: number;
  swept: number;
  /** 見回り・回収・清掃にかかった手間 (人・時間) */
  laborHours: number;
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

/** ごみ箱 1 回の回収、通り 1 回の清掃にかかる手間 (人・時間) */
export const PICKUP_HOURS = 0.1;
export const SWEEP_HOURS = 1.5;

export function arrivalAt(phases: ArrivalPhase[], t: number): ArrivalPhase {
  let cur: ArrivalPhase = { from: 0, perHour: 0 };
  for (const p of phases) {
    if (t >= p.from) cur = p;
  }
  return cur;
}

/** 歩く人を全員、最初に作っておく。対策にかかわらず同じ顔ぶれになる */
function generateWalkers(params: SimParams): Walker[] {
  const rng = mulberry32(params.seed);
  const out: Walker[] = [];
  let id = 1;
  for (let t = 0; t < params.durationSec; t += DT) {
    const expected = (arrivalAt(params.arrivals, t).perHour / 3600) * DT;
    let rest = expected;
    while (rest > 0) {
      if (rng() < Math.min(1, rest)) {
        const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
        const leaveAt = 120 + rng() * (STREET_M - 120);
        out.push({
          id: id++,
          t0: t,
          dir,
          x: dir === 1 ? 0 : STREET_M,
          speed: 0.9 + rng() * 0.6,
          finishAt: rng() * leaveAt * 0.6,
          leaveAt,
          walked: 0,
          phase: 0,
          urge: 0,
          tolerance: -Math.log(1 - rng()),
          overflowDraw: rng(),
        });
      }
      rest -= 1;
    }
  }
  return out;
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const bins: Bin[] = Array.from({ length: policy.bins }, (_, i) => ({
    x: ((i + 0.5) * STREET_M) / policy.bins,
    fill: 0,
    pickupAt: -1,
  }));
  const patrollers: Patroller[] = Array.from({ length: policy.patrollers }, (_, i) => ({
    x: ((i + 0.5) * STREET_M) / policy.patrollers,
    dir: i % 2 === 0 ? 1 : -1,
  }));
  return {
    policy,
    params,
    t: 0,
    queue: generateWalkers(params),
    nextIdx: 0,
    walkers: [],
    litter: new Array(CELLS).fill(0),
    bins,
    patrollers,
    produced: 0,
    dropped: 0,
    overflowed: 0,
    dumpOverflow: 0,
    binned: 0,
    carriedOut: 0,
    fined: 0,
    pickups: 0,
    swept: 0,
    sweeps: 0,
    maxStreet: 0,
    series: [{ t: 0, street: 0, littered: 0 }],
    nextSweep: policy.cleanEverySec > 0 ? policy.cleanEverySec : Infinity,
    dumpAcc: 0,
    // 持ち込みごみは歩く人とは別の乱数にする (世界ごとにごみ箱の数が違っても、歩く人は同じ)
    dumpRng: mulberry32(params.seed ^ 0x5bd1e995),
  };
}

function cellOf(x: number): number {
  return Math.max(0, Math.min(CELLS - 1, Math.floor(x / CELL_M)));
}

/** 周囲 ±10 m に落ちているごみの数 */
export function litterNear(s: SimState, x: number): number {
  const c = cellOf(x);
  let n = 0;
  for (let i = Math.max(0, c - 2); i <= Math.min(CELLS - 1, c + 2); i++) n += s.litter[i];
  return n;
}

export function streetLitter(s: SimState): number {
  let n = 0;
  for (const v of s.litter) n += v;
  return n;
}

function nearPatrol(s: SimState, x: number): boolean {
  for (const p of s.patrollers) if (Math.abs(p.x - x) <= NEAR_PATROL_M) return true;
  return false;
}

/** その場所で、ごみを持って 1 m 歩くあいだに捨ててしまうハザード */
export function hazardAt(s: SimState, x: number): number {
  const p = s.params;
  const l = Math.min(1, litterNear(s, x) / p.litterSaturation);
  let h = p.baseHazardPerM * (1 + (p.litterMultiplier - 1) * l);
  if (s.policy.patrollers > 0) {
    h *= p.patrolAwareness;
    if (nearPatrol(s, x)) h *= p.patrolNearFactor;
  }
  return h;
}

function dropLitter(s: SimState, x: number) {
  s.litter[cellOf(x)]++;
}

function moveWalker(s: SimState, w: Walker, dt: number) {
  const d = w.speed * dt;
  w.x += w.dir * d;
  w.walked += d;
  if (w.phase === 0 && w.walked >= w.finishAt) {
    w.phase = 1;
    s.produced++;
  }
  if (w.phase === 1 && w.walked < w.leaveAt) {
    // 近くにごみ箱があれば入れる
    for (const b of s.bins) {
      if (Math.abs(b.x - w.x) > BIN_REACH_M) continue;
      if (b.fill < s.policy.binCapacity) {
        b.fill++;
        s.binned++;
        w.phase = 2;
        return;
      }
      if (w.overflowDraw < s.params.overflowShare) {
        // 満杯でも、横に置けば捨てたことにしてしまう
        dropLitter(s, b.x);
        s.overflowed++;
        w.phase = 2;
        return;
      }
    }
    w.urge += hazardAt(s, w.x) * d;
    if (w.urge >= w.tolerance) {
      dropLitter(s, w.x);
      s.dropped++;
      if (nearPatrol(s, w.x)) s.fined++;
      w.phase = 2;
      return;
    }
  }
  if (w.walked >= w.leaveAt && w.phase === 1) {
    // ごみを持ったまま横道や駅に入った (持ち帰ったか、よそで捨てた)
    s.carriedOut++;
    w.phase = 2;
  }
}

function servicePolicies(s: SimState, dt: number) {
  const pol = s.policy;
  const p = s.params;
  // 見回り: 端で折り返しながら歩く
  for (const pt of s.patrollers) {
    pt.x += pt.dir * 1.0 * dt;
    if (pt.x > STREET_M) {
      pt.x = STREET_M - (pt.x - STREET_M);
      pt.dir = -1;
    } else if (pt.x < 0) {
      pt.x = -pt.x;
      pt.dir = 1;
    }
  }
  // 家庭ごみなどの持ち込み
  if (s.bins.length > 0 && p.dumpPerBinHour > 0) {
    s.dumpAcc += (p.dumpPerBinHour / 3600) * dt * s.bins.length;
    while (s.dumpAcc >= 1) {
      s.dumpAcc -= 1;
      const b = s.bins[Math.floor(s.dumpRng() * s.bins.length)];
      if (b.fill < pol.binCapacity) b.fill++;
      else {
        dropLitter(s, b.x);
        s.dumpOverflow++;
      }
    }
  }
  // ごみ箱の回収
  const t = s.t;
  const regular = pol.emptyEverySec > 0 && Math.floor((t + dt) / pol.emptyEverySec) > Math.floor(t / pol.emptyEverySec);
  for (const b of s.bins) {
    if (pol.notifyDelaySec > 0 && b.pickupAt < 0 && b.fill >= pol.binCapacity * 0.8) {
      b.pickupAt = t + pol.notifyDelaySec;
    }
    const due = regular || (b.pickupAt >= 0 && t >= b.pickupAt);
    if (due) {
      b.fill = 0;
      b.pickupAt = -1;
      // 回収の人は、ごみ箱の横に置かれたごみも拾っていく
      const c = cellOf(b.x);
      s.swept += s.litter[c];
      s.litter[c] = 0;
      s.pickups++;
    }
  }
  // 通りの清掃
  if (t >= s.nextSweep) {
    s.nextSweep += pol.cleanEverySec;
    s.swept += streetLitter(s);
    s.litter.fill(0);
    s.sweeps++;
  }
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  // 到着
  while (s.nextIdx < s.queue.length && s.queue[s.nextIdx].t0 <= s.t) {
    s.walkers.push({ ...s.queue[s.nextIdx] });
    s.nextIdx++;
  }
  for (const w of s.walkers) moveWalker(s, w, dt);
  // 捨て終わった人も、通りを出るまでは歩き続ける (描画用)
  s.walkers = s.walkers.filter((w) => w.walked < w.leaveAt);
  servicePolicies(s, dt);
  s.t = s.t + dt;
  const street = streetLitter(s);
  if (street > s.maxStreet) s.maxStreet = street;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 120) {
    s.series.push({ t: s.t, street, littered: totalLittered(s) });
  }
}

function totalLittered(s: SimState): number {
  return s.dropped + s.overflowed + s.dumpOverflow;
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export function laborHours(s: SimState): number {
  const hours = s.t / 3600;
  return s.policy.patrollers * hours + s.pickups * PICKUP_HOURS + s.sweeps * SWEEP_HOURS;
}

export function getStats(s: SimState): SimStats {
  const people = s.dropped + s.overflowed;
  return {
    t: s.t,
    produced: s.produced,
    littered: totalLittered(s),
    litterRate: s.produced > 0 ? people / s.produced : 0,
    overflowed: s.overflowed + s.dumpOverflow,
    binned: s.binned,
    carriedOut: s.carriedOut,
    fined: s.fined,
    street: streetLitter(s),
    maxStreet: s.maxStreet,
    pickups: s.pickups,
    swept: s.swept,
    laborHours: laborHours(s),
  };
}

/** i 回目の試行 (seed をずらして 1 日分を回す) */
export function runTrial(params: SimParams, policy: Policy, i: number): SimStats {
  return getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
}

/** 試行結果の平均 */
export function averageStats(list: SimStats[]): SimStats {
  const acc = { ...list[0] };
  for (const k of Object.keys(acc) as (keyof SimStats)[]) {
    acc[k] = list.reduce((sum, st) => sum + st[k], 0) / list.length;
  }
  return acc;
}

/** 同じシナリオを seed を変えて何回も回した平均 */
export function aggregate(params: SimParams, policy: Policy, runs: number): SimStats {
  return averageStats(Array.from({ length: runs }, (_, i) => runTrial(params, policy, i)));
}
