/**
 * エスカレーターの乗り方シミュレーション: 純粋な計算モデル。
 *
 * 単位は「段 (step)」と「秒」。描画や React に依存しないので、
 * ブラウザでも Node のテストでも同じコードが動く。
 */

export type Policy = "walkLane" | "standBoth";
export type Pref = "stand" | "walk";
export type PersonState = "queue" | "riding" | "tumbling" | "fallen" | "done";

/** 0 = 立つ側のレーン, 1 = 歩く側のレーン (standBoth では両方とも立つ側) */
export type Lane = 0 | 1;

export interface Person {
  id: number;
  pref: Pref;
  /** 本当は立ちたいが行列が長いので歩く側に回った人 */
  reluctant: boolean;
  isDrunk: boolean;
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
  /** 転倒時の初期位置と転げ落ちた距離 (段) */
  tumbleFrom: number;
  tumbleDist: number;
  /** 転落中の速度 (ベルトに対して下向き, 段/秒) */
  tumbleSpeed: number;
}

export interface ArrivalPhase {
  /** このフェーズが始まる時刻 (秒) */
  from: number;
  /** 1 分あたりの到着人数 */
  perMin: number;
}

export interface IncidentParams {
  /** 酔っ払いが列の先頭に現れる時刻 (秒) */
  atSec: number;
  /** この段に達したところで転倒する */
  atStep: number;
  /** 転げ落ちる速度 (ベルトに対して, 段/秒) */
  tumbleSpeed: number;
  /** ぶつかった人が巻き込まれて転ぶ確率 */
  knockProbWalker: number;
  knockProbStander: number;
  /** 非常停止ボタンが押されるまでの時間と、停止している時間 (秒) */
  stopDelay: number;
  stopDuration: number;
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
  incident?: IncidentParams;
  durationSec: number;
  seed: number;
}

export interface Injury {
  personId: number;
  pref: Pref;
  isDrunk: boolean;
  /** 転げ落ちた距離 (段) */
  tumbleDist: number;
  severity: "light" | "moderate" | "severe";
  tSec: number;
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
  belt: number;
  /** 非常停止中なら再開時刻、そうでなければ null */
  stoppedUntil: number | null;
  incidentFired: boolean;
  drunkId: number | null;
  fallAt: number | null;
  injuries: Injury[];
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
  /** 転倒後の非常停止を一度やり終えたか */
  stopDone: boolean;
}

