/**
 * 物流センターのトラック荷待ちシミュレーション: 純粋な計算モデル。
 *
 * 単位は「分」。t = 0 が朝 6:00。描画や React に依存しないので、
 * ブラウザでも Node のテストでも同じコードが動く。
 */

export type Policy = "firstCome" | "reservation";
export type TruckState = "enroute" | "waiting" | "docked" | "done";

export interface Truck {
  id: number;
  /** 荷主が指定した納品時間帯 (午前便 / 午後便) */
  am: boolean;
  /** 荷降ろし・検品にかかる時間 (分) */
  service: number;
  /** 予約制の世界で予約を取ったか (取らないトラックは飛び込み) */
  booked: boolean;
  /** 予約枠の開始時刻 (分)。予約していなければ -1 */
  slot: number;
  /** 予約枠 + 猶予に間に合わず、予約の優先権を失った */
  lost: boolean;
  /** 渋滞などで遅れた分 (分)。0 なら遅れなし */
  delay: number;
  tArrive: number;
  tDock: number;
  tDone: number;
  /** どのバースで作業しているか (docked のときのみ) */
  berth: number;
  state: TruckState;
}

export interface SimParams {
  /** その日に来るトラックの台数 */
  trucks: number;
  /** 荷降ろし場 (バース) の数 */
  berths: number;
  serviceMin: number;
  serviceMax: number;
  /** 荷受けを始める時刻 (分) */
  openAt: number;
  /** 午前便の割合 */
  amRatio: number;
  /** 午前便・午後便の納品時間帯 [開始, 終了) (分) */
  amWindow: [number, number];
  pmWindow: [number, number];
  /** 先着順のとき、時間帯の始まりより前に来て並んでおくドライバーの割合 */
  rushRatio: number;
  /** その人たちが何分前までに来るか (0〜この値で一様) */
  rushLeadMax: number;
  /** 渋滞などで大きく遅れるトラックの割合と、遅れの平均 (分) */
  lateProb: number;
  lateMean: number;
  /** 予約制の世界で予約を取らないトラックの割合 */
  walkInRatio: number;
  /** 予約車は枠の何分前に着くように出発するか */
  earlyMin: number;
  /** 枠の開始から何分遅れまでなら予約が有効か */
  graceMin: number;
  /** 予約枠の詰め方 (1 = 能力いっぱい、0.9 = 1 割の余裕) */
  slotUtil: number;
  /** 予約車がこの分数以内に来る予定なら、飛び込みにバースを渡さず空けておく */
  protectMin: number;
  durationMin: number;
  seed: number;
}

export interface SeriesPoint {
  t: number;
  /** 構内・路上で待っている台数 */
  waiting: number;
  /** 荷降ろしが終わった台数 (累計) */
  done: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  trucks: Truck[];
  /** バースごとに作業中のトラック id (空きは 0) */
  berths: number[];
  busyMinutes: number;
  maxWaiting: number;
  series: SeriesPoint[];
}

