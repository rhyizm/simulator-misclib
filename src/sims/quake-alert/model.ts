/**
 * 地震の警報シミュレーション: 純粋な計算モデル。
 *
 * ある町に 30 年間に起きる地震を 1 本の筋書きとして作り、
 * 「警報を鳴らす震度のしきい値」だけが違う世界で同時に流す。
 * 単位は「年」と「計測震度 (連続値)」。描画や React に依存しない。
 */

export type EventKind = "hit" | "false" | "miss" | "quiet";

export interface Quake {
  /** 発生時刻 (年) */
  t: number;
  /** 町で実際に観測される揺れ (計測震度) */
  intensity: number;
  /** 速報システムが出す推定震度 (誤差・誤作動を含む) */
  estimate: number;
  /** システムの誤作動で推定が大きく跳ね上がった地震 */
  glitch: boolean;
}

export interface SimParams {
  years: number;
  population: number;
  /** 揺れを感じる地震 (計測震度 2.5 以上) の 1 年あたりの回数 */
  quakesPerYear: number;
  /** 震度分布の裾の重さ。2.5 を超えた分が平均このくらいの指数分布 */
  intensityScale: number;
  /** 推定震度の誤差 (標準偏差) */
  estimateSigma: number;
  /** 1 回の地震で誤作動が起きる確率 */
  glitchProb: number;
  /** 身を守る必要がある強い揺れ (計測震度 4.5 = 震度 5 弱) */
  strongIntensity: number;
  /** 空振り 1 回で失われる信頼の割合 */
  falseAlarmPenalty: number;
  /** 見逃し 1 回で失われる信頼の割合 */
  missPenalty: number;
  /** 的中 1 回で、失った信頼のうち取り戻す割合 */
  hitRecovery: number;
  /** 何もない時期に信頼がもとの水準へ戻る速さ (1 年あたり) */
  driftPerYear: number;
  trustBase: number;
  trustInitMin: number;
  trustInitMax: number;
  seed: number;
}

export interface Policy {
  id: string;
  label: string;
  desc: string;
  /** 推定震度がこの値以上なら警報を鳴らす */
  threshold: number;
}

export interface LastEvent {
  t: number;
  kind: EventKind;
  intensity: number;
  estimate: number;
  glitch: boolean;
  /** 各住民がこの警報で身構えたか (警報が鳴らなければ全員 false) */
  acted: boolean[];
}

export interface SeriesPoint {
  t: number;
  trust: number;
  /** 強い揺れのときに身を守れなかった人の累計 */
  unprotected: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  quakes: Quake[];
  /** 次に処理する地震の番号 */
  next: number;
  t: number;
  trust: number[];
  alerts: number;
  hits: number;
  falseAlarms: number;
  misses: number;
  strong: number;
  protectedSum: number;
  unprotectedSum: number;
  /** 空振りの警報で身構えた人の延べ人数 */
  falseActions: number;
  minTrust: number;
  log: { t: number; kind: EventKind; glitch: boolean }[];
  last: LastEvent | null;
  series: SeriesPoint[];
  rng: () => number;
}

