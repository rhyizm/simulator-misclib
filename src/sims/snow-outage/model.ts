/**
 * 大雪の停電シミュレーション: 純粋な計算モデル。
 *
 * 変電所から谷沿いに延びる 1 本の配電線 (幹線) と、そこから枝分かれして山あいの集落へ向かう支線を
 * 「木の形をしたネットワーク」として表す。湿った重い雪で電線沿いの木が倒れると、その区間が切れ、
 * そこから先の家は全部停電する。同じ倒木で道もふさがるので、作業班は道の木を片づけながら奥へ進む。
 *
 * 時刻はすべて「2026 年 11 月 20 日 (金) 12:00 からの経過時間 (時間)」。描画や React に依存しない。
 */

/** 1 ステップの長さ (時間) = 5 分 */
export const DT = 1 / 12;
/** グラフ用の記録間隔 (時間) */
export const SERIES_EVERY = 0.5;
/** 開始時刻 (時計の時) */
export const START_HOUR = 12;
/** 電源車 1 台で電気を送れる集落の大きさ (戸) */
export const GEN_MAX_HOMES = 150;
/** 「長い停電」とみなす長さ (時間) */
export const LONG_H = 72;

export interface Storm {
  /** 降り始め (経過時間) */
  fromH: number;
  /** 降っている長さ (時間) */
  hours: number;
  /** 倒木の多さ (1 が基準) */
  weight: number;
}

export interface SimParams {
  /** 雪で倒れる木の多さ: 電線沿い 1 km・木の多さ 1 あたりの、電線の切れる回数 */
  faultPerKm: number;
  /** 同じく、道をふさぐ倒木の回数 */
  roadPerKm: number;
  /** 雪の重さの倍率 (詳細設定) */
  severity: number;
  storms: Storm[];
  /** 作業できる時間帯 (時計の時)。山の中の倒木は暗いと危なくて手を出せない。幹線 (国道沿い) だけは夜も作業する */
  workFromHour: number;
  workToHour: number;
  /** シミュレーションを回す長さ (時間) */
  durationH: number;
  seed: number;
}

export interface Policy {
  id: string;
  name: string;
  /** 最初からいる作業班 */
  crews: number;
  /** 応援に来る作業班と、着く時刻 (経過時間) */
  extraCrews: number;
  extraCrewsAtH: number;
  /** 道の倒木だけを片づける部隊 (自衛隊・建設業者)。作業班の 2 倍の速さで片づける */
  roadTeams: number;
  roadTeamsAtH: number;
  /** 電線沿いの木を前もって伐っておく (支線の倒木が 3 分の 1、道の倒木が 6 割になる) */
  trimmed: boolean;
  /** 電源車の台数と、出せるようになる時刻 */
  generators: number;
  generatorsAtH: number;
}

/** 配電線の網。節点 0 が変電所。節点 v (v ≥ 1) と親を結ぶ区間を「区間 v」と呼ぶ */
export interface Network {
  n: number;
  parent: number[];
  children: number[][];
  /** 区間 v の長さ (km) */
  lenKm: number[];
  /** 区間 v の沿線の木の多さ (0〜1) */
  forest: number[];
  /** 節点 v にぶら下がっている家の数 */
  homes: number[];
  depth: number[];
  /** 変電所からの道のり (km) */
  distKm: number[];
  /** 幹線の区間か */
  trunk: boolean[];
  /** 描画用の座標 */
  x: number[];
  y: number[];
  /** 節点 v から先 (自分を含む) の家の数 */
  subtreeHomes: number[];
  totalHomes: number;
}

interface BranchDef {
  at: number;
  dir: "up" | "down" | "right";
  homes: number[];
  subs?: { atIndex: number; homes: number[] }[];
}

