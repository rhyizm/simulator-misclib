/**
 * 渋滞の最後尾とながらスマホのシミュレーション: 純粋な計算モデル。
 *
 * 単位は「メートル」と「秒」(速度の入出力だけ km/h)。描画や React に依存しないので、
 * ブラウザでも Node のテストでも同じコードが動く。
 *
 * 高速道路の 1 車線を、止まった渋滞の列に向かって車とトラックが次々に走ってくる。
 * ドライバーはときどき前から目を離す。目を離しているあいだは、前で何が起きても気づけない。
 *
 * 同じ seed なら、どちらの世界にも同じ車が同じ時刻にやって来て、同じ瞬間にメーターやミラーを見る (共通乱数)。
 * 違うのは「スマホを見る人がいるかどうか」だけ。
 */

export type World = "eyes" | "phone";
export type Kind = "car" | "truck";

export interface SimParams {
  /** 画面に出す区間の長さ (m) */
  roadLengthM: number;
  /** 最初に止まっている渋滞の列の最後尾の位置 (m)。列は道路の終わりまで続く */
  queueStartM: number;
  /** トンネルの区間 (描画用)。なければ null */
  tunnel: [number, number] | null;
  /** 止まった車や、ブレーキを踏んだ車が見えはじめる距離 (m) */
  sightM: number;
  /** 大型トラックの割合 */
  truckShare: number;
  /** 走りたい速度 (km/h) の範囲 */
  truckKmhMin: number;
  truckKmhMax: number;
  carKmhMin: number;
  carKmhMax: number;
  /** 1 分あたりにやって来る台数 */
  vehPerMin: number;
  /** 気づいてからブレーキが効きはじめるまでの時間 (秒) */
  reactionMin: number;
  reactionMax: number;
  /** 急ブレーキの減速度 (m/s²)。重いトラックほど止まりにくい */
  truckDecel: number;
  carDecel: number;
  /** メーターやミラーを見る間隔の平均 (秒) と、1 回の長さ (秒) */
  glanceEvery: number;
  glanceMin: number;
  glanceMax: number;
  /** スマホを見る人の割合 (「ながらスマホ」の世界だけ) */
  phoneShare: number;
  /** 1 回にスマホを見る長さ (秒)。人と回によって ±30% */
  phoneSec: number;
  /** スマホから目を戻して、次に見るまでの平均 (秒) */
  phoneEvery: number;
  /** 衝突被害軽減ブレーキ (AEB) が付いている割合 */
  aebShare: number;
  durationSec: number;
  seed: number;
}

/** 目を離している時間帯。phone はスマホを見ていたか */
export interface Glance {
  from: number;
  to: number;
  phone: boolean;
}

export type VehState = "cruise" | "react" | "brake" | "stopped" | "crashed";

export interface Vehicle {
  id: number;
  kind: Kind;
  len: number;
  mass: number;
  occupants: number;
  /** 先頭の位置 (m) */
  pos: number;
  v: number;
  vDesired: number;
  reaction: number;
  maxDecel: number;
  hasAeb: boolean;
  phoneUser: boolean;
  /** 前から目を離している時間帯 (絶対時刻、昇順) */
  offs: Glance[];
  offIdx: number;
  /** いま目を離しているなら、目を離した瞬間の位置 (描画用)。見ていれば -1 */
  offFromPos: number;
  offIsPhone: boolean;
  state: VehState;
  /** 異変が見えはじめた瞬間、スマホを見ていた */
  phoneAtVisible: boolean;
  /** 前の車の異変が見えはじめた時刻と、そのときの速度と距離 */
  tVisible: number;
  vVisible: number;
  gapVisible: number;
  /** 気づいた時刻 (目を戻した時刻) */
  tNotice: number;
  /** ブレーキが効きはじめる時刻 */
  tBrake: number;
  /** AEB が自動でブレーキをかけはじめた */
  aebFired: boolean;
  decel: number;
  /** 最初からいる渋滞の車 */
  initial: boolean;
  tEnter: number;
}

