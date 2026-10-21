/**
 * 生活道路の速度上限シミュレーション: 純粋な計算モデル。
 *
 * 単位は「メートル」と「秒」(速度の入出力だけ km/h)。描画や React に依存しないので、
 * ブラウザでも Node のテストでも同じコードが動く。
 *
 * 同じ seed なら、どちらの世界にも同じ車が同じ時刻にやって来て、
 * 同じ場所で同じ見通し距離の飛び出しに出会う (共通乱数)。違うのは速度上限だけ。
 */

export type Policy = "limit60" | "limit30";

export interface SimParams {
  /** 住宅地の入口から幹線道路までの距離 (m) */
  roadLengthM: number;
  /** 一時停止の交差点の間隔 (m)。0 なら一時停止なし */
  stopSpacingM: number;
  /** 一時停止で止まっている時間 (秒) */
  stopPauseSec: number;
  /** 上限がなくても、道幅や見通しからドライバーが自然に出す速度 (km/h) */
  comfortKmh: number;
  /** その速度のばらつき (±割合) */
  comfortSpread: number;
  /** 上限を最大何 km/h まで超えて走るか (0〜この値で一様) */
  overshootKmh: number;
  /** 新しい上限 30 km/h を守る人の割合。守らない人は 60 km/h を上限として走る */
  compliance: number;
  /** 加速度 (m/s²) */
  accel: number;
  /** 一時停止や前の車に合わせるときの減速度 (m/s²) */
  comfortDecel: number;
  /** 急ブレーキの減速度 (m/s²)。乾いた舗装でおよそ 6〜7 */
  emergencyDecel: number;
  /** 飛び出しに気づいてからブレーキが効き始めるまでの時間 (秒) */
  reactionMin: number;
  reactionMax: number;
  /** 飛び出した人が見えた瞬間の、車との距離 (m) */
  sightMin: number;
  sightMax: number;
  /** 1 km 走るあいだに出会う飛び出しの回数 (見やすいよう現実より大幅に多い) */
  dartPerKm: number;
  /** 1 分あたりに住宅地へ入ってくる車の台数 */
  carsPerMin: number;
  durationSec: number;
  seed: number;
}

export interface DartEvent {
  /** 人が飛び出してくる位置 (m) */
  at: number;
  /** 人が見えた瞬間の、車の先頭との距離 (m) */
  sight: number;
  /** このドライバーのこの瞬間の反応時間 (秒) */
  reaction: number;
}

export interface Encounter {
  carId: number;
  t: number;
  pedPos: number;
  /** 人が見えた瞬間の車の速度 (m/s) */
  v0: number;
  sight: number;
  reaction: number;
  hit: boolean;
  /** ぶつかったときの速度 (km/h)。止まれたら 0 */
  impactKmh: number;
  /** 歩行者が亡くなる確率 (ぶつからなければ 0) */
  fatality: number;
  /** 止まれたときの、人の手前の余裕 (m) */
  margin: number;
}

interface Emergency {
  enc: Encounter;
  t0: number;
  p0: number;
  /** ぶつかる (または止まりきる) までの時間 (秒) */
  tEnd: number;
  /** 動き出すまでの時間 (秒) */
  resumeAfter: number;
}

export interface Car {
  id: number;
  tArrive: number;
  tEnter: number;
  tExit: number;
  /** 入口からの位置 (m)。車の先頭 */
  pos: number;
  /** 速度 (m/s) */
  v: number;
  /** このドライバーが走りたい速度 (m/s、上限を反映済み) */
  vDesired: number;
  compliant: boolean;
  nextStop: number;
  /** 一時停止で止まっている間の発進時刻。止まっていなければ -1 */
  waitUntil: number;
  events: DartEvent[];
  nextEvent: number;
  emergency: Emergency | null;
  state: "waiting" | "driving" | "done";
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  cars: Car[];
  /** 道路に入る順番を待っている車 (id) */
  entryQueue: number[];
  /** 道路上の車 (id) */
  onRoad: number[];
  encounters: Encounter[];
  stopLines: number[];
  done: number;
  sumTrip: number;
  arrivalRng: () => number;
  nextArrival: number;
}