const TRUNK_HOMES = [0, 280, 620, 380, 330, 240, 190, 140, 110];
const BRANCHES: BranchDef[] = [
  { at: 1, dir: "up", homes: [120, 60, 30] },
  { at: 2, dir: "down", homes: [190, 90, 50, 25], subs: [{ atIndex: 1, homes: [40, 20] }] },
  { at: 3, dir: "up", homes: [90, 70, 40, 30, 15], subs: [{ atIndex: 2, homes: [30, 20, 10] }] },
  { at: 4, dir: "down", homes: [140, 60, 20] },
  { at: 5, dir: "up", homes: [80, 50, 40, 25, 15, 10], subs: [{ atIndex: 3, homes: [25, 15] }] },
  { at: 6, dir: "down", homes: [100, 60, 30, 15] },
  { at: 7, dir: "up", homes: [60, 40, 20] },
  { at: 8, dir: "down", homes: [50, 30, 20, 10] },
];

const TRUNK_Y = 158;
const TRUNK_X0 = 16;
const TRUNK_DX = 38;

/** 地図はいつも同じ (乱数を使わない)。変わるのは雪と倒木だけ */
export function buildNetwork(): Network {
  const parent: number[] = [-1];
  const lenKm: number[] = [0];
  const forest: number[] = [0];
  const homes: number[] = [0];
  const trunk: boolean[] = [false];
  const x: number[] = [TRUNK_X0];
  const y: number[] = [TRUNK_Y];
  const add = (p: number, len: number, f: number, h: number, isTrunk: boolean, px: number, py: number) => {
    parent.push(p);
    lenKm.push(len);
    forest.push(f);
    homes.push(h);
    trunk.push(isTrunk);
    x.push(px);
    y.push(py);
    return parent.length - 1;
  };
  // 幹線: 国道沿い。木は少なく、日ごろから伐ってある
  const trunkIds = [0];
  for (let i = 1; i < TRUNK_HOMES.length; i++) {
    trunkIds.push(add(trunkIds[i - 1], 3, 0.1, TRUNK_HOMES[i], true, TRUNK_X0 + i * TRUNK_DX, TRUNK_Y));
  }
  // 支線: 谷の奥へ行くほど山が迫り、木が多い
  BRANCHES.forEach((b, bi) => {
    let prev = trunkIds[b.at];
    const ids: number[] = [];
    b.homes.forEach((h, k) => {
      const len = 1.6 + 0.4 * ((bi * 3 + k * 5) % 4);
      const f = Math.min(0.95, 0.55 + 0.08 * k);
      const dy = b.dir === "up" ? -19 : 19;
      const px = x[prev] + 5;
      const py = y[prev] + dy;
      prev = add(prev, len, f, h, false, px, py);
      ids.push(prev);
    });
    for (const s of b.subs ?? []) {
      let sp = ids[s.atIndex];
      s.homes.forEach((h, k) => {
        const len = 1.4 + 0.3 * ((bi + k) % 3);
        const px = x[sp] + 17;
        const py = y[sp] + (b.dir === "up" ? -5 : 5);
        sp = add(sp, len, 0.85, h, false, px, py);
      });
    }
  });

  const n = parent.length;
  const children: number[][] = Array.from({ length: n }, () => []);
  const depth = new Array(n).fill(0);
  const distKm = new Array(n).fill(0);
  for (let v = 1; v < n; v++) {
    children[parent[v]].push(v);
    depth[v] = depth[parent[v]] + 1;
    distKm[v] = distKm[parent[v]] + lenKm[v];
  }
  const subtreeHomes = homes.slice();
  for (let v = n - 1; v >= 1; v--) subtreeHomes[parent[v]] += subtreeHomes[v];
  return { n, parent, children, lenKm, forest, homes, depth, distKm, trunk, x, y, subtreeHomes, totalHomes: subtreeHomes[0] };
}

/** 網は全部の世界で共通 (変わらない) */
export const NETWORK = buildNetwork();

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

function poisson(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  for (;;) {
    p *= rng();
    if (p <= L) return k;
    k++;
  }
}

