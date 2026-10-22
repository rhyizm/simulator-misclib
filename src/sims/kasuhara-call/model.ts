/**
 * カスハラ電話とコールセンターの待ち行列シミュレーション: 純粋な計算モデル。
 *
 * 単位は「分」。t = 0 が朝 9:00。描画や React に依存しないので、
 * ブラウザでも Node のテストでも同じコードが動く。
 */

/** noLimit: 相手が納得するまで切らない / cap: 上限の時間で方針を伝えて切る */
export type Policy = "noLimit" | "cap";
export type CallState = "pending" | "waiting" | "talking" | "done" | "abandoned";
export type OpState = "idle" | "talking" | "wrapup" | "recover" | "left";

export interface Call {
  id: number;
  /** カスハラ (長時間の拘束・暴言) の電話か */
  harass: boolean;
  tArrive: number;
  /** 普通の客がこれ以上待てずに切るまでの時間 (分)。カスハラの電話は待ち続ける */
  patience: number;
  /** 話したい長さ (分)。カスハラの電話は、掛け直しで減っていく残り */
  need: number;
  /** 何回目の電話か (1 = 最初の電話) */
  attempt: number;
  /** もとの電話の id (掛け直しのとき)。最初の電話は自分の id */
  origin: number;
  tStart: number;
  tEnd: number;
  op: number;
  state: CallState;
}

export interface Operator {
  state: OpState;
  call: number;
  /** いまの状態が終わる時刻 (talking / wrapup / recover) */
  until: number;
  /** たまった負担 (カスハラ対応 1 分 = 1) */
  stress: number;
  /** カスハラ対応に使った分 (累計) */
  harassMin: number;
  /** 早退した時刻 (left のとき) */
  tLeft: number;
}

export interface SimParams {
  /** 受付時間内にかかってくる普通の電話の本数 */
  calls: number;
  /** そのうちカスハラの電話になる割合 (最初の電話の本数に対して) */
  harassRatio: number;
  operators: number;
  /** 普通の電話の通話時間: serviceMin + 指数分布 (平均 serviceMean - serviceMin) */
  serviceMin: number;
  serviceMean: number;
  /** 普通の電話のあとの後処理 (分) */
  wrapupMin: number;
  /** 普通の客が待てる時間の平均 (分、指数分布) */
  patienceMean: number;
  /** カスハラの電話が「納得するまで」話そうとする長さ: harassMin + 指数分布 (平均 harassMean - harassMin) */
  harassMin: number;
  harassMean: number;
  /** カスハラ対応のあとに席を離れて落ち着く時間 (分) */
  recoverMin: number;
  /** cap の世界で 1 回の電話を切る上限 (分) */
  capMin: number;
  /** 切られたあとに掛け直してくる確率 */
  callbackProb: number;
  /** 掛け直してくるまでの時間 [最小, 最大] (分) */
  callbackDelay: [number, number];
  /** たまった負担がこれを超えたら、その電話が終わったところで早退する */
  stressLimit: number;
  /** カスハラ以外の時間に負担が抜けていく速さ (1 分あたり) */
  stressDecay: number;
  /** 受付を終える時刻 (分)。これ以降は新しい電話を受けない */
  closeAt: number;
  durationMin: number;
  seed: number;
}

export interface SeriesPoint {
  t: number;
  /** 保留で待っている人数 */
  waiting: number;
  /** 待ちきれずに切った普通の客 (累計) */
  abandoned: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  calls: Call[];
  /** まだかかってきていない電話の id (到着の早い順) */
  next: number;
  /** 保留中の電話の id (着信順) */
  queue: number[];
  ops: Operator[];
  /** オペレーターが席にいた分の合計 (早退した人は早退まで) */
  staffedMin: number;
  maxWaiting: number;
  series: SeriesPoint[];
}