export interface SimStats {
  t: number;
  arrived: number;
  done: number;
  avgTrip: number;
  avgSpeedKmh: number;
  encounters: number;
  hits: number;
  avgImpactKmh: number;
  /** 亡くなる人数の期待値 (衝突ごとの死亡確率の合計) */
  expectedDeaths: number;
}

export const DT = 0.1;
/** 車の長さ (m) */
export const CAR_LEN = 4.5;
const MIN_GAP = 2.5;
/** 止まれたあと / ぶつかったあとに動き出すまでの時間 (秒) */
const PAUSE_AFTER_STOP = 2;
const PAUSE_AFTER_HIT = 6;

export const kmh = (ms: number) => ms * 3.6;
export const ms = (kmhValue: number) => kmhValue / 3.6;

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

/**
 * 衝突速度 (km/h) から歩行者が亡くなる確率。
 * 警察庁の分析としてよく引用される「30 km/h 以下で約 0.9%、60 km/h 以上で約 17%」の 2 点を通るロジスティック曲線。
 */
export function fatalityProb(impactKmh: number): number {
  if (impactKmh <= 0) return 0;
  const k = Math.log(0.17 / 0.83) - Math.log(0.009 / 0.991);
  const slope = k / 30;
  const intercept = Math.log(0.009 / 0.991) - slope * 30;
  return 1 / (1 + Math.exp(-(intercept + slope * impactKmh)));
}

/**
 * 人が見えた瞬間の速度 v0 (m/s)、距離 sight (m)、反応時間 reaction (秒) から結末を決める。
 * 反応時間のあいだはそのままの速度で進み、その後 decel で減速する。
 */
export function resolveEncounter(v0: number, sight: number, reaction: number, decel: number) {
  if (v0 <= 0.01) return { hit: false, impact: 0, tEnd: 0, margin: sight };
  const reactDist = v0 * reaction;
  if (sight <= reactDist) {
    return { hit: true, impact: v0, tEnd: sight / v0, margin: 0 };
  }
  const rem = sight - reactDist;
  const brakeDist = (v0 * v0) / (2 * decel);
  if (rem < brakeDist) {
    const impact = Math.sqrt(v0 * v0 - 2 * decel * rem);
    return { hit: true, impact, tEnd: reaction + (v0 - impact) / decel, margin: 0 };
  }
  return { hit: false, impact: 0, tEnd: reaction + v0 / decel, margin: rem - brakeDist };
}

/** 停止距離 (空走距離 + 制動距離, m) */
export function stoppingDistance(vKmh: number, reaction: number, decel: number): number {
  const v = ms(vKmh);
  return v * reaction + (v * v) / (2 * decel);
}

function carSeed(seed: number, id: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(id, 0x85ebca6b)) >>> 0;
}

/** 車ごとの性格と飛び出しの場面。policy に関係なく seed と id だけで決まる */
function newCar(s: SimState, id: number): Car {
  const p = s.params;
  const rng = mulberry32(carSeed(p.seed, id));
  const comfort = p.comfortKmh * (1 + p.comfortSpread * (2 * rng() - 1));
  const compliant = rng() < p.compliance;
  const overshoot = rng() * p.overshootKmh;
  const limit = s.policy === "limit30" && compliant ? 30 : 60;
  const vDesired = ms(Math.min(comfort, limit + overshoot));

  const events: DartEvent[] = [];
  const rate = p.dartPerKm / 1000;
  if (rate > 0) {
    let x = 15;
    for (;;) {
      x += -Math.log(1 - rng()) / rate;
      if (x > p.roadLengthM - 5) break;
      events.push({
        at: x,
        sight: p.sightMin + rng() * (p.sightMax - p.sightMin),
        reaction: p.reactionMin + rng() * (p.reactionMax - p.reactionMin),
      });
    }
  }
  return {
    id,
    tArrive: s.t,
    tEnter: -1,
    tExit: -1,
    pos: 0,
    v: 0,
    vDesired,
    compliant,
    nextStop: 0,
    waitUntil: -1,
    events,
    nextEvent: 0,
    emergency: null,
    state: "waiting",
  };
}

