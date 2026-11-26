/**
 * ウォークスルー改札のシミュレーション: 純粋な計算モデル。
 *
 * 単位は「人」と「秒」。駅の改札口 1 か所 (出場側) に、電車が着くたびに人の波が来る。
 * 人は改札の通路を 1 本選んで並び、先頭から順に通過する。
 * 通路が「いつ次の人を通せるか」(busyUntil) だけを持つ、単純な待ち行列モデル。
 * 描画や React に依存しないので、ブラウザでも Node のテストでも同じコードが動く。
 */

/** 通路の種類: タッチのみ / ウォークスルーもタッチも可 / ウォークスルー専用 */
export type LaneKind = "touch" | "mixed" | "wtOnly";

/** 人の種類: IC をタッチする人 / ウォークスルー対応スマホの人 / 切符・QR の人 */
export type PaxKind = "touch" | "wt" | "ticket";

export type PolicyId = "touchOnly" | "oneMixed" | "oneDedicated" | "halfDedicated" | "allMixed";

export interface Policy {
  id: PolicyId;
  label: string;
  short: string;
  description: string;
}

export const POLICIES: Policy[] = [
  {
    id: "touchOnly",
    label: "いまの改札",
    short: "いまの改札",
    description: "全通路がタッチ式。ウォークスルー対応のスマホを持つ人も、取り出してタッチする。",
  },
  {
    id: "oneMixed",
    label: "1 通路だけ (タッチも可)",
    short: "1 通路・共用",
    description: "JR 東日本の計画どおり出場 1 通路をウォークスルー対応に。その通路はタッチの人も通れる。",
  },
  {
    id: "oneDedicated",
    label: "1 通路だけ (専用)",
    short: "1 通路・専用",
    description: "ウォークスルー対応の 1 通路を専用にする。タッチの人は通れず、間違えて入ると扉が閉まる。",
  },
  {
    id: "halfDedicated",
    label: "半分を専用に",
    short: "半分・専用",
    description: "通路の半分をウォークスルー専用にする。残り半分はタッチ式のまま。",
  },
  {
    id: "allMixed",
    label: "全通路を対応に",
    short: "全通路",
    description: "2031 年度末の目標のように、全通路をウォークスルー対応にする (タッチも可)。",
  },
];

export function getPolicy(id: PolicyId): Policy {
  return POLICIES.find((p) => p.id === id) ?? POLICIES[0];
}

export function laneKinds(policy: PolicyId, n: number): LaneKind[] {
  const kinds: LaneKind[] = Array.from({ length: n }, () => "touch");
  switch (policy) {
    case "touchOnly":
      break;
    case "oneMixed":
      kinds[0] = "mixed";
      break;
    case "oneDedicated":
      kinds[0] = "wtOnly";
      break;
    case "halfDedicated":
      for (let i = 0; i < Math.floor(n / 2); i++) kinds[i] = "wtOnly";
      break;
    case "allMixed":
      for (let i = 0; i < n; i++) kinds[i] = "mixed";
      break;
  }
  return kinds;
}

export interface TrainPattern {
  /** 最初の電車が着く時刻 (秒) */
  first: number;
  /** 電車の間隔 (秒) */
  intervalSec: number;
  /** 本数 */
  count: number;
  /** 1 本あたりこの改札に来る人数 */
  passengers: number;
  /** その人たちが改札に着くまでにかかる時間 (秒)。この間に均等に来る */
  spreadSec: number;
}