export interface SimStats {
  t: number;
  arrived: number;
  done: number;
  waiting: number;
  maxWaiting: number;
  /** 着いてからバースにつくまでの平均 (分)。まだ待っているトラックは今までの待ち時間で数える */
  avgWait: number;
  /** 予約を取らなかったトラックだけの平均待ち (予約制のみ意味がある) */
  avgWaitWalkIn: number;
  maxWait: number;
  /** 荷待ち + 荷役が 2 時間を超えたトラックの割合 (着いたトラックのうち) */
  over2h: number;
  /** 指定の納品時間帯が終わってからバースについたトラックの割合 (着いたトラックのうち) */
  missWindow: number;
  /** 最後のトラックが作業を終えた時刻 (分)。まだ残っていれば -1 */
  lastDone: number;
  /** バースが作業していた時間の割合 (荷受け開始から最後の完了まで) */
  utilization: number;
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

export const DT = 1;
/** series に点を足す間隔 (分) */
export const SERIES_STEP = 5;
/** t = 0 の時計の時刻 (時) */
export const DAY_START_HOUR = 6;
/** 荷待ち + 荷役の目安 (国の「2 時間ルール」) */
export const LIMIT_MIN = 120;

export function clock(t: number): string {
  const total = Math.round(DAY_START_HOUR * 60 + t);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function slotInterval(p: SimParams): number {
  return (p.serviceMin + p.serviceMax) / 2 / p.berths / p.slotUtil;
}

/**
 * その日のトラックを作る。乱数は seed だけで決まるので、
 * 2 つの世界には同じ荷主・同じ荷物・同じ渋滞のトラックが来る。
 */
function makeTrucks(p: SimParams, policy: Policy): Truck[] {
  const rng = mulberry32(p.seed);
  const draws = Array.from({ length: p.trucks }, () => ({
    am: rng() < p.amRatio,
    service: p.serviceMin + rng() * (p.serviceMax - p.serviceMin),
    rusher: rng() < p.rushRatio,
    rushU: rng(),
    posU: rng(),
    noise: (rng() - 0.5) * 20,
    late: rng() < p.lateProb,
    lateU: rng(),
    bookU: rng(),
  }));

  const trucks: Truck[] = draws.map((d, i) => {
    const [ws, we] = d.am ? p.amWindow : p.pmWindow;
    // 先着順: 早めに来て並ぶ人と、時間帯の中で都合のよい時刻に来る人
    const desired = d.rusher ? ws - d.rushU * p.rushLeadMax : ws + d.posU * Math.max(0, we - ws - 60);
    const delay = d.late ? -Math.log(1 - d.lateU) * p.lateMean : 0;
    return {
      id: i + 1,
      am: d.am,
      service: d.service,
      booked: policy === "reservation" && d.bookU >= p.walkInRatio,
      slot: -1,
      lost: false,
      delay,
      tArrive: desired + d.noise + delay,
      tDock: -1,
      tDone: -1,
      berth: -1,
      state: "enroute",
    };
  });

  if (policy === "reservation") {
    // 予約を取ったトラックに、能力に合わせた間隔で枠を割り当てる (午前便 → 午後便の順)
    const interval = slotInterval(p);
    let next = -Infinity;
    for (const am of [true, false]) {
      const [ws] = am ? p.amWindow : p.pmWindow;
      for (const tr of trucks) {
        if (!tr.booked || tr.am !== am) continue;
        const slot = Math.max(ws, next);
        tr.slot = slot;
        next = slot + interval;
        const d = draws[tr.id - 1];
        tr.tArrive = slot - p.earlyMin + d.noise + tr.delay;
      }
    }
  }
  return trucks;
}

export function createSim(params: SimParams, policy: Policy): SimState {
  return {
    policy,
    params,
    t: 0,
    trucks: makeTrucks(params, policy),
    berths: Array.from({ length: params.berths }, () => 0),
    busyMinutes: 0,
    maxWaiting: 0,
    series: [{ t: 0, waiting: 0, done: 0 }],
  };
}

function dock(s: SimState, tr: Truck, berth: number) {
  tr.state = "docked";
  tr.tDock = s.t;
  tr.berth = berth;
  s.berths[berth] = tr.id;
}

/** 次にバースへ入れるトラックを選ぶ。いなければ null */
function pickNext(s: SimState, waiting: Truck[], freeBerths: number): Truck | null {
  if (waiting.length === 0) return null;
  if (s.policy === "firstCome") {
    // 着いた順
    let best = waiting[0];
    for (const tr of waiting) if (tr.tArrive < best.tArrive) best = tr;
    return best;
  }
  const p = s.params;
  const reserved = (tr: Truck) => tr.booked && !tr.lost;
  // 1. 枠の時刻が来た予約車 (枠の早い順)
  // 2. 枠より早く着いている予約車 (枠の早い順)
  let best: Truck | null = null;
  for (const tr of waiting) {
    if (reserved(tr) && (!best || tr.slot < best.slot)) best = tr;
  }
  if (best) return best;
  // 3. 飛び込み・遅刻車 (着いた順)。まもなく来る予約車のぶんのバースは空けておく
  let soon = 0;
  for (const tr of s.trucks) {
    if (tr.state === "enroute" && reserved(tr) && tr.slot <= s.t + p.protectMin) soon++;
  }
  if (freeBerths <= soon) return null;
  for (const tr of waiting) if (!best || tr.tArrive < best.tArrive) best = tr;
  return best;
}

/** シミュレーションを dt 分進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.durationMin) return;

  // 作業が終わったトラックはバースを出る
  for (let b = 0; b < s.berths.length; b++) {
    const id = s.berths[b];
    if (id === 0) continue;
    const tr = s.trucks[id - 1];
    if (s.t >= tr.tDock + tr.service) {
      tr.state = "done";
      tr.tDone = tr.tDock + tr.service;
      s.berths[b] = 0;
    }
  }

  // 到着
  for (const tr of s.trucks) {
    if (tr.state === "enroute" && tr.tArrive <= s.t) {
      tr.state = "waiting";
      if (tr.booked && tr.tArrive > tr.slot + p.graceMin) tr.lost = true;
    }
  }

  // 空いたバースに入れる
  if (s.t >= p.openAt) {
    const waiting = s.trucks.filter((tr) => tr.state === "waiting");
    let free = s.berths.filter((id) => id === 0).length;
    for (let b = 0; b < s.berths.length && free > 0; b++) {
      if (s.berths[b] !== 0) continue;
      const tr = pickNext(s, waiting, free);
      if (!tr) break;
      dock(s, tr, b);
      waiting.splice(waiting.indexOf(tr), 1);
      free--;
    }
  }

  for (const id of s.berths) if (id !== 0) s.busyMinutes += dt;
  s.t += dt;

  const waitingCount = countWaiting(s);
  if (waitingCount > s.maxWaiting) s.maxWaiting = waitingCount;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= SERIES_STEP) {
    s.series.push({ t: s.t, waiting: waitingCount, done: countDone(s) });
  }
}

function countWaiting(s: SimState): number {
  let n = 0;
  for (const tr of s.trucks) if (tr.state === "waiting") n++;
  return n;
}

function countDone(s: SimState): number {
  let n = 0;
  for (const tr of s.trucks) if (tr.state === "done") n++;
  return n;
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationMin || s.trucks.every((tr) => tr.state === "done");
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

/** 着いてからバースにつくまでの時間。まだ待っていれば今までの分 */
export function waitOf(tr: Truck, t: number): number {
  if (tr.state === "enroute") return 0;
  if (tr.state === "waiting") return Math.max(0, t - tr.tArrive);
  return Math.max(0, tr.tDock - tr.tArrive);
}

/** 荷待ち + 荷役 (いまの時点まで) */
export function boundOf(tr: Truck, t: number): number {
  if (tr.state === "enroute") return 0;
  if (tr.state === "done") return tr.tDone - tr.tArrive;
  return Math.max(0, t - tr.tArrive);
}

/** 指定の時間帯が終わるまでにバースにつけなかった (いまの時点で) */
export function missedWindow(tr: Truck, p: SimParams, t: number): boolean {
  if (tr.state === "enroute") return false;
  const end = tr.am ? p.amWindow[1] : p.pmWindow[1];
  return tr.state === "waiting" ? t > end : tr.tDock > end;
}

export function getStats(s: SimState): SimStats {
  const arrived = s.trucks.filter((tr) => tr.state !== "enroute");
  const walkIns = arrived.filter((tr) => !tr.booked);
  const done = s.trucks.filter((tr) => tr.state === "done");
  const sumWait = arrived.reduce((a, tr) => a + waitOf(tr, s.t), 0);
  const sumWaitWalkIn = walkIns.reduce((a, tr) => a + waitOf(tr, s.t), 0);
  const maxWait = arrived.reduce((a, tr) => Math.max(a, waitOf(tr, s.t)), 0);
  const over = arrived.filter((tr) => boundOf(tr, s.t) > LIMIT_MIN).length;
  const missed = arrived.filter((tr) => missedWindow(tr, s.params, s.t)).length;
  const allDone = done.length === s.trucks.length;
  const lastDone = allDone ? done.reduce((a, tr) => Math.max(a, tr.tDone), 0) : -1;
  const end = allDone ? lastDone : s.t;
  const span = (end - s.params.openAt) * s.params.berths;
  return {
    t: s.t,
    arrived: arrived.length,
    done: done.length,
    waiting: countWaiting(s),
    maxWaiting: s.maxWaiting,
    avgWait: arrived.length > 0 ? sumWait / arrived.length : 0,
    avgWaitWalkIn: walkIns.length > 0 ? sumWaitWalkIn / walkIns.length : 0,
    maxWait,
    over2h: arrived.length > 0 ? over / arrived.length : 0,
    missWindow: arrived.length > 0 ? missed / arrived.length : 0,
    lastDone,
    utilization: span > 0 ? Math.min(1, s.busyMinutes / span) : 0,
  };
}

/** 同じシナリオを両方のやり方で、seed を変えて何回も回した平均 */
export interface AggregateStats {
  runs: number;
  avgWait: number;
  avgWaitWalkIn: number;
  maxWait: number;
  maxWaiting: number;
  over2h: number;
  missWindow: number;
  /** 最後の完了時刻の平均 (分)。終わらなかった日は durationMin として数える */
  lastDone: number;
  /** 終業時刻までに終わらなかった日の割合 */
  unfinished: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc: AggregateStats = {
    runs,
    avgWait: 0,
    avgWaitWalkIn: 0,
    maxWait: 0,
    maxWaiting: 0,
    over2h: 0,
    missWindow: 0,
    lastDone: 0,
    unfinished: 0,
  };
  for (let i = 0; i < runs; i++) {
    const s = runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy));
    const st = getStats(s);
    acc.avgWait += st.avgWait;
    acc.avgWaitWalkIn += st.avgWaitWalkIn;
    acc.maxWait += st.maxWait;
    acc.maxWaiting += st.maxWaiting;
    acc.over2h += st.over2h;
    acc.missWindow += st.missWindow;
    acc.lastDone += st.lastDone >= 0 ? st.lastDone : params.durationMin;
    acc.unfinished += st.lastDone >= 0 ? 0 : 1;
  }
  for (const k of ["avgWait", "avgWaitWalkIn", "maxWait", "maxWaiting", "over2h", "missWindow", "lastDone", "unfinished"] as const) {
    acc[k] /= runs;
  }
  return acc;
}