export interface SimStats {
  t: number;
  /** かかってきた普通の電話 */
  arrived: number;
  answered: number;
  abandoned: number;
  waiting: number;
  maxWaiting: number;
  /** 普通の客の平均の待ち (分)。切った人は切るまで、まだ待っている人は今までで数える */
  avgWait: number;
  /** 普通の客のうち、3 分以内につながった割合 */
  within3: number;
  /** 普通の客のうち、待ちきれずに切った割合 */
  abandonRate: number;
  /** カスハラの電話の本数 (掛け直しを含む) */
  harassCalls: number;
  /** カスハラ対応に使われた時間 (オペレーター分、落ち着く時間を含む) */
  harassMin: number;
  /** 席にいた時間のうちカスハラ対応に使われた割合 */
  harassShare: number;
  /** 早退したオペレーター */
  leftOps: number;
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
/** series に点を足す間隔 (分) */
export const SERIES_STEP = 5;
/** t = 0 の時計の時刻 (時) */
export const DAY_START_HOUR = 9;
/** 「すぐつながった」とみなす待ち (分) */
export const QUICK_MIN = 3;
/** 1 時間ごとの電話の多さ (9 時台〜16 時台)。朝と昼休み明けに山がある */
export const HOURLY_WEIGHT = [1.35, 1.25, 1.0, 0.7, 1.15, 1.0, 0.85, 0.7];
/** 1 本のカスハラの電話が掛け直してくる回数の上限 */
const MAX_ATTEMPTS = 6;

export function clock(t: number): string {
  const total = Math.round(DAY_START_HOUR * 60 + t);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

const exp = (u: number, mean: number) => -Math.log(1 - u) * mean;

/** 時間帯の重みに沿って、受付時間内の到着時刻を 1 つ選ぶ */
function arrivalTime(u: number, v: number, closeAt: number): number {
  const total = HOURLY_WEIGHT.reduce((a, w) => a + w, 0);
  let x = u * total;
  const hours = HOURLY_WEIGHT.length;
  for (let h = 0; h < hours; h++) {
    if (x < HOURLY_WEIGHT[h]) return ((h + v) / hours) * closeAt;
    x -= HOURLY_WEIGHT[h];
  }
  return closeAt * v;
}

/**
 * その日の電話を作る。乱数は seed だけで決まるので、
 * 2 つの世界には同じ時刻に同じ用件の同じ人から電話がかかる。
 * 掛け直すかどうかも先に決めておく (cap の世界でしか使わない)。
 */
function makeCalls(p: SimParams): { calls: Call[]; callbacks: Map<number, number[]> } {
  const rng = mulberry32(p.seed);
  const calls: Call[] = [];
  const callbacks = new Map<number, number[]>();
  for (let i = 0; i < p.calls; i++) {
    const tArrive = arrivalTime(rng(), rng(), p.closeAt);
    const harass = rng() < p.harassRatio;
    const svc = p.serviceMin + exp(rng(), p.serviceMean - p.serviceMin);
    const hneed = p.harassMin + exp(rng(), p.harassMean - p.harassMin);
    const patience = exp(rng(), p.patienceMean);
    // 掛け直しの判定と間隔 (1 回ごとに [掛け直すか, 何分後か])
    const cb: number[] = [];
    for (let k = 0; k < MAX_ATTEMPTS; k++) {
      const again = rng() < p.callbackProb;
      const delay = p.callbackDelay[0] + rng() * (p.callbackDelay[1] - p.callbackDelay[0]);
      cb.push(again ? delay : -1);
    }
    calls.push({
      id: 0,
      harass,
      tArrive,
      patience: harass ? Infinity : patience,
      need: harass ? hneed : svc,
      attempt: 1,
      origin: 0,
      tStart: -1,
      tEnd: -1,
      op: -1,
      state: "pending",
    });
    if (harass) callbacks.set(i, cb);
  }
  // 到着順に並べて id を振り直す
  const order = calls.map((c, i) => ({ c, i })).sort((a, b) => a.c.tArrive - b.c.tArrive);
  const sorted: Call[] = [];
  const cbById = new Map<number, number[]>();
  order.forEach(({ c, i }, k) => {
    c.id = k;
    c.origin = k;
    sorted.push(c);
    const cb = callbacks.get(i);
    if (cb) cbById.set(k, cb);
  });
  return { calls: sorted, callbacks: cbById };
}

/** 掛け直しの予定 (cap の世界)。SimState に持たせると比較が重くなるので外に置く */
const callbackPlans = new WeakMap<SimState, Map<number, number[]>>();

export function createSim(params: SimParams, policy: Policy): SimState {
  const { calls, callbacks } = makeCalls(params);
  const s: SimState = {
    policy,
    params,
    t: 0,
    calls,
    next: 0,
    queue: [],
    ops: Array.from({ length: params.operators }, () => ({
      state: "idle" as OpState,
      call: -1,
      until: 0,
      stress: 0,
      harassMin: 0,
      tLeft: -1,
    })),
    staffedMin: 0,
    maxWaiting: 0,
    series: [{ t: 0, waiting: 0, abandoned: 0 }],
  };
  callbackPlans.set(s, callbacks);
  return s;
}

/** 掛け直しの電話を、到着時刻の順を保ったまま未着信の列に差し込む */
function insertPending(s: SimState, c: Call) {
  let j = s.next;
  while (j < s.calls.length && s.calls[j].tArrive <= c.tArrive) j++;
  s.calls.splice(j, 0, c);
  // s.calls[i].id === i を保つ。動くのは未着信の電話だけなので、列や席の参照は崩れない
  for (let i = j; i < s.calls.length; i++) s.calls[i].id = i;
}

/** 通話を終える。cap の世界で切ったカスハラの電話は掛け直してくることがある */
function endCall(s: SimState, opIdx: number) {
  const p = s.params;
  const op = s.ops[opIdx];
  const c = s.calls[op.call];
  c.state = "done";
  c.tEnd = op.until;
  op.call = -1;
  if (!c.harass) {
    op.state = "wrapup";
    op.until = c.tEnd + p.wrapupMin;
    return;
  }
  // カスハラ対応のあと: 負担が限界なら早退、そうでなければ席を離れて落ち着く
  if (op.stress >= p.stressLimit) {
    op.state = "left";
    op.tLeft = c.tEnd;
  } else {
    op.state = "recover";
    op.until = c.tEnd + p.recoverMin;
    op.harassMin += p.recoverMin;
  }
  const talked = c.tEnd - c.tStart;
  const remaining = c.need - talked;
  if (s.policy === "cap" && remaining > 0.01) {
    const plan = callbackPlans.get(s)?.get(c.origin);
    const delay = plan?.[c.attempt - 1] ?? -1;
    const tArrive = c.tEnd + delay;
    if (delay >= 0 && tArrive < p.closeAt) {
      insertPending(s, {
        id: -1,
        harass: true,
        tArrive,
        patience: Infinity,
        need: remaining,
        attempt: c.attempt + 1,
        origin: c.origin,
        tStart: -1,
        tEnd: -1,
        op: -1,
        state: "pending",
      });
    }
  }
}

function talkLength(s: SimState, c: Call): number {
  if (c.harass && s.policy === "cap") return Math.min(c.need, s.params.capMin);
  return c.need;
}

/** シミュレーションを dt 分進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.durationMin) return;
  const t = s.t;

  // 通話・後処理・休憩が終わる
  for (let i = 0; i < s.ops.length; i++) {
    const op = s.ops[i];
    if (op.state === "talking" && op.until <= t) endCall(s, i);
    if ((op.state === "wrapup" || op.state === "recover") && op.until <= t) op.state = "idle";
  }

  // 着信
  while (s.next < s.calls.length && s.calls[s.next].tArrive <= t) {
    const c = s.calls[s.next];
    c.state = "waiting";
    s.queue.push(c.id);
    s.next++;
  }

  // 待ちきれずに切る
  s.queue = s.queue.filter((id) => {
    const c = s.calls[id];
    if (t - c.tArrive >= c.patience) {
      c.state = "abandoned";
      c.tEnd = c.tArrive + c.patience;
      return false;
    }
    return true;
  });

  // 空いたオペレーターが着信順に出る
  for (let i = 0; i < s.ops.length && s.queue.length > 0; i++) {
    const op = s.ops[i];
    if (op.state !== "idle") continue;
    const c = s.calls[s.queue.shift()!];
    c.state = "talking";
    c.tStart = t;
    c.op = i;
    op.state = "talking";
    op.call = c.id;
    op.until = t + talkLength(s, c);
  }

  // 負担の出入り
  for (const op of s.ops) {
    if (op.state === "left") continue;
    s.staffedMin += dt;
    if (op.state === "talking" && s.calls[op.call].harass) {
      op.stress += dt;
      op.harassMin += dt;
    } else {
      op.stress = Math.max(0, op.stress - p.stressDecay * dt);
    }
  }

  s.t += dt;

  if (s.queue.length > s.maxWaiting) s.maxWaiting = s.queue.length;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= SERIES_STEP) {
    s.series.push({ t: s.t, waiting: s.queue.length, abandoned: countAbandoned(s) });
  }
}

function countAbandoned(s: SimState): number {
  let n = 0;
  for (const c of s.calls) if (c.state === "abandoned") n++;
  return n;
}

export function isFinished(s: SimState): boolean {
  if (s.t >= s.params.durationMin) return true;
  if (s.t < s.params.closeAt) return false;
  return s.next >= s.calls.length && s.queue.length === 0 && s.ops.every((o) => o.state !== "talking");
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

/** 着信からつながる (または切る) までの時間。まだ待っていれば今までの分 */
export function waitOf(c: Call, t: number): number {
  if (c.state === "pending") return 0;
  if (c.state === "waiting") return Math.max(0, t - c.tArrive);
  if (c.state === "abandoned") return c.patience;
  return Math.max(0, c.tStart - c.tArrive);
}

export function getStats(s: SimState): SimStats {
  let arrived = 0;
  let answered = 0;
  let abandoned = 0;
  let quick = 0;
  let sumWait = 0;
  let harassCalls = 0;
  for (const c of s.calls) {
    if (c.state === "pending") continue;
    if (c.harass) {
      harassCalls++;
      continue;
    }
    arrived++;
    sumWait += waitOf(c, s.t);
    if (c.state === "abandoned") abandoned++;
    else if (c.state === "talking" || c.state === "done") {
      answered++;
      if (c.tStart - c.tArrive <= QUICK_MIN) quick++;
    }
  }
  const harassMin = s.ops.reduce((a, o) => a + o.harassMin, 0);
  return {
    t: s.t,
    arrived,
    answered,
    abandoned,
    waiting: s.queue.length,
    maxWaiting: s.maxWaiting,
    avgWait: arrived > 0 ? sumWait / arrived : 0,
    within3: arrived > 0 ? quick / arrived : 0,
    abandonRate: arrived > 0 ? abandoned / arrived : 0,
    harassCalls,
    harassMin,
    harassShare: s.staffedMin > 0 ? Math.min(1, harassMin / s.staffedMin) : 0,
    leftOps: s.ops.filter((o) => o.state === "left").length,
  };
}

/** 同じシナリオを両方のやり方で、seed を変えて何回も回した平均 */
export interface AggregateStats {
  runs: number;
  avgWait: number;
  within3: number;
  abandonRate: number;
  maxWaiting: number;
  harassCalls: number;
  harassMin: number;
  harassShare: number;
  leftOps: number;
  /** 1 人以上が早退した日の割合 */
  leftDays: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc: AggregateStats = {
    runs,
    avgWait: 0,
    within3: 0,
    abandonRate: 0,
    maxWaiting: 0,
    harassCalls: 0,
    harassMin: 0,
    harassShare: 0,
    leftOps: 0,
    leftDays: 0,
  };
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    acc.avgWait += st.avgWait;
    acc.within3 += st.within3;
    acc.abandonRate += st.abandonRate;
    acc.maxWaiting += st.maxWaiting;
    acc.harassCalls += st.harassCalls;
    acc.harassMin += st.harassMin;
    acc.harassShare += st.harassShare;
    acc.leftOps += st.leftOps;
    acc.leftDays += st.leftOps > 0 ? 1 : 0;
  }
  for (const k of [
    "avgWait",
    "within3",
    "abandonRate",
    "maxWaiting",
    "harassCalls",
    "harassMin",
    "harassShare",
    "leftOps",
    "leftDays",
  ] as const) {
    acc[k] /= runs;
  }
  return acc;
}