export interface SimParams {
  /** 改札の通路の数 (出場方向) */
  lanes: number;
  trains: TrainPattern;
  /** 電車と関係なくぱらぱら来る人 (人/分) */
  tricklePerMin: number;
  /** 切符・QR 以外の人 (IC・スマホの人) のうち、ウォークスルー対応スマホを持つ人の割合 */
  wtShare: number;
  /** 切符・QR の人の割合 */
  ticketShare: number;
  /** 大きな荷物・ベビーカーなど、通過に時間がかかる人の割合 */
  luggageShare: number;
  /** タッチして通過する人の間隔 (秒, 平均) */
  touchHeadway: number;
  /** ウォークスルーで通過する人の間隔 (秒, 平均) */
  wtHeadway: number;
  /** 切符・QR の人の間隔 (秒, 平均) */
  ticketHeadway: number;
  /** 荷物の多い人の追加時間 (秒) */
  luggageExtra: number;
  /** タッチ・切符の人のうち、残高不足や読み取りエラーで扉が閉まる割合 */
  cardErrorRate: number;
  /** ウォークスルーの人のうち、スマホが検知されず扉が閉まる割合 */
  wtMissRate: number;
  /** ウォークスルー非対応の人が、専用通路だと気づかずに入ってしまう割合 */
  wrongLaneRate: number;
  /** 扉が閉まったとき、後ろに下がって通路が空くまでの時間 (秒) */
  blockSec: number;
  /** ウォークスルーの人が対応通路を選ぶために、余分に並んでもよいと思う人数 */
  wtBias: number;
  durationSec: number;
  seed: number;
}

export type PaxState = "queue" | "done" | "adjust";

export interface Pax {
  id: number;
  kind: PaxKind;
  luggage: boolean;
  /** 専用通路を見分けられない人 (ウォークスルー非対応の人のみ) */
  confused: boolean;
  lane: number;
  state: PaxState;
  tArrive: number;
  tPass: number;
  /** ウォークスルーで通過したか */
  viaWt: boolean;
  /** 扉を閉めた回数 */
  stops: number;
}

export interface Lane {
  kind: LaneKind;
  queue: number[];
  /** この時刻まで次の人を通せない */
  busyUntil: number;
  /** 描画用: 扉が閉まっている (エラー) 状態の終わり */
  closedUntil: number;
  served: number;
}

export interface SeriesPoint {
  t: number;
  queue: number;
  passed: number;
}