function stopLinesFor(p: SimParams): number[] {
  const lines: number[] = [];
  if (p.stopSpacingM <= 0) return lines;
  for (let x = p.stopSpacingM; x < p.roadLengthM - 1; x += p.stopSpacingM) lines.push(x);
  return lines;
}

function nextArrivalGap(rng: () => number, perMin: number): number {
  if (perMin <= 0) return Infinity;
  return -Math.log(1 - rng()) / (perMin / 60);
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const arrivalRng = mulberry32(params.seed);
  return {
    policy,
    params,
    t: 0,
    cars: [],
    entryQueue: [],
    onRoad: [],
    encounters: [],
    stopLines: stopLinesFor(params),
    done: 0,
    sumTrip: 0,
    arrivalRng,
    nextArrival: nextArrivalGap(arrivalRng, params.carsPerMin) * 0.3,
  };
}

function arrive(s: SimState) {
  while (s.t >= s.nextArrival) {
    const car = newCar(s, s.cars.length + 1);
    car.tArrive = s.nextArrival;
    s.cars.push(car);
    s.entryQueue.push(car.id);
    s.nextArrival += nextArrivalGap(s.arrivalRng, s.params.carsPerMin);
  }
}

function enter(s: SimState) {
  if (s.entryQueue.length === 0) return;
  const last = s.onRoad.length > 0 ? s.cars[s.onRoad[s.onRoad.length - 1] - 1] : null;
  if (last && last.pos - CAR_LEN < MIN_GAP + 8) return;
  const id = s.entryQueue.shift()!;
  const car = s.cars[id - 1];
  car.state = "driving";
  car.tEnter = s.t;
  car.v = Math.min(car.vDesired, ms(15));
  s.onRoad.push(id);
}

function startEmergency(s: SimState, car: Car, ev: DartEvent) {
  const p = s.params;
  const r = resolveEncounter(car.v, ev.sight, ev.reaction, p.emergencyDecel);
  const impactKmh = r.hit ? kmh(r.impact) : 0;
  const enc: Encounter = {
    carId: car.id,
    t: s.t,
    pedPos: ev.at,
    v0: car.v,
    sight: ev.sight,
    reaction: ev.reaction,
    hit: r.hit,
    impactKmh,
    fatality: fatalityProb(impactKmh),
    margin: r.margin,
  };
  s.encounters.push(enc);
  // 見えた地点を 1 ティック分行き過ぎているので、ちょうど見えた瞬間まで巻き戻す
  const p0 = ev.at - ev.sight;
  const back = car.v > 0.01 ? Math.min(DT, (car.pos - p0) / car.v) : 0;
  car.emergency = {
    enc,
    t0: s.t - back,
    p0: car.v > 0.01 ? p0 : car.pos,
    tEnd: r.tEnd,
    resumeAfter: r.tEnd + (r.hit ? PAUSE_AFTER_HIT : PAUSE_AFTER_STOP),
  };
}

/** 急ブレーキ中の位置と速度は、見えた瞬間からの経過時間で厳密に決まる */
function moveEmergency(s: SimState, car: Car) {
  const em = car.emergency!;
  const p = s.params;
  const tau = s.t - em.t0;
  const { v0, reaction } = em.enc;
  const a = p.emergencyDecel;
  const tt = Math.min(tau, em.tEnd);
  if (tt <= reaction) {
    car.pos = em.p0 + v0 * tt;
    car.v = v0;
  } else {
    const tb = tt - reaction;
    car.pos = em.p0 + v0 * reaction + v0 * tb - 0.5 * a * tb * tb;
    car.v = Math.max(0, v0 - a * tb);
  }
  if (tau >= em.tEnd) car.v = 0;
  if (tau >= em.resumeAfter) {
    car.emergency = null;
    car.v = 0;
  }
}