export interface SimStats {
  t: number;
  exited: number;
  queue: number;
  maxQueue: number;
  avgTrip: number;
  avgTripWalkers: number;
  avgWait: number;
  injuries: Injury[];
  stopped: boolean;
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

export function severityOf(dist: number): Injury["severity"] {
  if (dist < 3) return "light";
  if (dist < 8) return "moderate";
  return "severe";
}

export function createSim(params: SimParams, policy: Policy): SimState {
  return {
    policy,
    params,
    t: 0,
    people: [],
    queues: [[], []],
    riders: [[], []],
    belt: params.beltSpeed,
    stoppedUntil: null,
    incidentFired: false,
    drunkId: null,
    fallAt: null,
    injuries: [],
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
    stopDone: false,
  };
}

function newPerson(s: SimState, pref: Pref, isDrunk: boolean): Person {
  const p = s.params;
  const gap = p.standGapMin + s.rng() * (p.standGapMax - p.standGapMin);
  const person: Person = {
    id: s.nextId++,
    pref,
    reluctant: false,
    isDrunk,
    lane: 0,
    pos: 0,
    state: "queue",
    gap,
    relSpeed: 0,
    tArrive: s.t,
    tBoard: -1,
    tExit: -1,
    tumbleFrom: 0,
    tumbleDist: 0,
    tumbleSpeed: 0,
  };
  s.people.push(person);
  return person;
}

/** 到着した人を行列に並べる */
function enqueue(s: SimState, person: Person, front = false) {
  const p = s.params;
  let lane: Lane = 0;
  if (s.policy === "walkLane") {
    if (person.pref === "walk") {
      lane = 1;
      person.relSpeed = p.walkSpeed;
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
  if (front) s.queues[lane].unshift(person.id);
  else s.queues[lane].push(person.id);
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

function tryBoard(s: SimState) {
  const p = s.params;
  if (s.stoppedUntil !== null) return;
  if (s.policy === "walkLane") {
    for (const lane of [0, 1] as const) {
      const q = s.queues[lane];
      if (q.length === 0) continue;
      const person = s.people[q[0] - 1];
      const need = lane === 1 ? p.walkGap : person.gap;
      if (lowestPos(s, lane) >= need) {
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
  const belt = s.belt;
  for (const lane of [0, 1] as const) {
    const ids = s.riders[lane];
    if (ids.length === 0) continue;
    // 前にいる人から順に動かす
    ids.sort((a, b) => s.people[b - 1].pos - s.people[a - 1].pos);
    let leaderPos = Infinity;
    let leaderGap = 0;
    for (const id of ids) {
      const r = s.people[id - 1];
      if (r.state === "riding") {
        const v = belt + (belt > 0 ? r.relSpeed : 0);
        let next = r.pos + v * dt;
        const limit = leaderPos - leaderGap;
        if (next > limit) next = Math.max(r.pos, limit);
        r.pos = next;
      } else if (r.state === "fallen") {
        // 倒れたまま、ベルトと一緒に運ばれる
        r.pos += belt * dt;
      }
      if (r.state !== "tumbling") {
        leaderPos = r.pos;
        leaderGap = lane === 1 && s.policy === "walkLane" ? p.walkGap : r.gap;
        if (r.state === "fallen") leaderGap = Math.max(leaderGap, 1);
      }
    }
    // 降り口に着いた人
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = s.people[ids[i] - 1];
      if (r.pos >= p.lengthSteps && r.state === "riding") {
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
      } else if (r.pos >= p.lengthSteps && r.state === "fallen") {
        // 倒れたまま上に運ばれたら、降り口で助け出される
        r.state = "done";
        r.tExit = s.t;
        ids.splice(i, 1);
      }
    }
  }
}

function recordInjury(s: SimState, r: Person) {
  s.injuries.push({
    personId: r.id,
    pref: r.pref,
    isDrunk: r.isDrunk,
    tumbleDist: r.tumbleDist,
    severity: severityOf(r.tumbleDist),
    tSec: s.t,
  });
}

function startTumble(s: SimState, r: Person, speed: number) {
  r.state = "tumbling";
  r.tumbleFrom = r.pos;
  r.tumbleSpeed = speed;
}

function stopTumble(s: SimState, r: Person, at: number) {
  r.pos = Math.max(0, at);
  r.tumbleDist = Math.max(0, r.tumbleFrom - r.pos);
  r.state = "fallen";
  recordInjury(s, r);
}

function moveTumblers(s: SimState, dt: number) {
  const inc = s.params.incident;
  if (!inc) return;
  for (const lane of [0, 1] as const) {
    const ids = s.riders[lane];
    for (const id of ids) {
      const r = s.people[id - 1];
      if (r.state !== "tumbling") continue;
      const next = r.pos + (s.belt - r.tumbleSpeed) * dt;
      if (next <= 0) {
        stopTumble(s, r, 0);
        continue;
      }
      // 自分より下にいる、転落中でない人にぶつかるか
      let victim: Person | null = null;
      for (const oid of ids) {
        if (oid === id) continue;
        const o = s.people[oid - 1];
        if (o.state === "tumbling") continue;
        if (o.pos <= r.pos && o.pos >= next - 0.4) {
          if (!victim || o.pos > victim.pos) victim = o;
        }
      }
      if (victim) {
        stopTumble(s, r, victim.pos + 0.4);
        if (victim.state === "riding") {
          const holdingRail = victim.relSpeed === 0;
          const prob = holdingRail ? inc.knockProbStander : inc.knockProbWalker;
          if (s.rng() < prob) {
            startTumble(s, victim, r.tumbleSpeed * 0.8);
          }
        }
      } else {
        r.pos = next;
      }
    }
  }
}

function handleIncident(s: SimState) {
  const inc = s.params.incident;
  if (!inc) return;
  if (!s.incidentFired && s.t >= inc.atSec) {
    s.incidentFired = true;
    const drunk = newPerson(s, "walk", true);
    // 歩く側に空きがあるなら歩く。両側立ちならもちろん立つ。
    enqueue(s, drunk, true);
    s.drunkId = drunk.id;
  }
  if (s.drunkId !== null && s.fallAt === null) {
    const d = s.people[s.drunkId - 1];
    if (d.state === "riding" && d.pos >= inc.atStep) {
      s.fallAt = s.t;
      startTumble(s, d, inc.tumbleSpeed);
    }
  }
  if (s.fallAt !== null && s.stoppedUntil === null && s.t >= s.fallAt + inc.stopDelay && !s.stopDone) {
    s.stoppedUntil = s.t + inc.stopDuration;
    s.belt = 0;
  }
  if (s.stoppedUntil !== null && s.t >= s.stoppedUntil) {
    // 再開: 倒れていた人は救護されて降りる
    s.stoppedUntil = null;
    s.belt = s.params.beltSpeed;
    for (const lane of [0, 1] as const) {
      const ids = s.riders[lane];
      for (let i = ids.length - 1; i >= 0; i--) {
        const r = s.people[ids[i] - 1];
        if (r.state === "fallen" || r.state === "tumbling") {
          if (r.state === "tumbling") stopTumble(s, r, r.pos);
          r.state = "done";
          r.tExit = s.t;
          ids.splice(i, 1);
        }
      }
    }
    s.stopDone = true;
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
    const person = newPerson(s, pref, false);
    enqueue(s, person);
  }
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s, dt);
  handleIncident(s);
  tryBoard(s);
  moveTumblers(s, dt);
  moveRiders(s, dt);
  s.beltOffset += s.belt * dt;
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
    injuries: s.injuries,
    stopped: s.stoppedUntil !== null,
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
  injured: number;
  severe: number;
  /** 転げ落ちた距離の平均 (段) */
  avgTumble: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc: AggregateStats = {
    runs,
    exited: 0,
    maxQueue: 0,
    avgTrip: 0,
    avgTripWalkers: 0,
    avgWait: 0,
    injured: 0,
    severe: 0,
    avgTumble: 0,
  };
  let tumbleN = 0;
  for (let i = 0; i < runs; i++) {
    const s = runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy));
    const st = getStats(s);
    acc.exited += st.exited;
    acc.maxQueue += st.maxQueue;
    acc.avgTrip += st.avgTrip;
    acc.avgTripWalkers += st.avgTripWalkers;
    acc.avgWait += st.avgWait;
    acc.injured += st.injuries.length;
    acc.severe += st.injuries.filter((j) => j.severity === "severe").length;
    for (const j of st.injuries) {
      acc.avgTumble += j.tumbleDist;
      tumbleN++;
    }
  }
  acc.exited /= runs;
  acc.maxQueue /= runs;
  acc.avgTrip /= runs;
  acc.avgTripWalkers /= runs;
  acc.avgWait /= runs;
  acc.injured /= runs;
  acc.severe /= runs;
  acc.avgTumble = tumbleN > 0 ? acc.avgTumble / tumbleN : 0;
  return acc;
}