export interface SimState {
  policy: PolicyId;
  params: SimParams;
  t: number;
  pax: Pax[];
  lanes: Lane[];
  passed: number;
  passedWt: number;
  adjust: number;
  gateStops: number;
  maxQueue: number;
  series: SeriesPoint[];
  /** 描画用: 最近通過した人 (id) */
  recent: number[];
  rng: () => number;
  /** 到着の端数 (人) */
  arrivalAcc: number;
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

/** 時刻 t の到着率 (人/秒) */
export function arrivalRate(p: SimParams, t: number): number {
  let rate = p.tricklePerMin / 60;
  const tr = p.trains;
  for (let i = 0; i < tr.count; i++) {
    const t0 = tr.first + i * tr.intervalSec;
    if (t >= t0 && t < t0 + tr.spreadSec) rate += tr.passengers / tr.spreadSec;
  }
  return rate;
}

export function createSim(params: SimParams, policy: PolicyId): SimState {
  return {
    policy,
    params,
    t: 0,
    pax: [],
    lanes: laneKinds(policy, params.lanes).map((kind) => ({
      kind,
      queue: [],
      busyUntil: 0,
      closedUntil: -1,
      served: 0,
    })),
    passed: 0,
    passedWt: 0,
    adjust: 0,
    gateStops: 0,
    maxQueue: 0,
    series: [{ t: 0, queue: 0, passed: 0 }],
    recent: [],
    rng: mulberry32(params.seed),
    arrivalAcc: 0,
  };
}

/** この人がこの通路を使えるか (間違えて入る人は専用通路も「使える」と思っている) */
function canUse(pax: Pax, lane: Lane): boolean {
  if (lane.kind !== "wtOnly") return true;
  return pax.kind === "wt" || pax.confused;
}

/**
 * 通路を選ぶ。人は通路の中身までは見ないので、並んでいる人数で判断する。
 * 見た目の人数には誤差 (±1.5 人程度) があり、
 * ウォークスルーの人は対応通路を wtBias 人ぶん短く見積もる (タッチしなくて済むなら多少並ぶ)。
 */
function chooseLane(s: SimState, pax: Pax, exclude = -1): number {
  const p = s.params;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < s.lanes.length; i++) {
    if (i === exclude) continue;
    const lane = s.lanes[i];
    if (!canUse(pax, lane)) continue;
    let score = lane.queue.length + (s.rng() - 0.5) * 3;
    if (lane.busyUntil > s.t) score += 0.5;
    if (pax.kind === "wt" && lane.kind !== "touch") score -= p.wtBias;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best < 0 ? 0 : best;
}

function newPax(s: SimState): Pax {
  const p = s.params;
  const kind: PaxKind = s.rng() < p.ticketShare ? "ticket" : s.rng() < p.wtShare ? "wt" : "touch";
  const pax: Pax = {
    id: s.pax.length + 1,
    kind,
    luggage: s.rng() < p.luggageShare,
    confused: kind !== "wt" && s.rng() < p.wrongLaneRate,
    lane: 0,
    state: "queue",
    tArrive: s.t,
    tPass: -1,
    viaWt: false,
    stops: 0,
  };
  s.pax.push(pax);
  return pax;
}

function enqueue(s: SimState, pax: Pax, lane: number) {
  pax.lane = lane;
  s.lanes[lane].queue.push(pax.id);
}

function arrive(s: SimState, dt: number) {
  s.arrivalAcc += arrivalRate(s.params, s.t) * dt;
  // 端数をためて、ちょうど整数人ずつ来るようにする (平均どおりの人数がそろう)。
  // 来る瞬間だけ少し揺らして、全員が等間隔にならないようにする。
  while (s.arrivalAcc >= 1) {
    if (s.rng() < 0.15) break;
    s.arrivalAcc -= 1;
    const pax = newPax(s);
    enqueue(s, pax, chooseLane(s, pax));
  }
}

/** 平均 m のまわりに ±25% ばらつく時間 */
function jitter(s: SimState, m: number): number {
  return m * (0.75 + 0.5 * s.rng());
}

function closeGate(s: SimState, lane: Lane) {
  const p = s.params;
  lane.busyUntil = s.t + jitter(s, p.blockSec);
  lane.closedUntil = lane.busyUntil;
  s.gateStops++;
}

function pass(s: SimState, pax: Pax, lane: Lane, headway: number, viaWt: boolean) {
  pax.state = "done";
  pax.tPass = s.t;
  pax.viaWt = viaWt;
  lane.busyUntil = s.t + headway;
  lane.served++;
  s.passed++;
  if (viaWt) s.passedWt++;
  s.recent.push(pax.id);
}

/** 通路の先頭の人を処理する */
function serve(s: SimState) {
  const p = s.params;
  for (let li = 0; li < s.lanes.length; li++) {
    const lane = s.lanes[li];
    if (lane.queue.length === 0 || s.t < lane.busyUntil) continue;
    const pax = s.pax[lane.queue[0] - 1];
    const extra = pax.luggage ? p.luggageExtra : 0;

    // 専用通路に、ウォークスルー非対応の人が入ってしまった
    if (lane.kind === "wtOnly" && pax.kind !== "wt") {
      lane.queue.shift();
      pax.stops++;
      pax.confused = false;
      closeGate(s, lane);
      enqueue(s, pax, chooseLane(s, pax, li));
      continue;
    }

    if (pax.kind === "wt" && lane.kind !== "touch") {
      if (s.rng() < p.wtMissRate) {
        // スマホが検知されず扉が閉まる。いったん止まり、取り出してタッチして通る
        pax.stops++;
        lane.queue.shift();
        closeGate(s, lane);
        lane.busyUntil += jitter(s, p.touchHeadway) + extra;
        pax.state = "done";
        pax.tPass = lane.busyUntil;
        lane.served++;
        s.passed++;
        s.recent.push(pax.id);
        continue;
      }
      lane.queue.shift();
      pass(s, pax, lane, jitter(s, p.wtHeadway) + extra, true);
      continue;
    }

    // タッチ (ウォークスルー対応の人もタッチ式の通路ではタッチする) または切符
    if (s.rng() < p.cardErrorRate) {
      // 残高不足・読み取りエラー: 扉が閉まり、後ろに下がって精算機へ
      lane.queue.shift();
      pax.stops++;
      pax.state = "adjust";
      s.adjust++;
      closeGate(s, lane);
      continue;
    }
    const base = pax.kind === "ticket" ? p.ticketHeadway : p.touchHeadway;
    lane.queue.shift();
    pass(s, pax, lane, jitter(s, base) + extra, false);
  }
}

export function queueLength(s: SimState): number {
  let n = 0;
  for (const l of s.lanes) n += l.queue.length;
  return n;
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s, dt);
  serve(s);
  s.t = Math.round((s.t + dt) * 1000) / 1000;
  // 描画用の「最近通過した人」は 3 秒で消す
  while (s.recent.length > 0 && s.t - s.pax[s.recent[0] - 1].tPass > 3) s.recent.shift();
  const q = queueLength(s);
  if (q > s.maxQueue) s.maxQueue = q;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 1 - 1e-9) s.series.push({ t: Math.round(s.t), queue: q, passed: s.passed });
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export interface SimStats {
  t: number;
  passed: number;
  queue: number;
  maxQueue: number;
  /** 通過した人の平均待ち (到着から通過まで, 秒) */
  avgWait: number;
  /** 9 割の人がこれ以内に通過した (秒) */
  p90Wait: number;
  avgWaitWt: number;
  avgWaitOther: number;
  /** ウォークスルーで通過した人の割合 (ウォークスルー対応の人のうち) */
  wtUsedShare: number;
  gateStops: number;
  adjust: number;
}

