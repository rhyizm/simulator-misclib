/**
 * 都市型水害 (内水氾濫) のシミュレーション: 純粋な計算モデル。
 *
 * 単位は「分」と「m・m³」。雨は mm/h。
 * ひとつの町に 2 つの低い場所がある。
 *  - 住宅街のくぼ地: 100 ha の住宅地の雨水が下水道の幹線に集まり、あふれた分がくぼ地にたまる
 *  - 道路のアンダーパス: 3 ha の道路の雨水がポンプで排水され、あふれた分が底にたまる
 * 対策 (下水道の能力・貯留槽・浸透・通行止め) を変えた 2 つの世界に、同じ雨と同じ車を流して比べる。
 * 描画や React に依存しない。
 */

/** 1 ステップ = 1 分 */
export const DT = 1;

export interface Burst {
  /** 強い雨が始まる時刻 (分) */
  start: number;
  /** 続く時間 (分)。前後 10 分で強まり・弱まる */
  dur: number;
  /** いちばん強いときの雨量 (mm/h) */
  peak: number;
}

export interface RainPattern {
  /** ずっと降っている弱い雨 (mm/h) と、その時間帯 */
  base: number;
  baseFrom: number;
  baseTo: number;
  bursts: Burst[];
}

export interface SimParams {
  rain: RainPattern;
  /** 雨の強さの倍率 (詳細設定) */
  rainScale: number;
  /** 1 回ごとの雨のばらつき (強い雨の強さの標準偏差、割合) */
  rainJitter: number;
  /** アンダーパスに来る車 (台/分) */
  carsPerMin: number;
  /** カーナビの警告を見て迂回する人の割合 (警告がある世界だけ) */
  warningCompliance: number;
  durationMin: number;
  seed: number;
}

export interface Policy {
  id: PolicyId;
  name: string;
  /** 下水道・排水ポンプの能力 (この雨量までなら流しきれる、mm/h) */
  capacityMm: number;
  /** 住宅地の雨水貯留槽 (m³) */
  tankM3: number;
  /** 住宅地の流出係数 (降った雨のうち下水道へ流れ込む割合) */
  runoffCoef: number;
  /** アンダーパスの通行止め: manual = 職員が現地で閉める、auto = 冠水センサーで自動 */
  closure: "manual" | "auto";
  /** カーナビ等で冠水の危険を警告する */
  warning: boolean;
}

export type PolicyId = "now" | "pipe65" | "tank" | "infiltrate" | "road" | "all";

const BASE_POLICY = {
  capacityMm: 50,
  tankM3: 0,
  runoffCoef: 0.8,
  closure: "manual",
  warning: false,
} as const;

export const POLICIES: Record<PolicyId, Policy> = {
  now: { id: "now", name: "いまのまま", ...BASE_POLICY },
  pipe65: { id: "pipe65", name: "下水道を 65 mm に", ...BASE_POLICY, capacityMm: 65 },
  tank: { id: "tank", name: "貯留槽 2 万 m³", ...BASE_POLICY, tankM3: 20000 },
  infiltrate: { id: "infiltrate", name: "雨水をしみこませる", ...BASE_POLICY, runoffCoef: 0.65 },
  road: { id: "road", name: "冠水センサーで通行止め", ...BASE_POLICY, closure: "auto", warning: true },
  all: {
    id: "all",
    name: "全部のせ",
    capacityMm: 65,
    tankM3: 20000,
    runoffCoef: 0.65,
    closure: "auto",
    warning: true,
  },
};

export const POLICY_IDS: PolicyId[] = ["now", "pipe65", "tank", "infiltrate", "road", "all"];

/* ---------- 町の形 ---------- */

/** 住宅地の集水面積 (m²) = 100 ha */
export const RES_AREA = 1_000_000;
/** 下水道の計画で使う流出係数 (能力 mm/h はこの係数で換算する) */
export const DESIGN_COEF = 0.8;
/** くぼ地: 水位 h (m) のときに水をかぶる面積 = HOLLOW_A0 + HOLLOW_K × h */
export const HOLLOW_A0 = 40_000;
export const HOLLOW_K = 120_000;
/** くぼ地の家の数と、家が建っている土地の高さの上限 (くぼ地の底から m) */
export const HOUSES = 600;
export const HOUSE_LAND_MAX = 1.5;