function moveCar(s: SimState, car: Car, leader: Car | null, dt: number) {
  const p = s.params;

  // 飛び出しが見える距離まで来たか
  const ev = car.events[car.nextEvent];
  if (ev && car.pos >= ev.at - ev.sight) {
    car.nextEvent++;
    // 前の車が人との間にいれば、その車がかばう (この車にとっては場面にならない)
    const shielded = leader !== null && leader.pos - CAR_LEN < ev.at && leader.pos > car.pos;
    if (!shielded) {
      startEmergency(s, car, ev);
      moveEmergency(s, car);
      return;
    }
  }

  // 一時停止
  const stopAt = s.stopLines[car.nextStop];
  if (car.waitUntil >= 0) {
    car.v = 0;
    if (s.t >= car.waitUntil) {
      car.waitUntil = -1;
      car.nextStop++;
    }
    return;
  }

  let target = car.vDesired;
  if (stopAt !== undefined) {
    const d = stopAt - car.pos;
    if (d < 0.6) {
      car.v = 0;
      car.waitUntil = s.t + p.stopPauseSec;
      return;
    }
    target = Math.min(target, Math.sqrt(2 * p.comfortDecel * Math.max(0, d - 0.3)));
  }
  if (leader) {
    const gap = leader.pos - CAR_LEN - car.pos - MIN_GAP;
    target = Math.min(target, Math.sqrt(leader.v * leader.v + 2 * p.comfortDecel * Math.max(0, gap)));
    if (gap <= 0) target = 0;
  }
  car.v = target < car.v ? target : Math.min(target, car.v + p.accel * dt);
  car.pos += car.v * dt;
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.durationSec) return;
  arrive(s);
  enter(s);
  // onRoad は入った順 = 先頭から順に並んでいる (追い越しはない)
  let leader: Car | null = null;
  for (const id of s.onRoad) {
    const car = s.cars[id - 1];
    if (car.emergency) moveEmergency(s, car);
    else moveCar(s, car, leader, dt);
    leader = car;
  }
  s.t = Math.round((s.t + dt) * 1000) / 1000;
  for (let i = s.onRoad.length - 1; i >= 0; i--) {
    const car = s.cars[s.onRoad[i] - 1];
    if (car.pos >= p.roadLengthM && !car.emergency) {
      car.state = "done";
      car.tExit = s.t;
      s.done++;
      s.sumTrip += car.tExit - car.tEnter;
      s.onRoad.splice(i, 1);
    }
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
  const hits = s.encounters.filter((e) => e.hit);
  const avgTrip = s.done > 0 ? s.sumTrip / s.done : 0;
  return {
    t: s.t,
    arrived: s.cars.length,
    done: s.done,
    avgTrip,
    avgSpeedKmh: avgTrip > 0 ? kmh(s.params.roadLengthM / avgTrip) : 0,
    encounters: s.encounters.length,
    hits: hits.length,
    avgImpactKmh: hits.length > 0 ? hits.reduce((a, e) => a + e.impactKmh, 0) / hits.length : 0,
    expectedDeaths: s.encounters.reduce((a, e) => a + e.fatality, 0),
  };
}

/** seed を変えて何回も回した合計と平均 */
export interface AggregateStats {
  runs: number;
  trips: number;
  avgTrip: number;
  encounters: number;
  hits: number;
  avgImpactKmh: number;
  expectedDeaths: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  let trips = 0;
  let sumTrip = 0;
  let encounters = 0;
  let hits = 0;
  let sumImpact = 0;
  let deaths = 0;
  for (let i = 0; i < runs; i++) {
    const s = runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy));
    trips += s.done;
    sumTrip += s.sumTrip;
    for (const e of s.encounters) {
      encounters++;
      deaths += e.fatality;
      if (e.hit) {
        hits++;
        sumImpact += e.impactKmh;
      }
    }
  }
  return {
    runs,
    trips,
    avgTrip: trips > 0 ? sumTrip / trips : 0,
    encounters,
    hits,
    avgImpactKmh: hits > 0 ? sumImpact / hits : 0,
    expectedDeaths: deaths,
  };
}