export type EventKind = "line" | "road";

/** 倒木 1 本ぶんの出来事 */
export interface TreeEvent {
  kind: EventKind;
  seg: number;
  /** 倒れる時刻 (経過時間) */
  t: number;
  /** 片づけ・直すのにかかる作業時間 (時間) */
  work: number;
}

export type UnitKind = "crew" | "road" | "gen";
export type Task = "none" | "line" | "road" | "gen" | "home";
export type Activity = "idle" | "move" | "road" | "repair" | "wait" | "power";

export interface Unit {
  id: number;
  kind: UnitKind;
  /** 現場に出られるようになる時刻 */
  fromH: number;
  /** いる節点 (移動中は出発した節点) */
  node: number;
  /** これから通る節点 */
  path: number[];
  /** path[0] へ向かう区間の上で進んだ距離 (km) */
  prog: number;
  /** いまの仕事。home は変電所 (詰所) へ戻るところ */
  task: Task;
  /** 目標 (line: 直す区間、road: 片づける区間、gen: 電気を送る集落の節点) */
  target: number;
  /** 電源車: つなぎ終えるまでの残り時間 (時間)。0 なら送電中 */
  hookLeft: number;
  activity: Activity;
}

export interface SeriesPoint {
  t: number;
  /** 停電している家 */
  out: number;
  /** 道の倒木を片づけている作業班 */
  roadCrews: number;
  /** 電線を直している作業班 */
  repairCrews: number;
}

export interface SimState {
  params: SimParams;
  policy: Policy;
  net: Network;
  t: number;
  events: TreeEvent[];
  nextEvent: number;
  /** 区間ごとの、まだ直していない電線の作業 (時間) */
  lineLeft: number[];
  /** 区間ごとの、まだ片づけていない道の倒木 (時間) */
  roadLeft: number[];
  /** 区間ごとの、いま倒れている木の本数 (描画用) */
  lineFaults: number[];
  roadBlocks: number[];
  /** 変電所から電気が届いているか */
  grid: boolean[];
  /** 電源車で電気が届いているか */
  genPowered: boolean[];
  /** 節点ごとの停電時間の合計 */
  darkH: number[];
  units: Unit[];
  /** 何かが変わるたびに増やす (待機中の班が仕事を探し直す合図) */
  version: number;
  seenVersion: number[];
  out: number;
  peakOut: number;
  homeHours: number;
  lastRestoreH: number;
  /** 作業班の時間の使い道 (班・時間) */
  crewHours: Record<Activity, number>;
  linesTotal: number;
  roadsTotal: number;
  series: SeriesPoint[];
}

/**
 * 倒木を全部、先に作っておく。どの世界でも同じ seed なら同じ木が同じ時刻に倒れる。
 * 「事前に伐った」世界では、くじ (u) で一部の倒木が起きなかったことにする
 * (伐っていない世界で倒れなかった木は、伐った世界でも倒れない)。
 */
