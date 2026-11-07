/**
 * 管理者の鍵 (権限) を盗まれたときの被害の広がり: 純粋な計算モデル。
 *
 * 単位は「時間 (h)」。1 つのクラウドサービスの顧客サーバーを 400 マスで表し、
 * 攻撃者が 1 台の顧客サーバーから入り込み、管理者の鍵を盗み、管理サーバー経由で
 * 顧客サーバーにマルウェアを配っていく様子を動かす。
 * 「鍵を区画ごとに分ける」「多要素認証」「管理ログインの見張り」を入れ替えて、
 * 同じ攻撃者・同じ乱数のまま、被害がどこで止まるかを比べる。描画や React に依存しない。
 */

/** マスの数 (20 × 20) */
export const GRID = 20;
export const CELLS = GRID * GRID;
/** 今回影響の可能性があるとされたサーバー数。1 マスあたりの台数の換算に使う */
export const REAL_SERVERS = 26739;
export const SERVERS_PER_CELL = REAL_SERVERS / CELLS;

/** 区画の数として選べる値 (400 を割り切れる数) */
export const SEGMENT_OPTIONS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40] as const;

export interface Policy {
  name: string;
  /** 管理者の鍵を区画に分けるか。false なら 1 本の鍵で全サーバーに届く */
  split: boolean;
  /** 管理者のログインに多要素認証をかける */
  mfa: boolean;
  /** 管理者アカウントの不審な使い方を見張る */
  monitor: boolean;
}

export interface SimParams {
  /** 区画分けするときの区画の数 */
  segments: number;
  /** 入り込んでから最初の管理者の鍵を盗むまでの平均日数 */
  stealDays: number;
  /** 最初の鍵を手に入れてから、マルウェアを配り始めるまでの準備日数 */
  prepDays: number;
  /** 1 日にマルウェアを入れられるマス数 (届く範囲に残っている限り) */
  spreadPerDay: number;
  /** 鍵を 1 本持っている攻撃者が、別の区画の鍵を盗むまでの平均日数 */
  jumpDays: number;
  /** 多要素認証をかけたとき、鍵を盗む速さが何倍になるか (0.2 なら 5 倍時間がかかる) */
  mfaFactor: number;
  /** 見張りが、管理者の鍵が使われ続けているのに気づくまでの平均日数 */
  monitorDays: number;
  /** 見張りがあるとき、鍵を盗まれた瞬間の不審なログインで気づく確率 */
  loginAlertProb: number;
  /** マルウェアを入れられた 1 マスが、1 日のうちに顧客に気づかれて問い合わせが来る確率 */
  customerNoticePerCellDay: number;
  /** 観察する日数 */
  horizonDays: number;
  seed: number;
}

export type Phase = "foothold" | "prep" | "spread" | "detected" | "end";

export interface SimState {
  params: SimParams;
  policy: Policy;
  /** 経過時間 (h) */
  t: number;
  rng: () => number;
  /** 実際に使う区画の数 (分けないなら 1) */
  k: number;
  /** 各マスの区画番号 */
  segmentOf: number[];
  /** 攻撃者が最初に入り込んだ顧客サーバーのマス */
  foothold: number;
  /** 各区画の鍵を手に入れた時刻 (h)。まだなら -1 */
  keyAt: number[];
  /** 各マスにマルウェアを入れられた時刻 (h)。まだなら -1 */
  infectedAt: number[];
  firstKeyAt: number;
  detectedAt: number;
  /** 何で気づいたか */
  detectedBy: "" | "login" | "monitor" | "customer";
  spreadAcc: number;
  infected: number;
  /** 日ごとの記録 */
  series: SeriesPoint[];
}

export interface SeriesPoint {
  day: number;
  /** マルウェアを入れられたマス */
  infected: number;
  /** 盗まれた鍵が届くマス (見られた・止める必要がある範囲) */
  reachable: number;
}

export const DT = 1;

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