/** アンダーパスに雨水が集まる道路の面積 (m²) と流出係数 */
export const ROAD_AREA = 30_000;
export const ROAD_COEF = 0.9;
/** アンダーパスの形: 幅 12 m、底の平らな部分 30 m、坂の勾配 6% */
export const UP_WIDTH = 12;
export const UP_FLAT = 30;
export const UP_SLOPE = 0.06;

/** 車が動かなくなる水深 (m)。マフラーや吸気口に水が入る */
export const STALL_DEPTH = 0.3;
/** 水圧でドアが開けにくくなる水深 (m)。JAF のテストでは 60 cm でほぼ開かない */
export const TRAP_DEPTH = 0.6;
/** 止まった車から人が自力で出るまでの平均時間 (分) */
export const ESCAPE_MEAN_MIN = 5;
/** 止まった車が並べる場所の数 (2 車線 × 6 台) */
export const CAR_SLOTS = 12;
/** 手動の通行止め: 水深がこれを超えてから職員が着いて閉めるまでの時間 (分) */
export const MANUAL_TRIGGER = 0.15;
export const MANUAL_DELAY_MIN = 40;
/** 冠水センサーの通行止め: この水深で即座に閉める */
export const AUTO_TRIGGER = 0.1;
/** カーナビに警告を出す雨の強さ (mm/h) */
export const WARNING_MM = 50;

/** 家 j の土地の高さ (くぼ地の底から m)。くぼ地の面積に比例して家が建っているとみなす */
export function houseGround(j: number): number {
  const total = HOLLOW_A0 + HOLLOW_K * HOUSE_LAND_MAX;
  const target = ((j + 0.5) / HOUSES) * total;
  return Math.max(0, (target - HOLLOW_A0) / HOLLOW_K);
}

/** 家 j の床の高さ (地面から m)。30〜60 cm に散らばる */
export function houseFloor(j: number): number {
  const frac = (j * 0.6180339887) % 1;
  return 0.3 + 0.3 * frac;
}

const GROUND = Array.from({ length: HOUSES }, (_, j) => houseGround(j));
const FLOOR = Array.from({ length: HOUSES }, (_, j) => houseFloor(j));

/** くぼ地にたまった水の量 (m³) → 水位 (m) */
export function hollowDepth(v: number): number {
  if (v <= 0) return 0;
  const k = HOLLOW_K;
  return (-HOLLOW_A0 + Math.sqrt(HOLLOW_A0 * HOLLOW_A0 + 2 * k * v)) / k;
}