export interface Encounter {
  id: number;
  kind: Kind;
  t: number;
  /** 異変が見えたときの速度 (m/s) と距離 (m) */
  v0: number;
  gap: number;
  /** 見えてから気づくまで、前を見ていなかった時間 (秒) */
  blind: number;
  /** その間スマホを見ていたか */
  phone: boolean;
  crash: boolean;
  /** 追突した速度 (相手との速度差, km/h) */
  impactKmh: number;
  /** 追突した位置 (m) */
  pos: number;
  aeb: boolean;
  /** この追突で亡くなる人の期待値 (追突した側と、された側の合計) */
  deaths: number;
}

export interface SimState {
  world: World;
  params: SimParams;
  t: number;
  /** 前 (渋滞の先頭側) から順に並んだ車 */
  vehicles: Vehicle[];
  encounters: Encounter[];
  arrivalRng: () => number;
  nextArrival: number;
  nextId: number;
  /** 入口で詰まって入れない台数 */
  blocked: number;
}

export interface SimStats {
  t: number;
  arrived: number;
  reached: number;
  crashes: number;
  phoneCrashes: number;
  avgImpactKmh: number;
  expectedDeaths: number;
  /** 渋滞の最後尾の位置 (m) */
  tailPos: number;
}

export const DT = 0.05;
const MIN_GAP = 3;
const ACCEL = 0.6;
/** AEB が作動する衝突までの時間 (秒) と、そのときの減速度 (m/s²) */
export const AEB_TTC = 1.6;
export const AEB_DECEL = 5;
const VEH = {
  car: { len: 4.7, mass: 1500 },
  truck: { len: 12, mass: 20000 },
} as const;

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
 * 乗っている人の速度変化 ΔV (km/h) から、亡くなる確率。
 * 「ΔV 40 km/h で約 2%、80 km/h で約 50%」を通るロジスティック曲線 (乗員の傷害リスク曲線をおおまかに丸めたもの)。
 */
export function fatalityByDeltaV(deltaVKmh: number): number {
  if (deltaVKmh <= 0) return 0;
  const b = -Math.log(0.02 / 0.98) / 40;
  return 1 / (1 + Math.exp(-b * (deltaVKmh - 80)));
}

/**
 * 追突したときに亡くなる人の期待値。
 * 完全非弾性衝突として、軽い側ほど大きな速度変化を受ける (トラックに追突された乗用車は、ほぼ衝突速度そのまま)。
 */
export function crashDeaths(impactKmh: number, striker: Vehicle, struck: Vehicle): number {
  const m = striker.mass + struck.mass;
  const dvStruck = (impactKmh * striker.mass) / m;
  const dvStriker = (impactKmh * struck.mass) / m;
  return struck.occupants * fatalityByDeltaV(dvStruck) + striker.occupants * fatalityByDeltaV(dvStriker);
}

/**
 * 止まった列の最後尾が sight (m) 先に見えた瞬間から、blind 秒前を見ずに走り、さらに reaction 秒後にブレーキを踏んだときの追突速度 (km/h)。
 * 止まりきれれば 0。グラフの理論曲線に使う。
 */
export function impactAfterBlind(vKmh: number, sight: number, blind: number, reaction: number, decel: number): number {
  const v = ms(vKmh);
  const avail = sight - MIN_GAP - v * (blind + reaction);
  if (avail <= 0) return vKmh;
  const v2 = v * v - 2 * decel * avail;
  return v2 > 0 ? kmh(Math.sqrt(v2)) : 0;
}

/** 止まりきれる、目を離していられる時間の上限 (秒) */
export function safeBlindSec(vKmh: number, sight: number, reaction: number, decel: number): number {
  const v = ms(vKmh);
  return Math.max(0, (sight - MIN_GAP - (v * v) / (2 * decel)) / v - reaction);
}

function vehSeed(seed: number, id: number, salt: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(id, 0x85ebca6b) + Math.imul(salt, 0xc2b2ae35)) >>> 0;
}

const exp = (rng: () => number, mean: number) => -Math.log(1 - rng()) * mean;

/**
 * 車ごとの性格と、目を離す時間帯。world に関係なく seed と id だけで決まる。
 * スマホの時間帯は別の乱数で作り、「ながらスマホ」の世界でだけ使う。
 */