export function getStats(s: SimState): SimStats {
  const waits: number[] = [];
  let sum = 0;
  let sumWt = 0;
  let nWt = 0;
  let sumOther = 0;
  let nOther = 0;
  let wtAll = 0;
  for (const x of s.pax) {
    if (x.kind === "wt" && x.state === "done") wtAll++;
    if (x.state !== "done") continue;
    const w = Math.max(0, x.tPass - x.tArrive);
    waits.push(w);
    sum += w;
    if (x.kind === "wt") {
      sumWt += w;
      nWt++;
    } else {
      sumOther += w;
      nOther++;
    }
  }
  waits.sort((a, b) => a - b);
  const p90 = waits.length > 0 ? waits[Math.min(waits.length - 1, Math.floor(waits.length * 0.9))] : 0;
  return {
    t: s.t,
    passed: s.passed,
    queue: queueLength(s),
    maxQueue: s.maxQueue,
    avgWait: waits.length > 0 ? sum / waits.length : 0,
    p90Wait: p90,
    avgWaitWt: nWt > 0 ? sumWt / nWt : 0,
    avgWaitOther: nOther > 0 ? sumOther / nOther : 0,
    wtUsedShare: wtAll > 0 ? s.passedWt / wtAll : 0,
    gateStops: s.gateStops,
    adjust: s.adjust,
  };
}

export interface AggregateStats {
  runs: number;
  passed: number;
  maxQueue: number;
  avgWait: number;
  p90Wait: number;
  avgWaitWt: number;
  avgWaitOther: number;
  wtUsedShare: number;
  gateStops: number;
}

/** 乱数を変えて何回も回した平均 */
export function aggregate(params: SimParams, policy: PolicyId, runs: number): AggregateStats {
  const acc: AggregateStats = {
    runs,
    passed: 0,
    maxQueue: 0,
    avgWait: 0,
    p90Wait: 0,
    avgWaitWt: 0,
    avgWaitOther: 0,
    wtUsedShare: 0,
    gateStops: 0,
  };
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    acc.passed += st.passed;
    acc.maxQueue += st.maxQueue;
    acc.avgWait += st.avgWait;
    acc.p90Wait += st.p90Wait;
    acc.avgWaitWt += st.avgWaitWt;
    acc.avgWaitOther += st.avgWaitOther;
    acc.wtUsedShare += st.wtUsedShare;
    acc.gateStops += st.gateStops;
  }
  for (const k of Object.keys(acc) as (keyof AggregateStats)[]) {
    if (k !== "runs") acc[k] /= runs;
  }
  return acc;
}

export interface SweepPoint {
  share: number;
  avgWait: number;
  avgWaitWt: number;
  avgWaitOther: number;
}

/** ウォークスルー対応の人の割合を 0〜100% で変えたときの平均待ち */
export function sweepShare(
  params: SimParams,
  policy: PolicyId,
  shares: number[],
  runs: number,
): SweepPoint[] {
  return shares.map((share) => {
    const a = aggregate({ ...params, wtShare: share }, policy, runs);
    return { share, avgWait: a.avgWait, avgWaitWt: a.avgWaitWt, avgWaitOther: a.avgWaitOther };
  });
}