/** アンダーパスの水の量 (m³) → いちばん深いところの水深 (m)。V = W (L h + h² / s) */
export function underpassDepth(v: number): number {
  if (v <= 0) return 0;
  const a = 1 / UP_SLOPE;
  const b = UP_FLAT;
  const c = -v / UP_WIDTH;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** 止まった車の場所 k の、底からの高さ (m)。底の 3 列は平ら、その先は坂 */
export function slotHeight(k: number): number {
  const row = Math.floor(k / 2);
  const d = row * 7;
  return Math.max(0, d - UP_FLAT / 2) * UP_SLOPE;
}

/** 雨の強さ (mm/h) の時刻 t における基準値 (ばらつき・倍率を入れる前) */
export function rainAt(p: RainPattern, t: number, peaks?: number[], shifts?: number[]): number {
  let r = t >= p.baseFrom && t < p.baseTo ? p.base : 0;
  p.bursts.forEach((b, i) => {
    const start = b.start + (shifts?.[i] ?? 0);
    const end = start + b.dur;
    if (t < start || t >= end) return;
    const ramp = Math.min(1, (t - start + 0.5) / 10, (end - t - 0.5) / 10);
    r = Math.max(r, (peaks?.[i] ?? b.peak) * Math.max(0, ramp));
  });
  return r;
}

/* ---------- 乱数 ---------- */

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

function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/* ---------- 状態 ---------- */

/** アンダーパスに来た 1 台。乱数は両方の世界で同じものを使う */
export interface CarDraw {
  t: number;
  /** 水を見て入るかどうかを決める乱数 */
  uEnter: number;
  /** 警告に従うかどうかの乱数 */
  uWarn: number;
  /** 止まったあと車を出るまでの時間 (分) */
  escapeMin: number;
}

export interface StuckCar {
  slot: number;
  /** 止まった時刻 */
  t: number;
  /** 人が車を出た時刻 (まだなら -1) */
  outAt: number;
  escapeMin: number;
  trapped: boolean;
}

export interface SeriesPoint {
  t: number;
  rain: number;
  hollow: number;
  under: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  t: number;
  /** 1 分ごとの雨 (mm/h)。両方の世界で同じ */
  rain: number[];
  cars: CarDraw[];
  carIdx: number;
  /** 地表を流れて下水道に届くまでの遅れを表す、ならした流入量 (m³/分) */
  resFlow: number;
  roadFlow: number;
  /** 下水道に流れている量 ÷ 能力 */
  pipeLoad: number;
  roadPumpLoad: number;
  tank: number;
  hollowV: number;
  underV: number;
  hollowH: number;
  underH: number;
  /** ゲート: 閉めた時刻 (開いていれば -1) と、手動のとき職員が着く時刻 */
  closedAt: number;
  crewEta: number;
  stuck: StuckCar[];
  /* 集計 */
  overflowM3: number;
  maxHollow: number;
  maxUnder: number;
  floodMinutes: number;
  /** その時点で床上・床下まで水が来ている家 */
  aboveFloor: number;
  belowFloor: number;
  maxAboveFloor: number;
  maxBelowFloor: number;
  /** 一度でも床上まで水が来た家 */
  everAbove: boolean[];
  everBelow: boolean[];
  maxTank: number;
  /** 雨が降り始めてから、アンダーパスが 30 cm に達するまでの分 (達しなければ -1) */
  minutesTo30: number;
  firstRainAt: number;
  passed: number;
  detoured: number;
  turnedBack: number;
  trapped: number;
  /** 水の中で動けなくなった車の累計 */
  stalledTotal: number;
  series: SeriesPoint[];
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const rng = mulberry32(params.seed);
  const p = params.rain;
  // 強い雨の強さと時刻を 1 回ごとに少しずらす
  const peaks = p.bursts.map((b) => Math.max(0, b.peak * (1 + params.rainJitter * gauss(rng))));
  const shifts = p.bursts.map(() => Math.round((rng() - 0.5) * 10));
  const rain: number[] = [];
  for (let t = 0; t < params.durationMin; t++) {
    const baseJ = 1 + 0.1 * (rng() - 0.5);
    rain.push(rainAt(p, t, peaks, shifts) * baseJ * params.rainScale);
  }
  // 車の到着 (ポアソン) を先に全部決めておく
  const cars: CarDraw[] = [];
  for (let t = 0; t < params.durationMin; t++) {
    let n = 0;
    const L = Math.exp(-params.carsPerMin);
    let prod = rng();
    while (prod > L && n < 50) {
      n++;
      prod *= rng();
    }
    for (let i = 0; i < n; i++) {
      cars.push({
        t,
        uEnter: rng(),
        uWarn: rng(),
        escapeMin: -Math.log(1 - rng()) * ESCAPE_MEAN_MIN,
      });
    }
  }
  return {
    policy,
    params,
    t: 0,
    rain,
    cars,
    carIdx: 0,
    resFlow: 0,
    roadFlow: 0,
    pipeLoad: 0,
    roadPumpLoad: 0,
    tank: 0,
    hollowV: 0,
    underV: 0,
    hollowH: 0,
    underH: 0,
    closedAt: -1,
    crewEta: -1,
    stuck: [],
    overflowM3: 0,
    maxHollow: 0,
    maxUnder: 0,
    floodMinutes: 0,
    aboveFloor: 0,
    belowFloor: 0,
    maxAboveFloor: 0,
    maxBelowFloor: 0,
    everAbove: new Array(HOUSES).fill(false),
    everBelow: new Array(HOUSES).fill(false),
    maxTank: 0,
    minutesTo30: -1,
    firstRainAt: -1,
    passed: 0,
    detoured: 0,
    turnedBack: 0,
    trapped: 0,
    stalledTotal: 0,
    series: [{ t: 0, rain: 0, hollow: 0, under: 0 }],
  };
}

/** mm/h の雨が面積 area に降ったときの流量 (m³/分) */
export function flowM3PerMin(mmPerHour: number, area: number, coef: number): number {
  return (coef * mmPerHour * area) / 1000 / 60;
}

/** 住宅地の下水道 (幹線): 流入・貯留槽・くぼ地 */
function stepResidential(s: SimState, r: number) {
  const pol = s.policy;
  const inflowRaw = flowM3PerMin(r, RES_AREA, pol.runoffCoef);
  // 地表を流れて集まるまでの遅れ (時定数 8 分)
  s.resFlow += (inflowRaw - s.resFlow) * (DT / 8);
  const cap = flowM3PerMin(pol.capacityMm, RES_AREA, DESIGN_COEF);
  const inflow = s.resFlow * DT;
  const capStep = cap * DT;
  if (inflow > capStep) {
    // あふれる分は、まず貯留槽へ、入りきらなければ地表 (くぼ地) へ
    let excess = inflow - capStep;
    const room = pol.tankM3 - s.tank;
    const toTank = Math.min(excess, Math.max(0, room));
    s.tank += toTank;
    excess -= toTank;
    s.hollowV += excess;
    s.overflowM3 += excess;
    s.pipeLoad = 1;
  } else {
    // 余った能力で、くぼ地の水 → 貯留槽の水の順に流す
    let spare = capStep - inflow;
    const fromHollow = Math.min(spare, s.hollowV);
    s.hollowV -= fromHollow;
    spare -= fromHollow;
    // 貯留槽はポンプで少しずつ戻す (最大 60 m³/分)
    const fromTank = Math.min(spare * 0.5, s.tank, 60 * DT);
    s.tank -= fromTank;
    spare -= fromTank;
    s.pipeLoad = 1 - spare / capStep;
  }
  s.hollowH = hollowDepth(s.hollowV);
  if (s.tank > s.maxTank) s.maxTank = s.tank;
  if (s.hollowH > s.maxHollow) s.maxHollow = s.hollowH;
  if (s.hollowH > 0.05) s.floodMinutes += DT;
  let above = 0;
  let below = 0;
  for (let j = 0; j < HOUSES; j++) {
    const d = s.hollowH - GROUND[j];
    if (d <= 0) continue;
    if (d > FLOOR[j]) {
      above++;
      s.everAbove[j] = true;
    } else {
      below++;
      s.everBelow[j] = true;
    }
  }
  s.aboveFloor = above;
  s.belowFloor = below;
  if (above > s.maxAboveFloor) s.maxAboveFloor = above;
  if (below > s.maxBelowFloor) s.maxBelowFloor = below;
}

/** アンダーパス: 流入・排水ポンプ・水深 */
function stepUnderpass(s: SimState, r: number) {
  const pol = s.policy;
  const inflowRaw = flowM3PerMin(r, ROAD_AREA, ROAD_COEF);
  // 道路は集まるのが速い (時定数 3 分)
  s.roadFlow += (inflowRaw - s.roadFlow) * (DT / 3);
  // ポンプの能力も同じ雨量 (mm/h) を基準に決める
  const pump = flowM3PerMin(pol.capacityMm, ROAD_AREA, ROAD_COEF) * DT;
  const inflow = s.roadFlow * DT;
  const out = Math.min(pump, inflow + s.underV);
  s.underV = Math.max(0, s.underV + inflow - out);
  s.roadPumpLoad = pump > 0 ? out / pump : 0;
  s.underH = underpassDepth(s.underV);
  if (s.underH > s.maxUnder) s.maxUnder = s.underH;
  if (s.minutesTo30 < 0 && s.underH >= STALL_DEPTH && s.firstRainAt >= 0) {
    s.minutesTo30 = s.t - s.firstRainAt;
  }
}

function gateClosed(s: SimState): boolean {
  return s.closedAt >= 0;
}

function stepGate(s: SimState) {
  const pol = s.policy;
  if (gateClosed(s)) {
    // 水が引いて雨も弱まったら開ける
    if (s.underH < 0.03 && s.stuck.length === 0 && s.rain[s.t] < 20) s.closedAt = -1;
    return;
  }
  if (pol.closure === "auto") {
    if (s.underH >= AUTO_TRIGGER) s.closedAt = s.t;
    return;
  }
  if (s.crewEta < 0 && s.underH >= MANUAL_TRIGGER) s.crewEta = s.t + MANUAL_DELAY_MIN;
  if (s.crewEta >= 0 && s.t >= s.crewEta) {
    s.closedAt = s.t;
    s.crewEta = -1;
  }
}

/** 水が見えたときに入っていく確率。浅く見えると入る。夜や雨では深さがわかりにくい */
export function enterProbability(depth: number): number {
  if (depth < 0.1) return 1;
  return Math.max(0, Math.min(1, 1 - (depth - 0.1) / 0.6));
}

function stepCars(s: SimState, r: number) {
  const pol = s.policy;
  // 止まった車: 人が出るか、ドアが開かなくなるか
  for (const c of s.stuck) {
    if (c.outAt >= 0 || c.trapped) continue;
    const local = s.underH - slotHeight(c.slot);
    if (s.t - c.t >= c.escapeMin) {
      c.outAt = s.t;
    } else if (local >= TRAP_DEPTH) {
      c.trapped = true;
      s.trapped++;
    }
  }
  // 水が引けば止まった車はレッカーで片づき、閉じ込められた人も救助される
  if (s.underH < 0.05 && s.stuck.length > 0) s.stuck = [];

  while (s.carIdx < s.cars.length && s.cars[s.carIdx].t <= s.t) {
    const car = s.cars[s.carIdx++];
    if (gateClosed(s)) {
      s.detoured++;
      continue;
    }
    if (pol.warning && r >= WARNING_MM && car.uWarn < s.params.warningCompliance) {
      s.detoured++;
      continue;
    }
    const slot = s.stuck.length;
    const local = s.underH - slotHeight(Math.min(slot, CAR_SLOTS - 1));
    if (car.uEnter >= enterProbability(s.underH)) {
      s.turnedBack++;
      continue;
    }
    if (local >= STALL_DEPTH && slot < CAR_SLOTS) {
      s.stuck.push({ slot, t: s.t, outAt: -1, escapeMin: car.escapeMin, trapped: false });
      s.stalledTotal++;
    } else if (slot > 0) {
      // 前で車が止まっていて通れない
      s.turnedBack++;
    } else {
      s.passed++;
    }
  }
}

/** シミュレーションを 1 分進める */
export function step(s: SimState) {
  if (s.t >= s.params.durationMin) return;
  const r = s.rain[s.t] ?? 0;
  if (s.firstRainAt < 0 && r > 1) s.firstRainAt = s.t;
  stepResidential(s, r);
  stepUnderpass(s, r);
  stepGate(s);
  stepCars(s, r);
  s.t += DT;
  if (s.t % 5 === 0) {
    s.series.push({ t: s.t, rain: r, hollow: s.hollowH, under: s.underH });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationMin;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s);
  return s;
}

export interface SimStats {
  t: number;
  rainNow: number;
  rainTotal: number;
  maxHollow: number;
  hollowNow: number;
  /** 一度でも床上・床下まで水が来た家の数 */
  aboveFloor: number;
  belowFloor: number;
  floodMinutes: number;
  overflowM3: number;
  tankFill: number;
  maxUnder: number;
  underNow: number;
  minutesTo30: number;
  stalled: number;
  trapped: number;
  detoured: number;
  passed: number;
  turnedBack: number;
}

export function getStats(s: SimState): SimStats {
  let rainTotal = 0;
  for (let t = 0; t < s.t; t++) rainTotal += (s.rain[t] ?? 0) / 60;
  const above = s.everAbove.filter(Boolean).length;
  const below = s.everBelow.filter((b, j) => b && !s.everAbove[j]).length;
  return {
    t: s.t,
    rainNow: s.rain[Math.max(0, s.t - 1)] ?? 0,
    rainTotal,
    maxHollow: s.maxHollow,
    hollowNow: s.hollowH,
    aboveFloor: above,
    belowFloor: below,
    floodMinutes: s.floodMinutes,
    overflowM3: s.overflowM3,
    tankFill: s.policy.tankM3 > 0 ? s.maxTank / s.policy.tankM3 : 0,
    maxUnder: s.maxUnder,
    underNow: s.underH,
    minutesTo30: s.minutesTo30,
    stalled: s.stalledTotal,
    trapped: s.trapped,
    detoured: s.detoured,
    passed: s.passed,
    turnedBack: s.turnedBack,
  };
}

/** 同じシナリオを seed を変えて何回も回した平均 */
export type AggregateStats = SimStats & { runs: number; anyAboveRate: number; anyTrappedRate: number };

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc: Record<string, number> = {};
  let anyAbove = 0;
  let anyTrapped = 0;
  let to30Sum = 0;
  let to30N = 0;
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    for (const [k, v] of Object.entries(st)) acc[k] = (acc[k] ?? 0) + v / runs;
    if (st.aboveFloor > 0) anyAbove++;
    if (st.trapped > 0) anyTrapped++;
    if (st.minutesTo30 >= 0) {
      to30Sum += st.minutesTo30;
      to30N++;
    }
  }
  return {
    ...(acc as unknown as SimStats),
    minutesTo30: to30N > 0 ? to30Sum / to30N : -1,
    runs,
    anyAboveRate: anyAbove / runs,
    anyTrappedRate: anyTrapped / runs,
  };
}
