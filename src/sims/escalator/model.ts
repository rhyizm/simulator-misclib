/**
 * エスカレーターの乗り方シミュレーション: 純粋な計算モデル。
 *
 * 単位は「段 (step)」と「秒」。描画や React に依存しないので、
 * ブラウザでも Node のテストでも同じコードが動く。
 */

export type Policy = "walkLane" | "standBoth";
export type Pref = "stand" | "walk";
export type PersonState = "queue" | "riding" | "done";

/** 0 = 立つ側のレーン, 1 = 歩く側のレーン (standBoth では両方とも立つ側) */
export type Lane = 0 | 1;

export interface Person {
  id: number;
  pref: Pref;
  /** 本当は立ちたいが行列が長いので歩く側に回った人 */
  reluctant: boolean;
  /** 歩く側のレーンに立ち止まってしまう人 (walkLane のみ) */
  blocker: boolean;
  lane: Lane;
  /** 乗り口からの位置 (段)。0 = 乗り口, lengthSteps = 降り口 */
  pos: number;
  state: PersonState;
  /** 立つ人が前の人との間に空ける間隔 (段) */
  gap: number;
  /** ベルトに対する相対速度 (段/秒) */
  relSpeed: number;
  tArrive: number;
  tBoard: number;
  tExit: number;
}

export interface ArrivalPhase {
  /** このフェーズが始まる時刻 (秒) */
  from: number;
  /** 1 分あたりの到着人数 */
  perMin: number;
}

export interface SimParams {
  lengthSteps: number;
  /** ベルトの速度 (段/秒) */
  beltSpeed: number;
  /** 歩く人のベルトに対する相対速度 (段/秒) */
  walkSpeed: number;
  reluctantWalkSpeed: number;
  /** 立つ人が空ける間隔の範囲 (段) */
  standGapMin: number;
  standGapMax: number;
  /** 歩く人が前の人との間に必要とする距離 (段) */
  walkGap: number;
  /** 到着者のうち「歩きたい」人の割合 */
  walkerRatio: number;
  arrivals: ArrivalPhase[];
  /** 立つ側の行列がこの人数を超えると、立ちたい人の一部が歩く側へ回る */
  switchQueueThreshold: number;
  switchProb: number;
  /** 立ちたい人のうち、歩く側のレーンに立ってしまう人の割合 (walkLane のみ) */
  standOnWalkLaneRatio: number;
  durationSec: number;
  seed: number;
}

export interface SeriesPoint {
  t: number;
  queue: number;
  exited: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  people: Person[];
  /** レーンごとの待ち行列 (person id) */
  queues: [number[], number[]];
  /** レーン上の人 (person id)。pos の降順には並んでいない */
  riders: [number[], number[]];
  exited: number;
  exitedWalkers: number;
  sumTrip: number;
  sumTripWalkers: number;
  sumWait: number;
  maxQueue: number;
  /** 描画用: ベルトの累積移動量 (段) */
  beltOffset: number;
  series: SeriesPoint[];
  nextId: number;
  rng: () => number;
  /** 両側立ちのとき次に乗るレーン (左右交互) */
  nextBoardLane: Lane;
}