function newVehicle(s: SimState, id: number, t: number): Vehicle {
  const p = s.params;
  const rng = mulberry32(vehSeed(p.seed, id, 1));
  const kind: Kind = rng() < p.truckShare ? "truck" : "car";
  const kmhDesired =
    kind === "truck"
      ? p.truckKmhMin + rng() * (p.truckKmhMax - p.truckKmhMin)
      : p.carKmhMin + rng() * (p.carKmhMax - p.carKmhMin);
  const occupants = kind === "truck" ? 1 : rng() < 0.35 ? 2 + Math.floor(rng() * 3) : 1;
  const reaction = p.reactionMin + rng() * (p.reactionMax - p.reactionMin);
  const hasAeb = rng() < p.aebShare;

  // メーターやミラー
  const offs: Glance[] = [];
  const horizon = t + p.durationSec + 5;
  let x = t + rng() * p.glanceEvery;
  while (x < horizon) {
    const d = p.glanceMin + rng() * (p.glanceMax - p.glanceMin);
    offs.push({ from: x, to: x + d, phone: false });
    x += d + exp(rng, p.glanceEvery);
  }

  // スマホ
  const rp = mulberry32(vehSeed(p.seed, id, 2));
  const phoneUser = rp() < p.phoneShare;
  const phoneOffs: Glance[] = [];
  let y = t + rp() * p.phoneEvery;
  while (y < horizon) {
    const d = p.phoneSec * (0.7 + 0.6 * rp());
    phoneOffs.push({ from: y, to: y + d, phone: true });
    y += d + exp(rp, p.phoneEvery);
  }
  const usePhone = s.world === "phone" && phoneUser;
  const all = usePhone ? mergeIntervals([...offs, ...phoneOffs]) : offs;

  const spec = VEH[kind];
  return {
    id,
    kind,
    len: spec.len,
    mass: spec.mass,
    occupants,
    pos: 0,
    v: ms(kmhDesired),
    vDesired: ms(kmhDesired),
    reaction,
    maxDecel: kind === "truck" ? p.truckDecel : p.carDecel,
    hasAeb,
    phoneUser: usePhone,
    offs: all,
    offIdx: 0,
    offFromPos: -1,
    offIsPhone: false,
    state: "cruise",
    phoneAtVisible: false,
    tVisible: -1,
    vVisible: 0,
    gapVisible: 0,
    tNotice: -1,
    tBrake: -1,
    aebFired: false,
    decel: 0,
    initial: false,
    tEnter: t,
  };
}

/** 重なった時間帯は 1 つにまとめる (どちらかがスマホならスマホ扱い) */
function mergeIntervals(list: Glance[]): Glance[] {
  const sorted = list.slice().sort((a, b) => a.from - b.from);
  const out: Glance[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.from <= last.to) {
      last.to = Math.max(last.to, iv.to);
      last.phone ||= iv.phone;
    } else out.push({ ...iv });
  }
  return out;
}

function initialQueue(p: SimParams): Vehicle[] {
  const rng = mulberry32(vehSeed(p.seed, 0, 3));
  const list: Vehicle[] = [];
  let front = p.roadLengthM + 40;
  let id = -1;
  while (front > p.queueStartM) {
    const kind: Kind = rng() < p.truckShare ? "truck" : "car";
    const spec = VEH[kind];
    if (front - spec.len < p.queueStartM - 1) break;
    list.push({
      id: id--,
      kind,
      len: spec.len,
      mass: spec.mass,
      occupants: kind === "truck" ? 1 : 2,
      pos: front,
      v: 0,
      vDesired: 0,
      reaction: 1,
      maxDecel: 6,
      hasAeb: false,
      phoneUser: false,
      offs: [],
      offIdx: 0,
      offFromPos: -1,
      offIsPhone: false,
      state: "stopped",
      phoneAtVisible: false,
      tVisible: -1,
      vVisible: 0,
      gapVisible: 0,
      tNotice: -1,
      tBrake: -1,
      aebFired: false,
      decel: 0,
      initial: true,
      tEnter: 0,
    });
    front -= spec.len + MIN_GAP;
  }
  return list;
}

function nextGap(rng: () => number, perMin: number): number {
  // 車間が詰まりすぎないよう、最低 2 秒あける
  return 2 + exp(rng, Math.max(0.1, 60 / perMin - 2));
}

export function createSim(params: SimParams, world: World): SimState {
  const arrivalRng = mulberry32(params.seed);
  return {
    world,
    params,
    t: 0,
    vehicles: initialQueue(params),
    encounters: [],
    arrivalRng,
    nextArrival: 0.5,
    nextId: 1,
    blocked: 0,
  };
}

