/**
 * 免税の「リファンド方式」の空港シミュレーション: 純粋な計算モデル。
 *
 * 単位は「秒」。免税で買い物をした訪日客が国際線の出発ロビーに着き、
 * チェックインの前に 税関確認の端末 → (赤判定なら) 税関の検査 を通る。
 * チェックインの締め切りまでに終わらなければ、返金をあきらめて搭乗に向かう。
 * 検査の割合・選び方・検査員の数・スマホでの事前申告を入れ替えて比べる。
 * 描画や React に依存しない。
 */

export interface Policy {
  name: string;
  /** 端末が「検査が必要 (赤)」と判定する割合 (無作為に選ぶ分) */
  redRate: number;
  /** 購入額が TARGET_YEN 以上の人は必ず赤にする (重点検査) */
  targeted: boolean;
  /** スマホで事前に申告して、端末に並ばずに済む人の割合 */
  onlineShare: number;
  /** シナリオの検査員に足す人数 */
  extraInspectors: number;
}

export interface SimParams {
  /** 免税品を持って出国する人 (人/時、平均)。パスポート 1 冊 = 1 人 */
  arrivalsPerHour: number;
  /** 到着の波の大きさ (0 なら一定。0.8 なら平均の 0.2〜1.8 倍で揺れる) */
  waveAmp: number;
  /** 到着の波の周期 (秒) */
  wavePeriodSec: number;
  /** 税関確認の端末の台数 */
  kiosks: number;
  /** 端末 1 人あたりの平均時間 (秒)。パスポートを置き、購入記録を確かめる */
  kioskSec: number;
  /** 検査場所の検査員 (同時に検査できる人数) */
  inspectors: number;
  /** 免税手続きに使える時間の最短 (分)。これを過ぎるとチェックインに間に合わない */
  slackMinMin: number;
  /** 最短から先の余裕の平均 (分、指数分布) */
  slackExtraMin: number;
  durationSec: number;
  seed: number;
}

/** 購入額 (税込) の分布: 対数正規。中央値 3 万円、平均は約 4.5 万円 */
export const PURCHASE_MEDIAN = 30000;
export const PURCHASE_SIGMA = 0.9;
/** 重点検査で必ず赤にする購入額 (税込) */
export const TARGET_YEN = 100000;
/** 重点検査のときに、それ以外の人から無作為に赤にする割合 */
export const TARGET_RANDOM = 0.02;
/** 検査 1 件の基本時間 (秒)。呼ばれて、かばんを開けて、閉める */
export const INSPECT_BASE_SEC = 180;
/** 購入額 1 万円あたりの検査の上乗せ (秒)。レシートと品物を 1 つずつ照らし合わせる */
export const INSPECT_PER_10K_SEC = 25;
/** 検査 1 件の上限 (秒) */
export const INSPECT_MAX_SEC = 1200;
/** スマホで事前申告した人が、端末の代わりに係員に QR を見せる時間 (秒) */
export const ONLINE_SEC = 10;
/** 返金されるのは税込額のうち消費税の分 (10%) */
export const TAX_SHARE = 10 / 110;

export type Stage = "kioskQ" | "kiosk" | "inspectQ" | "inspect" | "done" | "gaveUp";

export interface Traveler {
  id: number;
  tArrive: number;
  /** この時刻までに手続きを始められなければ、あきらめて搭乗へ */
  tDeadline: number;
  /** 購入額 (税込、円) */
  amount: number;
  online: boolean;
  red: boolean;
  stage: Stage;
  /** 端末の列を離れた時刻 (端末に着いた / 事前申告で通った) */
  tKiosk: number;
  /** 検査の列に入った時刻 */
  tInspectQ: number;
  /** 検査を始めた時刻 */
  tInspect: number;
  tDone: number;
}

export interface Server {
  /** 使っている人の id (空いていれば 0) */
  who: number;
  since: number;
  until: number;
}

export interface SeriesPoint {
  t: number;
  /** 端末の前で待っている人 */
  kiosk: number;
  /** 検査を待っている人 */
  inspect: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  people: Traveler[];
  kioskQueue: number[];
  inspectQueue: number[];
  kiosks: Server[];
  inspectors: Server[];
  series: SeriesPoint[];
  nextId: number;
  /** 最後の数人 (描画用): 終わった人 / あきらめた人 */
  recentDone: number[];
  recentGaveUp: number[];
  maxInspectQueue: number;
  maxKioskQueue: number;
  rng: () => number;
}