function makeEvents(params: SimParams, policy: Policy, net: Network): { events: TreeEvent[]; lines: number; roads: number } {
  const rng = mulberry32(params.seed);
  const totalWeight = params.storms.reduce((a, s) => a + s.weight, 0);
  const sampleTime = () => {
    let r = rng() * totalWeight;
    let st = params.storms[0];
    for (const s of params.storms) {
      if (r < s.weight) {
        st = s;
        break;
      }
      r -= s.weight;
    }
    // 降り始めから徐々に重くなり、後半に倒木が集中する (三角分布、山は 6 割の位置)
    const u = rng();
    const c = 0.6;
    const f = u < c ? Math.sqrt(u * c) : 1 - Math.sqrt((1 - u) * (1 - c));
    return st.fromH + f * st.hours;
  };
  const events: TreeEvent[] = [];
  let lines = 0;
  let roads = 0;
  for (let v = 1; v < net.n; v++) {
    const base = net.lenKm[v] * net.forest[v] * params.severity * totalWeight;
    const nLine = poisson(params.faultPerKm * base, rng);
    const nRoad = poisson(params.roadPerKm * base, rng);
    const lineKeep = policy.trimmed && !net.trunk[v] ? 0.35 : 1;
    const roadKeep = policy.trimmed && !net.trunk[v] ? 0.6 : 1;
    for (let i = 0; i < nLine; i++) {
      const t = sampleTime();
      // 電線をかけ直すまで: 中央値 3.5 時間。完全に切れた線や折れた電柱はもっとかかる
      const work = Math.min(14, 3.5 * Math.exp(0.5 * normal(rng)));
      const u = rng();
      if (u < lineKeep) {
        events.push({ kind: "line", seg: v, t, work });
        lines++;
      }
    }
    for (let i = 0; i < nRoad; i++) {
      const t = sampleTime();
      // 道をふさいだ木と雪をどけるまで: 中央値 2 時間 (チェーンソーと重機)
      const work = Math.min(8, 2 * Math.exp(0.5 * normal(rng)));
      const u = rng();
      if (u < roadKeep) {
        events.push({ kind: "road", seg: v, t, work });
        roads++;
      }
    }
  }
  events.sort((a, b) => a.t - b.t || a.seg - b.seg);
  return { events, lines, roads };
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const net = NETWORK;
  const { events, lines, roads } = makeEvents(params, policy, net);
  const units: Unit[] = [];
  const addUnits = (kind: UnitKind, count: number, fromH: number) => {
    for (let i = 0; i < count; i++) {
      units.push({ id: units.length, kind, fromH, node: 0, path: [], prog: 0, task: "none", target: -1, hookLeft: 0, activity: "idle" });
    }
  };
  addUnits("crew", policy.crews, 0);
  addUnits("crew", policy.extraCrews, policy.extraCrewsAtH);
  addUnits("road", policy.roadTeams, policy.roadTeamsAtH);
  addUnits("gen", policy.generators, policy.generatorsAtH);
  return {
    params,
    policy,
    net,
    t: 0,
    events,
    nextEvent: 0,
    lineLeft: new Array(net.n).fill(0),
    roadLeft: new Array(net.n).fill(0),
    lineFaults: new Array(net.n).fill(0),
    roadBlocks: new Array(net.n).fill(0),
    grid: new Array(net.n).fill(true),
    genPowered: new Array(net.n).fill(false),
    darkH: new Array(net.n).fill(0),
    units,
    version: 0,
    seenVersion: units.map(() => -1),
    out: 0,
    peakOut: 0,
    homeHours: 0,
    lastRestoreH: -1,
    crewHours: { idle: 0, move: 0, road: 0, repair: 0, wait: 0, power: 0 },
    linesTotal: lines,
    roadsTotal: roads,
    series: [{ t: 0, out: 0, roadCrews: 0, repairCrews: 0 }],
  };
}

/** 経過時間 → 時計の時 (0〜24) */
export function hourOfDay(t: number): number {
  return (((START_HOUR + t) % 24) + 24) % 24;
}

export function isWorkTime(p: SimParams, t: number): boolean {
  const h = hourOfDay(t);
  return h >= p.workFromHour && h < p.workToHour;
}

export function isSnowing(p: SimParams, t: number): boolean {
  return p.storms.some((s) => t >= s.fromH && t < s.fromH + s.hours);
}

/** 雪の中は道が悪く、車はゆっくりしか走れない (km/h) */
function speedKmh(p: SimParams, t: number): number {
  return isSnowing(p, t) ? 12 : 22;
}