export function segmentCount(params: SimParams, policy: Policy): number {
  return policy.split ? Math.max(1, Math.min(CELLS, Math.round(params.segments))) : 1;
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const rng = mulberry32(params.seed);
  const k = segmentCount(params, policy);
  const size = CELLS / k;
  const segmentOf = Array.from({ length: CELLS }, (_, i) => Math.min(k - 1, Math.floor(i / size)));
  // 入り込む場所は方針によらず同じにする (同じ乱数の最初の 1 回)
  const foothold = Math.floor(rng() * CELLS);
  const s: SimState = {
    params,
    policy,
    t: 0,
    rng,
    k,
    segmentOf,
    foothold,
    keyAt: new Array(k).fill(-1),
    infectedAt: new Array(CELLS).fill(-1),
    firstKeyAt: -1,
    detectedAt: -1,
    detectedBy: "",
    spreadAcc: 0,
    infected: 0,
    series: [{ day: 0, infected: 0, reachable: 0 }],
  };
  return s;
}

export function phase(s: SimState): Phase {
  if (s.detectedAt >= 0) return "detected";
  if (s.t >= s.params.horizonDays * 24) return "end";
  if (s.firstKeyAt < 0) return "foothold";
  if (s.t < s.firstKeyAt + s.params.prepDays * 24) return "prep";
  return "spread";
}

export function isFinished(s: SimState): boolean {
  const ph = phase(s);
  return ph === "detected" || ph === "end";
}

/** 盗まれた鍵が届くマスの数 */
export function reachableCells(s: SimState): number {
  let keys = 0;
  for (const at of s.keyAt) if (at >= 0) keys++;
  return (keys * CELLS) / s.k;
}

export function keysStolen(s: SimState): number {
  let n = 0;
  for (const at of s.keyAt) if (at >= 0) n++;
  return n;
}

function hazard(perDay: number, dt: number): number {
  return 1 - Math.exp(-(perDay / 24) * dt);
}

function detect(s: SimState, by: "login" | "monitor" | "customer") {
  if (s.detectedAt >= 0) return;
  s.detectedAt = s.t;
  s.detectedBy = by;
}

function grantKey(s: SimState, seg: number) {
  s.keyAt[seg] = s.t;
  if (s.firstKeyAt < 0) s.firstKeyAt = s.t;
  // 見張りがあれば、不審なログインの警報で気づくことがある
  if (s.policy.monitor && s.rng() < s.params.loginAlertProb) detect(s, "login");
}