export interface SimStats {
  t: number;
  exited: number;
  queue: number;
  maxQueue: number;
  avgTrip: number;
  avgTripWalkers: number;
  avgWait: number;
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

export const DT = 0.1;

export function arrivalRatePerSec(phases: ArrivalPhase[], t: number): number {
  let rate = 0;
  for (const p of phases) {
    if (t >= p.from) rate = p.perMin / 60;
  }
  return rate;
}

export function createSim(params: SimParams, policy: Policy): SimState {
  return {
    policy,
    params,
    t: 0,
    people: [],
    queues: [[], []],
    riders: [[], []],
    exited: 0,
    exitedWalkers: 0,
    sumTrip: 0,
    sumTripWalkers: 0,
    sumWait: 0,
    maxQueue: 0,
    beltOffset: 0,
    series: [{ t: 0, queue: 0, exited: 0 }],
    nextId: 1,
    rng: mulberry32(params.seed),
    nextBoardLane: 0,
  };
}

function newPerson(s: SimState, pref: Pref): Person {
  const p = s.params;
  const gap = p.standGapMin + s.rng() * (p.standGapMax - p.standGapMin);
  const person: Person = {
    id: s.nextId++,
    pref,
    reluctant: false,
    blocker: false,
    lane: 0,
    pos: 0,
    state: "queue",
    gap,
    relSpeed: 0,
    tArrive: s.t,
    tBoard: -1,
    tExit: -1,
  };
  s.people.push(person);
  return person;
}

/** 到着した人を行列に並べる */
function enqueue(s: SimState, person: Person) {
  const p = s.params;
  let lane: Lane = 0;
  if (s.policy === "walkLane") {
    if (person.pref === "walk") {
      lane = 1;
      person.relSpeed = p.walkSpeed;
    } else if (s.rng() < p.standOnWalkLaneRatio) {
      // 歩く側だと知らずに (あるいは気にせず) 立ってしまう
      lane = 1;
      person.blocker = true;
    } else if (
      s.queues[0].length > p.switchQueueThreshold &&
      s.rng() < p.switchProb
    ) {
      // 行列が長いので仕方なく歩く
      lane = 1;
      person.reluctant = true;
      person.relSpeed = p.reluctantWalkSpeed;
    }
  }
  person.lane = lane;
  s.queues[lane].push(person.id);
}

function queueLength(s: SimState): number {
  return s.queues[0].length + s.queues[1].length;
}

function lowestPos(s: SimState, lane: Lane): number {
  let min = Infinity;
  for (const id of s.riders[lane]) {
    const r = s.people[id - 1];
    if (r.pos < min) min = r.pos;
  }
  return min;
}

function board(s: SimState, lane: Lane, id: number) {
  const person = s.people[id - 1];
  person.state = "riding";
  person.lane = lane;
  person.pos = 0;
  person.tBoard = s.t;
  s.sumWait += s.t - person.tArrive;
  s.riders[lane].push(id);
}

/** レーン上でこの人が前の人との間に要求する距離 */
function requiredGap(s: SimState, lane: Lane, person: Person): number {
  if (s.policy === "walkLane" && lane === 1 && person.relSpeed > 0) return s.params.walkGap;
  return person.gap;
}

function tryBoard(s: SimState) {
  if (s.policy === "walkLane") {
    for (const lane of [0, 1] as const) {
      const q = s.queues[lane];
      if (q.length === 0) continue;
      const person = s.people[q[0] - 1];
      if (lowestPos(s, lane) >= requiredGap(s, lane, person)) {
        q.shift();
        board(s, lane, person.id);
      }
    }
  } else {
    // 両側に立つ: 空いているレーンから順に乗る (左右交互)
    const q = s.queues[0];
    for (let i = 0; i < 2 && q.length > 0; i++) {
      const lane = s.nextBoardLane;
      const person = s.people[q[0] - 1];
      if (lowestPos(s, lane) >= person.gap) {
        q.shift();
        board(s, lane, person.id);
      }
      s.nextBoardLane = lane === 0 ? 1 : 0;
    }
  }
}

function moveRiders(s: SimState, dt: number) {
  const p = s.params;
  const belt = p.beltSpeed;
  for (const lane of [0, 1] as const) {
    const ids = s.riders[lane];
    if (ids.length === 0) continue;
    // 前にいる人から順に動かす
    ids.sort((a, b) => s.people[b - 1].pos - s.people[a - 1].pos);
    let leaderPos = Infinity;
    for (const id of ids) {
      const r = s.people[id - 1];
      const v = belt + r.relSpeed;
      let next = r.pos + v * dt;
      // 前の人に追いついたら、その人の速さに合わせる (追い越せない)
      const limit = leaderPos - requiredGap(s, lane, r);
      if (next > limit) next = Math.max(r.pos, limit);
      r.pos = next;
      leaderPos = r.pos;
    }
    // 降り口に着いた人
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = s.people[ids[i] - 1];
      if (r.pos >= p.lengthSteps) {
        r.state = "done";
        r.tExit = s.t;
        const trip = s.t - r.tArrive;
        s.exited++;
        s.sumTrip += trip;
        if (r.pref === "walk") {
          s.exitedWalkers++;
          s.sumTripWalkers += trip;
        }
        ids.splice(i, 1);
      }
    }
  }
}

function arrive(s: SimState, dt: number) {
  const rate = arrivalRatePerSec(s.params.arrivals, s.t);
  // ポアソン到着を dt 刻みで近似 (dt が小さいので 1 ティックに最大 2 人)
  let n = 0;
  const expected = rate * dt;
  if (s.rng() < expected) n++;
  if (expected > 1 && s.rng() < expected - 1) n++;
  for (let i = 0; i < n; i++) {
    const pref: Pref = s.rng() < s.params.walkerRatio ? "walk" : "stand";
    enqueue(s, newPerson(s, pref));
  }
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s, dt);
  tryBoard(s);
  moveRiders(s, dt);
  s.beltOffset += s.params.beltSpeed * dt;
  s.t = Math.round((s.t + dt) * 1000) / 1000;
  const q = queueLength(s);
  if (q > s.maxQueue) s.maxQueue = q;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 1 - 1e-9) {
    s.series.push({ t: Math.round(s.t), queue: q, exited: s.exited });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export function getStats(s: SimState): SimStats {
  const boarded = s.people.filter((p) => p.tBoard >= 0).length;
  return {
    t: s.t,
    exited: s.exited,
    queue: queueLength(s),
    maxQueue: s.maxQueue,
    avgTrip: s.exited > 0 ? s.sumTrip / s.exited : 0,
    avgTripWalkers: s.exitedWalkers > 0 ? s.sumTripWalkers / s.exitedWalkers : 0,
    avgWait: boarded > 0 ? s.sumWait / boarded : 0,
  };
}

/** 同じシナリオを両方の乗り方で、seed を変えて何回も回した平均 */
export interface AggregateStats {
  runs: number;
  exited: number;
  maxQueue: number;
  avgTrip: number;
  avgTripWalkers: number;
  avgWait: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc: AggregateStats = {
    runs,
    exited: 0,
    maxQueue: 0,
    avgTrip: 0,
    avgTripWalkers: 0,
    avgWait: 0,
  };
  for (let i = 0; i < runs; i++) {
    const s = runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy));
    const st = getStats(s);
    acc.exited += st.exited;
    acc.maxQueue += st.maxQueue;
    acc.avgTrip += st.avgTrip;
    acc.avgTripWalkers += st.avgTripWalkers;
    acc.avgWait += st.avgWait;
  }
  acc.exited /= runs;
  acc.maxQueue /= runs;
  acc.avgTrip /= runs;
  acc.avgTripWalkers /= runs;
  acc.avgWait /= runs;
  return acc;
}