/** a から b へ行く節点の列 (a は含まず b は含む) */
export function pathBetween(net: Network, a: number, b: number): number[] {
  const up: number[] = [];
  const down: number[] = [];
  let x = a;
  let y = b;
  while (net.depth[x] > net.depth[y]) {
    x = net.parent[x];
    up.push(x);
  }
  while (net.depth[y] > net.depth[x]) {
    down.push(y);
    y = net.parent[y];
  }
  while (x !== y) {
    x = net.parent[x];
    up.push(x);
    down.push(y);
    y = net.parent[y];
  }
  return up.concat(down.reverse());
}

/** 2 つの隣り合う節点を結ぶ区間 */
function segOf(net: Network, a: number, b: number): number {
  return net.parent[b] === a ? b : a;
}

function routeCost(s: SimState, from: number, to: number): { km: number; road: number } {
  const path = pathBetween(s.net, from, to);
  let prev = from;
  let km = 0;
  let road = 0;
  for (const v of path) {
    const seg = segOf(s.net, prev, v);
    km += s.net.lenKm[seg];
    road += s.roadLeft[seg];
    prev = v;
  }
  return { km, road };
}

/** 区間 v (の先) が直ったら電気が戻る家の数: v から先で、ほかに切れていない部分 */
function restorableHomes(s: SimState): number[] {
  const net = s.net;
  const reach = net.homes.slice();
  for (let v = net.n - 1; v >= 1; v--) {
    if (s.lineLeft[v] <= 0) reach[net.parent[v]] += reach[v];
  }
  return reach;
}

/** 区間 v より変電所側に、切れている区間があるか */
function blockedAbove(s: SimState): boolean[] {
  const net = s.net;
  const b = new Array(net.n).fill(false);
  for (let v = 1; v < net.n; v++) {
    const p = net.parent[v];
    b[v] = b[p] || (p !== 0 && s.lineLeft[p] > 0);
  }
  return b;
}

/**
 * 作業班の仕事選び: 「直したら電気が戻る家の数 ÷ (移動 + 道の片づけ + 修理の時間)」が最も大きい区間。
 * 変電所側にまだ切れた区間が残っている場所は、直してもすぐには戻らないので割り引く。
 */