/** 1 ステップ (dt 時間) 進める */
export function step(s: SimState, dt: number = DT) {
  if (isFinished(s)) return;
  const p = s.params;
  const pol = s.policy;
  const speed = pol.mfa ? p.mfaFactor : 1;
  // 乱数の消費順を方針によらずそろえるため、毎ステップ同じ回数だけ引く
  const uSteal = s.rng();
  const uJump = s.rng();
  const uJumpSeg = s.rng();
  const uMonitor = s.rng();
  const uCustomer = s.rng();

  s.t += dt;

  if (s.firstKeyAt < 0) {
    // 1. 入り込んだ顧客サーバーから、管理者の鍵を盗もうとする
    if (uSteal < hazard(speed / p.stealDays, dt)) {
      // 最初に手に入るのは、入り込んだサーバーを管理する区画の鍵
      grantKey(s, s.segmentOf[s.foothold]);
    }
  } else {
    // 2. 別の区画の鍵を探す (全部持っていれば何もしない)
    const missing: number[] = [];
    for (let i = 0; i < s.k; i++) if (s.keyAt[i] < 0) missing.push(i);
    if (missing.length > 0 && uJump < hazard(speed / p.jumpDays, dt)) {
      grantKey(s, missing[Math.floor(uJumpSeg * missing.length)]);
    }
    // 3. 見張りは、管理者の鍵が使われ続けていることにいつか気づく
    if (pol.monitor && uMonitor < hazard(1 / p.monitorDays, dt)) detect(s, "monitor");
  }

  // 4. 準備が終わったら、鍵が届く範囲の顧客サーバーにマルウェアを配る
  if (s.detectedAt < 0 && s.firstKeyAt >= 0 && s.t >= s.firstKeyAt + p.prepDays * 24) {
    s.spreadAcc += (p.spreadPerDay / 24) * dt;
    while (s.spreadAcc >= 1) {
      const targets: number[] = [];
      for (let i = 0; i < CELLS; i++) {
        if (s.infectedAt[i] < 0 && s.keyAt[s.segmentOf[i]] >= 0) targets.push(i);
      }
      if (targets.length === 0) {
        s.spreadAcc = 0;
        break;
      }
      const c = targets[Math.floor(s.rng() * targets.length)];
      s.infectedAt[c] = s.t;
      s.infected++;
      s.spreadAcc -= 1;
    }
  }

  // 5. マルウェアを入れられた顧客が異変に気づき、問い合わせてくる
  if (s.infected > 0 && uCustomer < hazard(p.customerNoticePerCellDay * s.infected, dt)) detect(s, "customer");

  if (s.t % 24 === 0 || isFinished(s)) {
    const day = s.t / 24;
    const last = s.series[s.series.length - 1];
    const pt = { day, infected: s.infected, reachable: reachableCells(s) };
    if (last.day === day) s.series[s.series.length - 1] = pt;
    else s.series.push(pt);
  }
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export interface SimStats {
  /** 経過日数 */
  day: number;
  /** 入り込んでから気づくまでの日数 (気づかなければ観察日数) */
  dwellDays: number;
  detected: boolean;
  /** 最初の鍵を盗まれた日 (まだなら -1) */
  firstKeyDay: number;
  /** マルウェアを入れられたサーバー (実際の台数に換算) */
  infectedServers: number;
  /** 盗まれた鍵が届くサーバー = 中を見られた可能性があり、止めて調べる必要がある (換算) */
  reachableServers: number;
  keysStolen: number;
  keys: number;
}

export function getStats(s: SimState): SimStats {
  const end = s.detectedAt >= 0 ? s.detectedAt : s.t;
  return {
    day: s.t / 24,
    dwellDays: end / 24,
    detected: s.detectedAt >= 0,
    firstKeyDay: s.firstKeyAt >= 0 ? s.firstKeyAt / 24 : -1,
    infectedServers: s.infected * SERVERS_PER_CELL,
    reachableServers: reachableCells(s) * SERVERS_PER_CELL,
    keysStolen: keysStolen(s),
    keys: s.k,
  };
}

export interface AggregateStats {
  runs: number;
  /** 平均 */
  mean: SimStats;
  /** 観察期間内に気づいた割合 */
  detectedRate: number;
  /** マルウェアを入れられたサーバーの、悪いほうから 1 割の値 (90 パーセンタイル) */
  infectedP90: number;
  /** 1 マスも入れられないうちに気づいた割合 */
  zeroInfectedRate: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const mean: SimStats = {
    day: 0,
    dwellDays: 0,
    detected: false,
    firstKeyDay: 0,
    infectedServers: 0,
    reachableServers: 0,
    keysStolen: 0,
    keys: segmentCount(params, policy),
  };
  let detected = 0;
  let zero = 0;
  const inf: number[] = [];
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    mean.day += st.day / runs;
    mean.dwellDays += st.dwellDays / runs;
    mean.infectedServers += st.infectedServers / runs;
    mean.reachableServers += st.reachableServers / runs;
    mean.keysStolen += st.keysStolen / runs;
    mean.firstKeyDay += Math.max(0, st.firstKeyDay) / runs;
    if (st.detected) detected++;
    if (st.infectedServers === 0) zero++;
    inf.push(st.infectedServers);
  }
  inf.sort((a, b) => a - b);
  const p90 = inf[Math.min(inf.length - 1, Math.floor(inf.length * 0.9))];
  return { runs, mean, detectedRate: detected / runs, infectedP90: p90, zeroInfectedRate: zero / runs };
}