export interface SimStats {
  t: number;
  alerts: number;
  hits: number;
  falseAlarms: number;
  misses: number;
  strong: number;
  /** 強い揺れのうち、身を守れた人の割合 */
  protectedShare: number;
  unprotected: number;
  falseActions: number;
  trust: number;
  minTrust: number;
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

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * 30 年分の地震の筋書きを作る。seed だけで決まるので、
 * しきい値の違う世界どうしでまったく同じ地震・同じ推定値を共有できる。
 */
export function generateQuakes(p: SimParams): Quake[] {
  const rng = mulberry32(p.seed ^ 0x51ed);
  const quakes: Quake[] = [];
  let t = 0;
  for (;;) {
    t += -Math.log(Math.max(rng(), 1e-12)) / p.quakesPerYear;
    if (t >= p.years) break;
    const intensity = Math.min(7, 2.5 - Math.log(Math.max(rng(), 1e-12)) * p.intensityScale);
    let estimate = intensity + gaussian(rng) * p.estimateSigma;
    const glitch = rng() < p.glitchProb;
    // 10 月 16 日の速報のように、遠い・深い地震を大地震と取り違える
    if (glitch) estimate = Math.max(estimate, intensity + 2.5 + rng() * 2);
    quakes.push({ t, intensity, estimate, glitch });
  }
  return quakes;
}

export const DT = 1 / 120;

export function createSim(params: SimParams, policy: Policy, quakes?: Quake[]): SimState {
  const rng = mulberry32(params.seed);
  const trust = Array.from(
    { length: params.population },
    () => params.trustInitMin + rng() * (params.trustInitMax - params.trustInitMin),
  );
  const avg = mean(trust);
  return {
    policy,
    params,
    quakes: quakes ?? generateQuakes(params),
    next: 0,
    t: 0,
    trust,
    alerts: 0,
    hits: 0,
    falseAlarms: 0,
    misses: 0,
    strong: 0,
    protectedSum: 0,
    unprotectedSum: 0,
    falseActions: 0,
    minTrust: avg,
    log: [],
    last: null,
    series: [{ t: 0, trust: avg, unprotected: 0 }],
    rng,
  };
}

function mean(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return a.length > 0 ? s / a.length : 0;
}

export function classify(q: Quake, threshold: number, strongIntensity: number): EventKind {
  const alert = q.estimate >= threshold;
  const strong = q.intensity >= strongIntensity;
  if (alert) return strong ? "hit" : "false";
  return strong ? "miss" : "quiet";
}

function handleQuake(s: SimState, q: Quake) {
  const p = s.params;
  const kind = classify(q, s.policy.threshold, p.strongIntensity);
  const alert = kind === "hit" || kind === "false";
  const acted = new Array<boolean>(p.population).fill(false);
  let actedCount = 0;
  if (alert) {
    s.alerts++;
    // 警報を信じている度合いに応じて、机の下に入る・火を止める
    for (let i = 0; i < p.population; i++) {
      if (s.rng() < s.trust[i]) {
        acted[i] = true;
        actedCount++;
      }
    }
  }
  if (kind === "hit" || kind === "miss") {
    s.strong++;
    s.protectedSum += actedCount;
    s.unprotectedSum += p.population - actedCount;
  }
  for (let i = 0; i < p.population; i++) {
    const tr = s.trust[i];
    if (kind === "false") {
      // 身構えた人ほど「また外れた」と感じる
      s.trust[i] = tr * (1 - p.falseAlarmPenalty * (acted[i] ? 1 : 0.6));
    } else if (kind === "hit") {
      s.trust[i] = tr + (1 - tr) * p.hitRecovery;
    } else if (kind === "miss") {
      s.trust[i] = tr * (1 - p.missPenalty);
    }
  }
  if (kind === "hit") s.hits++;
  if (kind === "false") {
    s.falseAlarms++;
    s.falseActions += actedCount;
  }
  if (kind === "miss") s.misses++;
  if (kind !== "quiet") s.log.push({ t: q.t, kind, glitch: q.glitch });
  s.last = { t: q.t, kind, intensity: q.intensity, estimate: q.estimate, glitch: q.glitch, acted };
}

/** シミュレーションを dt 年進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.years) return;
  const tEnd = Math.min(p.years, s.t + dt);
  while (s.next < s.quakes.length && s.quakes[s.next].t < tEnd) {
    handleQuake(s, s.quakes[s.next]);
    s.next++;
  }
  // 何も起きない時期は、信頼が少しずつもとの水準へ戻る
  const k = 1 - Math.exp(-p.driftPerYear * (tEnd - s.t));
  for (let i = 0; i < s.trust.length; i++) s.trust[i] += (p.trustBase - s.trust[i]) * k;
  s.t = tEnd;
  const avg = mean(s.trust);
  if (avg < s.minTrust) s.minTrust = avg;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 0.1 - 1e-9 || s.t >= p.years) {
    s.series.push({ t: Math.round(s.t * 100) / 100, trust: avg, unprotected: s.unprotectedSum });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.years;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, 0.1);
  return s;
}

export function getStats(s: SimState): SimStats {
  const total = s.protectedSum + s.unprotectedSum;
  return {
    t: s.t,
    alerts: s.alerts,
    hits: s.hits,
    falseAlarms: s.falseAlarms,
    misses: s.misses,
    strong: s.strong,
    protectedShare: total > 0 ? s.protectedSum / total : NaN,
    unprotected: s.unprotectedSum,
    falseActions: s.falseActions,
    trust: mean(s.trust),
    minTrust: s.minTrust,
  };
}

export interface AggregateStats {
  runs: number;
  alerts: number;
  hits: number;
  falseAlarms: number;
  misses: number;
  strong: number;
  protectedShare: number;
  unprotected: number;
  falseActions: number;
  trust: number;
}

/** seed を変えて何回も回した平均。各回、どの世界も同じ地震の筋書きを使う */
export function aggregate(params: SimParams, policies: Policy[], runs: number): AggregateStats[] {
  const acc = policies.map<AggregateStats>(() => ({
    runs,
    alerts: 0,
    hits: 0,
    falseAlarms: 0,
    misses: 0,
    strong: 0,
    protectedShare: 0,
    unprotected: 0,
    falseActions: 0,
    trust: 0,
  }));
  const protectedTotal = policies.map(() => 0);
  let strongPeople = 0;
  for (let r = 0; r < runs; r++) {
    const p = { ...params, seed: params.seed + r * 7919 };
    const quakes = generateQuakes(p);
    policies.forEach((pol, i) => {
      const s = runToEnd(createSim(p, pol, quakes));
      const st = getStats(s);
      const a = acc[i];
      a.alerts += st.alerts;
      a.hits += st.hits;
      a.falseAlarms += st.falseAlarms;
      a.misses += st.misses;
      a.strong += st.strong;
      a.unprotected += st.unprotected;
      a.falseActions += st.falseActions;
      a.trust += st.trust;
      protectedTotal[i] += s.protectedSum;
      if (i === 0) strongPeople += s.protectedSum + s.unprotectedSum;
    });
  }
  return acc.map((a, i) => ({
    runs,
    alerts: a.alerts / runs,
    hits: a.hits / runs,
    falseAlarms: a.falseAlarms / runs,
    misses: a.misses / runs,
    strong: a.strong / runs,
    // 強い揺れが 1 回もない回があるので、回ごとの割合ではなく延べ人数で割る
    protectedShare: strongPeople > 0 ? protectedTotal[i] / strongPeople : NaN,
    unprotected: a.unprotected / runs,
    falseActions: a.falseActions / runs,
    trust: a.trust / runs,
  }));
}