function chooseCrewTask(s: SimState, u: Unit, taken: Set<number>, takenRoad: Set<number>, night: boolean) {
  const net = s.net;
  const reach = restorableHomes(s);
  const above = blockedAbove(s);
  let best = -1;
  let bestScore = 0;
  for (let v = 1; v < net.n; v++) {
    if (s.lineLeft[v] <= 0 || taken.has(v) || (night && !net.trunk[v])) continue;
    const { km, road } = routeCost(s, u.node, v);
    const cost = km / 22 + road + s.lineLeft[v] + 0.5;
    const gain = reach[v] * (above[v] ? 0.3 : 1);
    const score = gain / cost;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (best >= 0) {
    u.task = "line";
    u.target = best;
    u.path = pathBetween(net, u.node, best);
    u.prog = 0;
    return;
  }
  // 直す電線がなければ、道の倒木を片づけに行く (次の仕事の準備)
  chooseRoadTask(s, u, takenRoad, night);
}

/** 道の倒木の片づけ: 奥にいる家の数 ÷ (移動 + 片づけの時間) が最も大きい区間 */
function chooseRoadTask(s: SimState, u: Unit, taken: Set<number>, night: boolean) {
  const net = s.net;
  let best = -1;
  let bestScore = 0;
  for (let v = 1; v < net.n; v++) {
    if (s.roadLeft[v] <= 0 || taken.has(v) || (night && !net.trunk[v])) continue;
    const { km, road } = routeCost(s, u.node, v);
    const cost = km / 22 + road + 0.5;
    // 停電している家が奥に多いほど先に開ける
    let dark = 0;
    const stack = [v];
    while (stack.length) {
      const x = stack.pop()!;
      if (!s.grid[x] && !s.genPowered[x]) dark += net.homes[x];
      for (const c of net.children[x]) stack.push(c);
    }
    const score = (dark + 1) / cost;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (best >= 0) {
    u.task = "road";
    u.target = best;
    u.path = pathBetween(net, u.node, best);
  } else {
    u.task = u.node === 0 ? "none" : "home";
    u.target = -1;
    u.path = u.node === 0 ? [] : pathBetween(net, u.node, 0);
  }
  u.prog = 0;
}

/** 電源車の行き先: 道がつながっていて、まだしばらく戻りそうにない (変電所側の切れ目が多い) 集落 */
function chooseGenTask(s: SimState, u: Unit, taken: Set<number>) {
  const net = s.net;
  let best = -1;
  let bestScore = 0;
  for (let v = 1; v < net.n; v++) {
    // 電源車 1 台でまかなえるのは 1 つの集落 (家 150 戸まで)
    if (s.grid[v] || s.genPowered[v] || taken.has(v) || net.homes[v] > GEN_MAX_HOMES) continue;
    const { km, road } = routeCost(s, u.node, v);
    if (road > 0) continue;
    let cuts = 0;
    for (let x = v; x !== 0; x = net.parent[x]) if (s.lineLeft[x] > 0) cuts++;
    if (cuts === 0) continue;
    const score = (net.homes[v] * cuts) / (1 + km / 22);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (best >= 0) {
    u.task = "gen";
    u.target = best;
    u.path = pathBetween(net, u.node, best);
    u.prog = 0;
    u.hookLeft = 1.5;
  } else {
    u.task = "none";
    u.target = -1;
    u.path = [];
  }
}

function updatePower(s: SimState) {
  const net = s.net;
  s.grid[0] = true;
  for (let v = 1; v < net.n; v++) s.grid[v] = s.grid[net.parent[v]] && s.lineLeft[v] <= 0;
  s.genPowered.fill(false);
  for (const u of s.units) {
    if (u.task !== "gen" || u.path.length > 0 || u.hookLeft > 0) continue;
    const v = u.target;
    if (s.grid[v]) continue;
    s.genPowered[v] = true;
  }
  let out = 0;
  for (let v = 1; v < net.n; v++) if (!s.grid[v] && !s.genPowered[v]) out += net.homes[v];
  s.out = out;
}

/** 1 台を dt 時間だけ動かす (道の倒木にぶつかったら片づける / 待つ) */
function moveUnit(s: SimState, u: Unit, dt: number, canWork: boolean): number {
  const net = s.net;
  while (dt > 1e-9 && u.path.length > 0) {
    const next = u.path[0];
    const seg = segOf(net, u.node, next);
    if (u.prog === 0 && s.roadLeft[seg] > 0) {
      // 幹線 (国道沿い) は照明をつけて夜も作業できる
      if (u.kind === "gen" || !(canWork || net.trunk[seg])) {
        u.activity = "wait";
        return 0;
      }
      const rate = u.kind === "road" ? 2 : 1;
      const done = Math.min(s.roadLeft[seg], dt * rate);
      s.roadLeft[seg] -= done;
      dt -= done / rate;
      u.activity = "road";
      if (s.roadLeft[seg] <= 1e-9) {
        s.roadLeft[seg] = 0;
        s.roadBlocks[seg] = 0;
        s.version++;
      } else {
        return 0;
      }
      continue;
    }
    const sp = speedKmh(s.params, s.t);
    const remain = net.lenKm[seg] - u.prog;
    const d = Math.min(remain, dt * sp);
    u.prog += d;
    dt -= d / sp;
    u.activity = "move";
    if (u.prog >= net.lenKm[seg] - 1e-9) {
      u.node = next;
      u.path.shift();
      u.prog = 0;
    }
  }
  return dt;
}

export function step(s: SimState, dt: number = DT) {
  if (isFinished(s)) return;
  const p = s.params;
  const t1 = s.t + dt;
  // 木が倒れる
  while (s.nextEvent < s.events.length && s.events[s.nextEvent].t < t1) {
    const e = s.events[s.nextEvent++];
    if (e.kind === "line") {
      s.lineLeft[e.seg] += e.work;
      s.lineFaults[e.seg]++;
    } else {
      s.roadLeft[e.seg] += e.work;
      s.roadBlocks[e.seg]++;
    }
    s.version++;
  }
  updatePower(s);

  const canWork = isWorkTime(p, s.t);
  // 朝になったら、詰所にいる班が仕事を探し直す
  if (canWork !== isWorkTime(p, s.t - dt)) s.version++;
  const snowing = isSnowing(p, s.t);
  // 雪が降っている間の作業は、はかどらない
  const repairRate = snowing ? 0.6 : 1;
  for (const u of s.units) {
    if (s.t < u.fromH) continue;
    // 終わった仕事を片づける
    if (u.task === "line" && s.lineLeft[u.target] <= 0) u.task = "none";
    else if (u.task === "road" && u.path.length === 0) u.task = "none";
    else if (u.task === "gen" && s.grid[u.target]) u.task = "none";
    else if (u.task === "home" && u.path.length === 0) u.task = "none";
    // 暗くなったら山の中の作業を切り上げて詰所へ戻る (幹線の作業だけは夜も続ける)
    if (!canWork && u.kind !== "gen" && (u.task === "line" || u.task === "road") && !s.net.trunk[u.target]) {
      u.task = "none";
      s.seenVersion[u.id] = -1;
    }
    // 仕事がない班は、状況が変わったときだけ探し直す
    if ((u.task === "none" || u.task === "home") && s.seenVersion[u.id] !== s.version) {
      s.seenVersion[u.id] = s.version;
      const taken: Record<"line" | "road" | "gen", Set<number>> = { line: new Set(), road: new Set(), gen: new Set() };
      for (const o of s.units) {
        if (o !== u && (o.task === "line" || o.task === "road" || o.task === "gen")) taken[o.task].add(o.target);
      }
      if (u.kind === "crew") chooseCrewTask(s, u, taken.line, taken.road, !canWork);
      else if (u.kind === "road") chooseRoadTask(s, u, taken.road, !canWork);
      else chooseGenTask(s, u, taken.gen);
    }
    const left = moveUnit(s, u, dt, canWork);
    if (u.path.length === 0 && left > 1e-9) {
      if (u.task === "line") {
        if (canWork || s.net.trunk[u.target]) {
          s.lineLeft[u.target] -= left * repairRate;
          u.activity = "repair";
          if (s.lineLeft[u.target] <= 1e-9) {
            s.lineLeft[u.target] = 0;
            s.lineFaults[u.target] = 0;
            u.task = "none";
            s.version++;
          }
        } else {
          u.activity = "wait";
        }
      } else if (u.task === "gen") {
        if (u.hookLeft > 0) {
          u.hookLeft = Math.max(0, u.hookLeft - left);
          u.activity = "wait";
        } else {
          u.activity = "power";
        }
      } else {
        u.activity = "idle";
      }
    }
    if (u.kind === "crew") s.crewHours[u.activity] += dt;
  }

  const prevOut = s.out;
  updatePower(s);
  const net = s.net;
  for (let v = 1; v < net.n; v++) if (!s.grid[v] && !s.genPowered[v]) s.darkH[v] += dt;
  s.homeHours += s.out * dt;
  if (s.out > s.peakOut) s.peakOut = s.out;
  if (s.out === 0 && prevOut > 0) s.lastRestoreH = t1;
  s.t = t1;
  if (Math.floor(t1 / SERIES_EVERY + 1e-9) !== Math.floor((t1 - dt) / SERIES_EVERY + 1e-9)) {
    let roadCrews = 0;
    let repairCrews = 0;
    for (const u of s.units) {
      if (u.kind !== "crew" || s.t < u.fromH) continue;
      if (u.activity === "road") roadCrews++;
      else if (u.activity === "repair") repairCrews++;
    }
    s.series.push({ t: t1, out: s.out, roadCrews, repairCrews });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationH - 1e-9;
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export interface SimStats {
  t: number;
  out: number;
  peakOut: number;
  /** 停電の合計 (戸・時間) */
  homeHours: number;
  /** 停電が 24 時間 / 72 時間を超えた家 */
  over24: number;
  over72: number;
  /** いちばん長く停電した集落の停電時間 */
  longestH: number;
  /** 最後の家に電気が戻った時刻 (戻っていなければ -1) */
  lastRestoreH: number;
  lines: number;
  roads: number;
  linesNow: number;
  roadsNow: number;
  /** 作業班の時間のうち、道の倒木を片づけていた割合 / 電線を直していた割合 / 移動 */
  roadShare: number;
  repairShare: number;
  moveShare: number;
}

export function getStats(s: SimState): SimStats {
  const net = s.net;
  let over24 = 0;
  let over72 = 0;
  let longest = 0;
  let linesNow = 0;
  let roadsNow = 0;
  for (let v = 1; v < net.n; v++) {
    if (s.darkH[v] > 24) over24 += net.homes[v];
    if (s.darkH[v] > LONG_H) over72 += net.homes[v];
    if (s.darkH[v] > longest) longest = s.darkH[v];
    linesNow += s.lineFaults[v];
    roadsNow += s.roadBlocks[v];
  }
  const ch = s.crewHours;
  const working = ch.move + ch.road + ch.repair;
  return {
    t: s.t,
    out: s.out,
    peakOut: s.peakOut,
    homeHours: s.homeHours,
    over24,
    over72,
    longestH: longest,
    lastRestoreH: s.out > 0 ? -1 : s.peakOut > 0 ? s.lastRestoreH : 0,
    lines: s.linesTotal,
    roads: s.roadsTotal,
    linesNow,
    roadsNow,
    roadShare: working > 0 ? ch.road / working : 0,
    repairShare: working > 0 ? ch.repair / working : 0,
    moveShare: working > 0 ? ch.move / working : 0,
  };
}

export type AggregateStats = Omit<SimStats, "t" | "out" | "linesNow" | "roadsNow" | "lastRestoreH"> & {
  /** 最後の家に電気が戻った時刻の平均 (戻らなかった回は除く) */
  lastRestoreH: number;
  /** 期間内に全部戻らなかった割合 */
  unfinishedShare: number;
};

/** 乱数を変えて runs 回まわした平均 */
export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const keys = ["peakOut", "homeHours", "over24", "over72", "longestH", "lines", "roads", "roadShare", "repairShare", "moveShare"] as const;
  const acc = Object.fromEntries(keys.map((k) => [k, 0])) as Record<(typeof keys)[number], number>;
  let restoreSum = 0;
  let restored = 0;
  for (let r = 0; r < runs; r++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + r * 7919 }, policy)));
    for (const k of keys) acc[k] += st[k];
    if (st.lastRestoreH >= 0) {
      restored++;
      restoreSum += st.lastRestoreH;
    }
  }
  for (const k of keys) acc[k] /= runs;
  return { ...acc, lastRestoreH: restored > 0 ? restoreSum / restored : -1, unfinishedShare: 1 - restored / runs };
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

/** 経過時間 → "11/21(土) 14:00" */
export function fmtClock(t: number): string {
  const totalMin = Math.round((START_HOUR + t) * 60);
  const day = Math.floor(totalMin / 1440);
  const min = totalMin - day * 1440;
  const date = 20 + day;
  const m = date > 30 ? 12 : 11;
  const d = date > 30 ? date - 30 : date;
  const w = WEEK[(5 + day) % 7];
  return `${m}/${d}(${w}) ${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** 時間 → "2 日 5 時間" */
export function fmtDuration(h: number): string {
  if (h < 0) return "–";
  if (h < 24) return `${Math.round(h)} 時間`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return r === 0 ? `${d} 日` : `${d} 日 ${r} 時間`;
}