export interface SimStats {
  t: number;
  arrived: number;
  done: number;
  waitingKiosk: number;
  waitingInspect: number;
  /** 端末の前の平均待ち (事前申告の人を除く)。まだ待っている人はここまでの分 */
  avgKioskWait: number;
  /** 赤判定の人の、検査の前の平均待ち */
  avgInspectWait: number;
  /** 赤判定の人が手続きを終えるまでの平均 (到着から) */
  avgRedTotal: number;
  /** 手続きを終えた人の、到着から終わるまでの平均 */
  avgTotal: number;
  /** 赤判定の割合 */
  redShare: number;
  /** 返金をあきらめて搭乗した人 */
  gaveUp: number;
  gaveUpRate: number;
  /** あきらめた人が受け取れなかった返金額 (円) */
  lostRefund: number;
  /** 検査を終えた品物の購入額が、全体の購入額に占める割合 (転売の抑止の目安) */
  inspectedValueShare: number;
  maxKioskQueue: number;
  maxInspectQueue: number;
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

function normal(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function drawAmount(rng: () => number): number {
  return Math.round(PURCHASE_MEDIAN * Math.exp(PURCHASE_SIGMA * normal(rng)));
}

/** 購入額が x 円以上の人の割合 (対数正規の上側確率) */
export function shareAbove(x: number): number {
  const z = Math.log(x / PURCHASE_MEDIAN) / PURCHASE_SIGMA;
  // 標準正規の上側確率 (Abramowitz-Stegun 26.2.17)
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

/** この方針で赤判定になる人の割合 (期待値) */
export function expectedRedShare(policy: Policy): number {
  if (!policy.targeted) return policy.redRate;
  const hi = shareAbove(TARGET_YEN);
  return hi + (1 - hi) * TARGET_RANDOM;
}

export function inspectorsFor(params: SimParams, policy: Policy): number {
  return params.inspectors + policy.extraInspectors;
}

/** 検査 1 件の時間 (秒)。購入額が大きいほどレシートと品物が多い */
export function inspectSec(amount: number, rng: () => number): number {
  const mean = INSPECT_BASE_SEC + (amount / 10000) * INSPECT_PER_10K_SEC;
  return Math.min(INSPECT_MAX_SEC, mean * (0.6 + 0.8 * rng()));
}

function kioskSec(params: SimParams, rng: () => number): number {
  // 早い人と、操作に迷う人がいる (平均は kioskSec)
  return params.kioskSec * (0.4 + 1.2 * rng());
}

export function arrivalRate(params: SimParams, t: number): number {
  const base = params.arrivalsPerHour / 3600;
  if (params.waveAmp <= 0) return base;
  return base * (1 + params.waveAmp * Math.sin((2 * Math.PI * t) / params.wavePeriodSec));
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const emptyServer = (): Server => ({ who: 0, since: 0, until: 0 });
  return {
    policy,
    params,
    t: 0,
    people: [],
    kioskQueue: [],
    inspectQueue: [],
    kiosks: Array.from({ length: params.kiosks }, emptyServer),
    inspectors: Array.from({ length: inspectorsFor(params, policy) }, emptyServer),
    series: [{ t: 0, kiosk: 0, inspect: 0 }],
    nextId: 1,
    recentDone: [],
    recentGaveUp: [],
    maxInspectQueue: 0,
    maxKioskQueue: 0,
    rng: mulberry32(params.seed),
  };
}

function poisson(rng: () => number, expected: number): number {
  let n = 0;
  let rest = expected;
  while (rest > 0) {
    if (rng() < Math.min(1, rest)) n++;
    rest -= 1;
  }
  return n;
}

function person(s: SimState, id: number): Traveler {
  return s.people[id - 1];
}

function arrive(s: SimState, dt: number) {
  const p = s.params;
  const n = poisson(s.rng, arrivalRate(p, s.t) * dt);
  for (let i = 0; i < n; i++) {
    const rng = s.rng;
    const amount = drawAmount(rng);
    const online = rng() < s.policy.onlineShare;
    const red = s.policy.targeted
      ? amount >= TARGET_YEN || rng() < TARGET_RANDOM
      : rng() < s.policy.redRate;
    const slack = (p.slackMinMin + -Math.log(Math.max(1e-12, rng())) * p.slackExtraMin) * 60;
    const tr: Traveler = {
      id: s.nextId++,
      tArrive: s.t,
      tDeadline: s.t + slack,
      amount,
      online,
      red,
      stage: "kioskQ",
      tKiosk: -1,
      tInspectQ: -1,
      tInspect: -1,
      tDone: -1,
    };
    s.people.push(tr);
    if (online) {
      // 事前申告した人は端末に並ばず、QR を見せて判定を受ける
      tr.tKiosk = s.t;
      afterKiosk(s, tr, s.t + ONLINE_SEC);
    } else {
      s.kioskQueue.push(tr.id);
    }
  }
}

/** 端末の判定のあと: 緑なら終わり、赤なら検査の列へ */
function afterKiosk(s: SimState, tr: Traveler, t: number) {
  if (!tr.red) {
    finish(s, tr, t);
    return;
  }
  tr.stage = "inspectQ";
  tr.tInspectQ = t;
  s.inspectQueue.push(tr.id);
}

function finish(s: SimState, tr: Traveler, t: number) {
  tr.stage = "done";
  tr.tDone = t;
  s.recentDone.push(tr.id);
  if (s.recentDone.length > 40) s.recentDone.shift();
}

function serve(s: SimState) {
  // 端末: 終わった人を判定に回し、空いた端末に列の先頭を入れる
  for (const k of s.kiosks) {
    if (k.who !== 0 && s.t >= k.until) {
      const tr = person(s, k.who);
      k.who = 0;
      afterKiosk(s, tr, s.t);
    }
  }
  for (const k of s.kiosks) {
    if (k.who !== 0 || s.kioskQueue.length === 0) continue;
    const id = s.kioskQueue.shift()!;
    const tr = person(s, id);
    tr.stage = "kiosk";
    tr.tKiosk = s.t;
    k.who = id;
    k.since = s.t;
    k.until = s.t + kioskSec(s.params, s.rng);
  }
  // 検査
  for (const k of s.inspectors) {
    if (k.who !== 0 && s.t >= k.until) {
      const tr = person(s, k.who);
      k.who = 0;
      finish(s, tr, s.t);
    }
  }
  for (const k of s.inspectors) {
    if (k.who !== 0 || s.inspectQueue.length === 0) continue;
    const id = s.inspectQueue.shift()!;
    const tr = person(s, id);
    tr.stage = "inspect";
    tr.tInspect = s.t;
    k.who = id;
    k.since = s.t;
    k.until = s.t + inspectSec(tr.amount, s.rng);
  }
}

/** チェックインの締め切りが来た人は、列を離れて搭乗へ (返金はあきらめる) */
function giveUp(s: SimState) {
  const drop = (q: number[]) => {
    if (!q.some((id) => s.t >= person(s, id).tDeadline)) return q;
    return q.filter((id) => {
      const tr = person(s, id);
      if (s.t < tr.tDeadline) return true;
      tr.stage = "gaveUp";
      tr.tDone = s.t;
      s.recentGaveUp.push(id);
      if (s.recentGaveUp.length > 40) s.recentGaveUp.shift();
      return false;
    });
  };
  s.kioskQueue = drop(s.kioskQueue);
  s.inspectQueue = drop(s.inspectQueue);
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s, dt);
  serve(s);
  // 締め切りの確認は 5 秒ごとで十分
  if (Math.round(s.t) % 5 === 0) giveUp(s);
  s.maxKioskQueue = Math.max(s.maxKioskQueue, s.kioskQueue.length);
  s.maxInspectQueue = Math.max(s.maxInspectQueue, s.inspectQueue.length);
  s.t = Math.round((s.t + dt) * 1000) / 1000;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 60 - 1e-9) {
    s.series.push({ t: Math.round(s.t), kiosk: s.kioskQueue.length, inspect: s.inspectQueue.length });
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
  let done = 0;
  let gaveUp = 0;
  let lost = 0;
  let kioskWaitSum = 0;
  let kioskN = 0;
  let inspWaitSum = 0;
  let inspN = 0;
  let redTotalSum = 0;
  let redDone = 0;
  let totalSum = 0;
  let red = 0;
  let valueAll = 0;
  let valueInspected = 0;
  for (const tr of s.people) {
    valueAll += tr.amount;
    if (tr.red) red++;
    if (!tr.online) {
      const end = tr.tKiosk >= 0 ? tr.tKiosk : tr.stage === "gaveUp" ? tr.tDone : s.t;
      kioskWaitSum += end - tr.tArrive;
      kioskN++;
    }
    if (tr.tInspectQ >= 0) {
      const tIn = tr.tInspectQ;
      const end = tr.tInspect >= 0 ? tr.tInspect : tr.stage === "gaveUp" ? tr.tDone : s.t;
      inspWaitSum += Math.max(0, end - tIn);
      inspN++;
    }
    if (tr.stage === "done") {
      done++;
      totalSum += tr.tDone - tr.tArrive;
      if (tr.red) {
        redDone++;
        redTotalSum += tr.tDone - tr.tArrive;
        valueInspected += tr.amount;
      }
    } else if (tr.stage === "gaveUp") {
      gaveUp++;
      lost += tr.amount * TAX_SHARE;
    }
  }
  const arrived = s.people.length;
  return {
    t: s.t,
    arrived,
    done,
    waitingKiosk: s.kioskQueue.length,
    waitingInspect: s.inspectQueue.length,
    avgKioskWait: kioskN > 0 ? kioskWaitSum / kioskN : 0,
    avgInspectWait: inspN > 0 ? inspWaitSum / inspN : 0,
    avgRedTotal: redDone > 0 ? redTotalSum / redDone : 0,
    avgTotal: done > 0 ? totalSum / done : 0,
    redShare: arrived > 0 ? red / arrived : 0,
    gaveUp,
    gaveUpRate: arrived > 0 ? gaveUp / arrived : 0,
    lostRefund: lost,
    inspectedValueShare: valueAll > 0 ? valueInspected / valueAll : 0,
    maxKioskQueue: s.maxKioskQueue,
    maxInspectQueue: s.maxInspectQueue,
  };
}

/** 同じシナリオを seed を変えて何回も回した平均 */
export interface AggregateStats {
  runs: number;
  stats: SimStats;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc = getStats(createSim(params, policy));
  for (const k of Object.keys(acc) as (keyof SimStats)[]) acc[k] = 0;
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    for (const k of Object.keys(acc) as (keyof SimStats)[]) acc[k] += st[k] / runs;
  }
  return { runs, stats: acc };
}