/** t の時点で前から目を離しているか (offIdx を進めながら調べる) */
function eyesOff(v: Vehicle, t: number): Glance | null {
  while (v.offIdx < v.offs.length && v.offs[v.offIdx].to <= t) v.offIdx++;
  const iv = v.offs[v.offIdx];
  return iv && iv.from <= t ? iv : null;
}

/** 前の車が「異変」(止まっている、ブレーキを踏んでいる) か */
function isHazard(leader: Vehicle): boolean {
  return leader.state === "brake" || leader.state === "stopped" || leader.state === "crashed" || leader.v < 1;
}

/** 前の車が最後に止まる位置 (先頭) */
function leaderStopPos(leader: Vehicle): number {
  if (leader.v <= 0.01) return leader.pos;
  const d = leader.state === "brake" || leader.state === "crashed" ? Math.max(leader.decel, 1) : 1;
  return leader.pos + (leader.v * leader.v) / (2 * d);
}

function arrive(s: SimState) {
  const p = s.params;
  while (s.t >= s.nextArrival && s.nextArrival < p.durationSec) {
    const last = s.vehicles[s.vehicles.length - 1];
    if (last && last.pos - last.len < 30) {
      // 入口まで渋滞が伸びてきたら、それ以上は入れない
      s.blocked++;
    } else {
      const v = newVehicle(s, s.nextId, s.nextArrival);
      if (last && last.v < v.v) v.v = Math.max(last.v, 0);
      s.vehicles.push(v);
    }
    s.nextId++;
    s.nextArrival += nextGap(s.arrivalRng, p.vehPerMin);
  }
}

function record(s: SimState, v: Vehicle, crash: boolean, impact: number, struck: Vehicle | null) {
  const blind = v.tNotice >= 0 && v.tVisible >= 0 ? Math.max(0, v.tNotice - v.tVisible) : v.tVisible >= 0 ? s.t - v.tVisible : 0;
  s.encounters.push({
    id: v.id,
    kind: v.kind,
    t: s.t,
    v0: v.vVisible,
    gap: v.gapVisible,
    blind,
    phone: v.phoneAtVisible,
    crash,
    impactKmh: kmh(impact),
    pos: v.pos,
    aeb: v.aebFired,
    deaths: crash && struck ? crashDeaths(kmh(impact), v, struck) : 0,
  });
}

function moveVehicle(s: SimState, v: Vehicle, leader: Vehicle | null, dt: number) {
  const p = s.params;
  if (v.state === "stopped" || v.initial) return;
  if (v.state === "crashed") {
    // 前の車に押しつけられたまま一緒に止まる
    if (leader) {
      v.v = Math.min(v.v, leader.v);
      v.pos = Math.min(v.pos + v.v * dt, leader.pos - leader.len);
    }
    return;
  }

  // 目を離しているか
  const off = eyesOff(v, s.t);
  if (off) {
    if (v.offFromPos < 0) {
      v.offFromPos = v.pos;
      v.offIsPhone = off.phone;
    }
  } else {
    v.offFromPos = -1;
    v.offIsPhone = false;
  }

  const gap = leader ? leader.pos - leader.len - v.pos : Infinity;
  const hazard = leader !== null && isHazard(leader) && gap <= p.sightM;

  if (hazard && v.tVisible < 0) {
    v.tVisible = s.t;
    v.vVisible = v.v;
    v.gapVisible = gap;
    v.phoneAtVisible = off?.phone ?? false;
  }
  if (hazard && !off && v.tNotice < 0 && (v.state === "cruise" || v.state === "brake")) {
    v.tNotice = s.t;
    v.tBrake = s.t + v.reaction;
    if (v.state === "cruise") v.state = "react";
  }

  // AEB: 運転する人が気づいていなくても、衝突まで AEB_TTC 秒を切ったら自動でブレーキ
  if (v.hasAeb && leader && !v.aebFired && (v.state === "cruise" || v.state === "react")) {
    const closing = v.v - leader.v;
    if (closing > 0.5 && isHazard(leader) && gap / closing < AEB_TTC) {
      v.aebFired = true;
      v.state = "brake";
      v.decel = Math.min(AEB_DECEL, v.maxDecel);
    }
  }

  if (v.state === "react" && s.t >= v.tBrake) v.state = "brake";
  if (v.state === "brake" && v.tBrake >= 0 && s.t >= v.tBrake && leader) {
    // 運転する人のブレーキ: 前の車が止まる位置の手前で止まれるだけ踏む (上限はその車の急ブレーキ)。
    // まだ遠くて 1 m/s² も要らないうちは、アクセルを離して様子を見る
    const room = leaderStopPos(leader) - leader.len - MIN_GAP - v.pos;
    const need = room > 0.1 ? (v.v * v.v) / (2 * room) : Infinity;
    const driver = need >= 1 || room < 10 ? need : 0;
    v.decel = Math.min(v.maxDecel, v.aebFired ? Math.max(AEB_DECEL, driver) : driver);
  }

  if (v.state === "brake") {
    v.v = Math.max(0, v.v - v.decel * dt);
  } else if (v.state === "cruise") {
    // ふだんの追従: 前の車が普通に走っていれば、詰まりすぎないよう速度を合わせる
    let target = v.vDesired;
    if (leader && !isHazard(leader) && gap < v.v * 2 + 10) target = Math.min(target, leader.v);
    v.v = target < v.v ? Math.max(target, v.v - 2 * dt) : Math.min(target, v.v + ACCEL * dt);
  }
  // react の間はアクセルを踏んだまま (速度は変わらない)

  v.pos += v.v * dt;

  if (leader && v.pos > leader.pos - leader.len) {
    const impact = Math.max(0, v.v - leader.v);
    v.pos = leader.pos - leader.len;
    v.v = leader.v;
    v.decel = Math.max(leader.decel, 1);
    v.state = "crashed";
    record(s, v, true, impact, leader);
    return;
  }
  if (v.state === "brake" && v.v <= 0) {
    v.v = 0;
    v.state = "stopped";
    record(s, v, false, 0, null);
  }
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s);
  // vehicles は前 (渋滞の先頭側) から順。追い越しはない
  let leader: Vehicle | null = null;
  for (const v of s.vehicles) {
    moveVehicle(s, v, leader, dt);
    leader = v;
  }
  s.t = Math.round((s.t + dt) * 1000) / 1000;
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export function tailPos(s: SimState): number {
  for (let i = s.vehicles.length - 1; i >= 0; i--) {
    const v = s.vehicles[i];
    if (v.state === "stopped" || v.state === "crashed" || v.initial) return v.pos - v.len;
  }
  return s.params.queueStartM;
}

export function getStats(s: SimState): SimStats {
  const crashes = s.encounters.filter((e) => e.crash);
  return {
    t: s.t,
    arrived: s.vehicles.filter((v) => !v.initial).length,
    reached: s.encounters.length,
    crashes: crashes.length,
    phoneCrashes: crashes.filter((e) => e.phone).length,
    avgImpactKmh: crashes.length > 0 ? crashes.reduce((a, e) => a + e.impactKmh, 0) / crashes.length : 0,
    expectedDeaths: s.encounters.reduce((a, e) => a + e.deaths, 0),
    tailPos: tailPos(s),
  };
}

/** seed を変えて何回も回した合計 */
export interface AggregateStats {
  runs: number;
  reached: number;
  crashes: number;
  phoneCrashes: number;
  avgImpactKmh: number;
  /** 追突のうち、50 km/h 以上でぶつかった回数 */
  severe: number;
  expectedDeaths: number;
}

export function aggregate(params: SimParams, world: World, runs: number): AggregateStats {
  let reached = 0;
  let crashes = 0;
  let phoneCrashes = 0;
  let sumImpact = 0;
  let severe = 0;
  let deaths = 0;
  for (let i = 0; i < runs; i++) {
    const s = runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, world));
    for (const e of s.encounters) {
      reached++;
      deaths += e.deaths;
      if (e.crash) {
        crashes++;
        sumImpact += e.impactKmh;
        if (e.phone) phoneCrashes++;
        if (e.impactKmh >= 50) severe++;
      }
    }
  }
  return {
    runs,
    reached,
    crashes,
    phoneCrashes,
    avgImpactKmh: crashes > 0 ? sumImpact / crashes : 0,
    severe,
    expectedDeaths: deaths,
  };
}
