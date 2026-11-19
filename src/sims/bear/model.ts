/**
 * クマの出没シミュレーション: 純粋な計算モデル。
 *
 * 山 (奥山) → 里山の縁 (緩衝帯) → 集落の畑 (柿や栗の木) → 町 (ごみ置き場) と並ぶ
 * 横 3 km・縦 3 km の 1 枚の地図に、秋の 3 か月 (9/1〜11/30) のクマを 1 時間ずつ動かす。
 *
 * クマは冬眠までに太らなければならず、森の木の実が足りないと、山を下りて食べ物を探しに出る。
 * 里で柿やごみを食べたクマは「場所を覚え」、次からはまっすぐそこへ向かうようになる。
 *
 * 座標は m。y が大きいほど山から遠い (町に近い)。描画や React に依存しない。
 */

/** 地図の幅と奥行き (m) */
export const MAP_W = 3000;
export const MAP_H = 3000;
/** 帯の境目 (y, m)。ここより下 (y が大きい側) がそれぞれ緩衝帯・畑・町 */
export const BUFFER_Y = 1800;
export const FARM_Y = 2100;
export const TOWN_Y = 2500;
/** 9/1 から 11/30 まで */
export const DAYS = 91;
export const HOURS = DAYS * 24;
/** 1 ステップの長さ (時間) */
export const DT = 1;
/** 木の実が熟す日 (9/1 からの日数。9/15) */
export const FRUIT_FROM_DAY = 14;
/** においで食べ物に気づく距離 (m) */
export const SMELL_M = 320;
/** 歩く速さ (m/時) */
const WALK_MPH = 280;
/** 1 度の探索で里をうろつく長さの上限 (時間) */
const EXPLORE_BUDGET_H = 18;

export interface SimParams {
  /** 山から里へ下りうる範囲にいるクマの頭数 (春の時点) */
  bears: number;
  /** 森の木の実の出来 (1 = 並作、0.3 = 大凶作、1.1 = 豊作) */
  mast: number;
  /** 去年までに里の食べ物を覚えた「人慣れ」グマの割合 */
  habituated: number;
  /** 畑や庭の柿・栗の木の本数 */
  trees: number;
  /** 町のごみ置き場の数 */
  garbage: number;
  seed: number;
}

export interface Policy {
  name: string;
  /** 春のうちに頭数を減らす割合 (個体数調整) */
  springCull: number;
  /** 柿・栗の木を切る / 早めに収穫する、ごみ置き場を囲う割合 */
  attractantRemoval: number;
  /** 里山の縁のやぶを刈り払って緩衝帯にする */
  buffer: boolean;
  /** 出てきたクマを捕る体制。normal = 猟友会頼み、strong = 専従の捕獲チーム + 緊急銃猟 */
  capture: "normal" | "strong";
}

export type BearMode = "forage" | "rest" | "explore" | "raid" | "eat" | "return" | "gone";

export interface Bear {
  id: number;
  /** 森の中のなわばりの中心 */
  hx: number;
  hy: number;
  x: number;
  y: number;
  /** 脂肪の蓄え (0〜1.2)。冬眠には 0.8 以上ほしい */
  fat: number;
  mode: BearMode;
  /** 向かっている食べ物 (木: 0..trees-1、ごみ置き場: trees..) */
  target: number;
  /** 覚えている食べ物の場所 (-1 なら知らない) */
  memory: number;
  /** 里の食べ物の味を知っている */
  habituated: boolean;
  /** この探索に出てからの時間 */
  tripH: number;
  /** 食べている時間 */
  eatH: number;
  /** 通報されて、わなや捕獲班に追われている */
  reported: boolean;
  /** 捕獲された日 (-1 = 生きている、-2 = 春に捕獲) */
  removedDay: number;
  /** 今日、畑・町に出たか (日ごとの数え上げ用) */
  inFarmToday: boolean;
  inTownToday: boolean;
  everTown: boolean;
}

export interface Food {
  x: number;
  y: number;
  kind: "tree" | "garbage";
  /** 対策で片づけた */
  removed: boolean;
  /** 残っている量 (木: 1 本分の実、ごみ: その日の量) */
  stock: number;
}

export type EventKind = "encounter" | "injury" | "capture";

export interface SimEvent {
  h: number;
  x: number;
  y: number;
  kind: EventKind;
}

export interface SeriesPoint {
  /** 9/1 からの日数 */
  t: number;
  /** その日に畑か町に出たクマの頭数 */
  out: number;
  /** その日に町に出たクマの頭数 */
  town: number;
  /** 人身被害の累計 (期待値) */
  injuryCum: number;
  /** 生きているクマの蓄えの平均 */
  fatAvg: number;
}

export interface SimState {
  params: SimParams;
  policy: Policy;
  /** 9/1 0:00 からの経過時間 */
  h: number;
  bears: Bear[];
  foods: Food[];
  rng: () => number;
  /** 人との遭遇などのくじ (両方の世界で同じ並びになるように別に持つ) */
  luck: () => number;
  events: SimEvent[];
  /** 町に出た延べ日数 (頭・日) */
  townBearDays: number;
  /** 畑か町に出た延べ日数 (頭・日) */
  farmBearDays: number;
  encounters: number;
  injuries: number;
  /** 人身被害の期待値 (くじのぶれを除いた値) */
  injuryExp: number;
  captured: number;
  /** 週ごとの捕獲数 (捕獲の手の足りなさを表す) */
  capturedThisWeek: number;
  treeMeals: number;
  garbageMeals: number;
  series: SeriesPoint[];
}

export interface SimStats {
  h: number;
  day: number;
  alive: number;
  springCulled: number;
  captured: number;
  /** いま森の外 (緩衝帯より下) にいるクマ */
  outNow: number;
  townBearDays: number;
  farmBearDays: number;
  /** 一度でも町に出たクマの頭数 */
  townBears: number;
  encounters: number;
  injuries: number;
  injuryExp: number;
  treeMeals: number;
  garbageMeals: number;
  /** 里の食べ物を覚えたクマ (生きている分) */
  habituated: number;
  fatAvg: number;
  /** 冬眠前に蓄えが 0.6 に届かないクマの割合 */
  thinShare: number;
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function dayOf(h: number): number {
  return Math.floor(h / 24);
}

export function hourOf(h: number): number {
  return h % 24;
}

/** 9/1 からの日数 → "10/14" */
export function fmtDate(day: number): string {
  const d = Math.min(DAYS - 1, Math.max(0, Math.floor(day)));
  if (d < 30) return `9/${d + 1}`;
  if (d < 61) return `10/${d - 29}`;
  return `11/${d - 60}`;
}

/** 森の木の実の量の季節変化 (9 月の終わりから 10 月にかけて多い) */
export function seasonCurve(day: number): number {
  return 0.55 + 0.6 * Math.exp(-(((day - 40) / 28) ** 2));
}

/** その日までに蓄えておきたい量 (9/1 に 0.3、11/30 に 1.0) */
export function expectedFat(day: number): number {
  return 0.3 + (0.7 * day) / DAYS;
}

/** 外に出ている人の多さ (町)。朝夕の通勤・通学と、ごみ出しの時間が多い */
function townPeople(hour: number): number {
  if (hour >= 6 && hour < 9) return 1;
  if (hour >= 9 && hour < 15) return 0.6;
  if (hour >= 15 && hour < 19) return 1;
  if (hour >= 19 && hour < 22) return 0.3;
  return 0.05;
}

/** 畑で働く人の多さ */
function farmPeople(hour: number): number {
  return hour >= 7 && hour < 17 ? 1 : 0.05;
}

export function zoneOf(y: number): "forest" | "buffer" | "farm" | "town" {
  if (y >= TOWN_Y) return "town";
  if (y >= FARM_Y) return "farm";
  if (y >= BUFFER_Y) return "buffer";
  return "forest";
}

/**
 * 地図と、その年のクマを作る。
 * どちらの世界でも同じ seed なら同じクマ・同じ木・同じ「くじ」になるので、
 * 対策だけが違う 2 つの秋を公平に比べられる (春に捕獲されるクマも、捕獲割合が低い世界の分は高い世界でも捕獲される)。
 */
export function createSim(params: SimParams, policy: Policy): SimState {
  const rng = mulberry32(params.seed);
  const foods: Food[] = [];
  for (let i = 0; i < params.trees; i++) {
    const x = 150 + rng() * (MAP_W - 300);
    const y = FARM_Y + 60 + rng() * (TOWN_Y - FARM_Y - 100);
    const lot = rng();
    foods.push({ x, y, kind: "tree", removed: lot < policy.attractantRemoval, stock: 0 });
  }
  for (let i = 0; i < params.garbage; i++) {
    const x = 200 + ((i + 0.5) / params.garbage) * (MAP_W - 400) + (rng() - 0.5) * 120;
    const y = TOWN_Y + 120 + rng() * (MAP_H - TOWN_Y - 220);
    const lot = rng();
    foods.push({ x, y, kind: "garbage", removed: lot < policy.attractantRemoval, stock: 0 });
  }

  const bears: Bear[] = [];
  for (let i = 0; i < params.bears; i++) {
    const hx = 150 + rng() * (MAP_W - 300);
    const hy = 150 + rng() * (BUFFER_Y - 450);
    const fat = 0.26 + rng() * 0.08;
    const cullLot = rng();
    const habLot = rng();
    const habituated = habLot < params.habituated;
    let memory = -1;
    if (habituated) {
      // 去年食べた木 (いちばん近い木) を覚えている。切られていれば無駄足になる
      let best = Infinity;
      for (let k = 0; k < params.trees; k++) {
        const d = Math.hypot(foods[k].x - hx, foods[k].y - hy);
        if (d < best) {
          best = d;
          memory = k;
        }
      }
    }
    const culled = cullLot < policy.springCull;
    bears.push({
      id: i + 1,
      hx,
      hy,
      x: hx,
      y: hy,
      fat,
      mode: culled ? "gone" : "forage",
      target: -1,
      memory,
      habituated,
      tripH: 0,
      eatH: 0,
      reported: false,
      removedDay: culled ? -2 : -1,
      inFarmToday: false,
      inTownToday: false,
      everTown: false,
    });
  }

  return {
    params,
    policy,
    h: 0,
    bears,
    foods,
    rng: mulberry32(params.seed ^ 0x9e3779b9),
    luck: mulberry32(params.seed ^ 0x51ed270b),
    events: [],
    townBearDays: 0,
    farmBearDays: 0,
    encounters: 0,
    injuries: 0,
    injuryExp: 0,
    captured: 0,
    capturedThisWeek: 0,
    treeMeals: 0,
    garbageMeals: 0,
    series: [{ t: 0, out: 0, town: 0, injuryCum: 0, fatAvg: avgFat(bears) }],
  };
}

function avgFat(bears: Bear[]): number {
  let s = 0;
  let n = 0;
  for (const b of bears) {
    if (b.removedDay !== -1) continue;
    s += b.fat;
    n++;
  }
  return n > 0 ? s / n : 0;
}

export function aliveCount(s: SimState): number {
  let n = 0;
  for (const b of s.bears) if (b.removedDay === -1) n++;
  return n;
}

/** 食べ物があるか (片づけていない木は熟してから、ごみは朝だけ) */
export function foodAvailable(s: SimState, k: number): boolean {
  const f = s.foods[k];
  if (f.removed || f.stock <= 0.01) return false;
  if (f.kind === "garbage") {
    const hr = hourOf(s.h);
    return hr >= 5 && hr < 10;
  }
  return true;
}

function moveToward(b: Bear, tx: number, ty: number, speed: number): boolean {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) {
    b.x = tx;
    b.y = ty;
    return true;
  }
  b.x += (dx / d) * speed;
  b.y += (dy / d) * speed;
  return false;
}

function nearestFood(s: SimState, b: Bear, radius: number): number {
  let best = -1;
  let bd = radius;
  for (let k = 0; k < s.foods.length; k++) {
    if (!foodAvailable(s, k)) continue;
    const f = s.foods[k];
    const d = Math.hypot(f.x - b.x, f.y - b.y);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** 1 日の始まり: 木の実を熟させ、ごみを出す */
function newDay(s: SimState, day: number) {
  for (const f of s.foods) {
    if (f.removed) continue;
    if (f.kind === "tree") {
      if (day === FRUIT_FROM_DAY) f.stock = 1.6;
    } else {
      // ごみの日 (週 3 日ほど)
      f.stock = s.rng() < 0.45 ? 0.6 : 0;
    }
  }
  if (day % 7 === 0) s.capturedThisWeek = 0;
}

function endDay(s: SimState, day: number) {
  let out = 0;
  let town = 0;
  for (const b of s.bears) {
    if (b.inFarmToday) out++;
    if (b.inTownToday) town++;
    b.inFarmToday = false;
    b.inTownToday = false;
  }
  s.farmBearDays += out;
  s.townBearDays += town;
  s.series.push({
    t: day + 1,
    out,
    town,
    injuryCum: Math.round(s.injuryExp * 100) / 100,
    fatAvg: Math.round(avgFat(s.bears) * 1000) / 1000,
  });
}

/** 出かけるかどうかを決める (夜明けと夕方) */
function decide(s: SimState, b: Bear, day: number) {
  const hunger = Math.max(0, expectedFat(day) - b.fat);
  const r = s.rng();
  if (b.memory >= 0 && foodAvailable(s, b.memory) && s.foods[b.memory].kind === "tree") {
    // 場所を覚えたクマは、空腹でなくても通ってくる
    if (r < clamp(0.06 + 0.9 * hunger, 0, 0.7)) {
      b.mode = "raid";
      b.target = b.memory;
      b.tripH = 0;
    }
    return;
  }
  // 覚えていた木が切られていたと知ったら、忘れる
  if (b.memory >= 0 && s.foods[b.memory].removed) b.memory = -1;
  const bold = b.habituated ? 0.03 : 0;
  if (r < 0.002 + bold + 0.22 * hunger) {
    b.mode = "explore";
    b.target = -1;
    b.tripH = 0;
  }
}

function recordPresence(s: SimState, b: Bear) {
  const z = zoneOf(b.y);
  if (z === "farm" || z === "town") b.inFarmToday = true;
  if (z === "town") {
    b.inTownToday = true;
    b.everTown = true;
  }
}

/** 人との遭遇と、通報・捕獲 */
function people(s: SimState, b: Bear, hour: number, day: number) {
  const z = zoneOf(b.y);
  const daylight = hour >= 6 && hour < 18;
  let rate = 0;
  let injuryP = 0.18;
  if (z === "town") {
    rate = 0.012 * townPeople(hour);
    injuryP = 0.25;
  } else if (z === "farm") {
    rate = 0.006 * farmPeople(hour) * (s.policy.buffer ? 0.7 : 1);
  } else if (z === "buffer") {
    // やぶが残っていると、近づくまで互いに気づかない
    rate = (daylight ? 0.003 : 0.0003) * (s.policy.buffer ? 0.4 : 1);
  } else if (b.mode === "forage") {
    // きのこ採りや山仕事 (9〜10 月が多い)
    rate = daylight ? 0.00004 * (day < 60 ? 1 : 0.4) : 0;
  }
  if (rate > 0) {
    s.injuryExp += rate * injuryP;
    if (s.luck() < rate) {
      s.encounters++;
      const hurt = s.luck() < injuryP;
      if (hurt) s.injuries++;
      s.events.push({ h: s.h, x: b.x, y: b.y, kind: hurt ? "injury" : "encounter" });
      b.reported = true;
    }
  }

  // 畑・町に出たクマは見つかって通報される
  if (z === "farm" || z === "town") {
    if (s.rng() < (daylight ? 0.35 : 0.08)) b.reported = true;
  }

  // 捕獲: 通報されたクマが里の側 (緩衝帯から下) にいるあいだ、わなや捕獲班が追う
  if (b.reported && z !== "forest") {
    const strong = s.policy.capture === "strong";
    const cap = strong ? 3 : 1;
    let p = strong ? 0.05 : 0.012;
    if (strong && z === "town" && daylight) p = 0.2; // 緊急銃猟
    if (s.capturedThisWeek < cap && s.rng() < p) {
      b.removedDay = day;
      b.mode = "gone";
      s.captured++;
      s.capturedThisWeek++;
      s.events.push({ h: s.h, x: b.x, y: b.y, kind: "capture" });
    }
  }
}

export function step(s: SimState) {
  if (isFinished(s)) return;
  const day = dayOf(s.h);
  const hour = hourOf(s.h);
  if (hour === 0) newDay(s, day);

  const alive = aliveCount(s);
  // 頭数が減ると 1 頭あたりの木の実が少し増える (なわばりの奪い合いが減る)
  const density = clamp((s.params.bears / Math.max(1, alive)) ** 0.2, 0.8, 1.2);
  const forestGain = 0.00105 * s.params.mast * seasonCurve(day) * density;
  const burn = 0.0042 / 24;
  const active = hour >= 5 && hour < 20;

  for (const b of s.bears) {
    if (b.removedDay !== -1) continue;
    b.fat = Math.max(0, b.fat - burn);

    if ((b.mode === "forage" || b.mode === "rest") && (hour === 5 || (hour === 16 && b.memory >= 0))) decide(s, b, day);

    switch (b.mode) {
      case "forage":
      case "rest": {
        b.mode = active ? "forage" : "rest";
        if (active) {
          b.fat += forestGain;
          // なわばりの中を歩き回る
          b.x = clamp(b.x + (s.rng() - 0.5) * 160 + (b.hx - b.x) * 0.08, 30, MAP_W - 30);
          b.y = clamp(b.y + (s.rng() - 0.5) * 160 + (b.hy - b.y) * 0.08, 30, BUFFER_Y - 60);
        }
        break;
      }
      case "explore": {
        b.tripH++;
        const speed = active ? WALK_MPH : WALK_MPH * 0.6;
        // 緩衝帯: 見通しのよい草地を嫌って引き返す
        if (s.policy.buffer && zoneOf(b.y) === "buffer" && s.rng() < (b.habituated ? 0.1 : 0.3)) {
          b.mode = "return";
          break;
        }
        const k = nearestFood(s, b, SMELL_M);
        if (k >= 0) {
          b.mode = "raid";
          b.target = k;
          break;
        }
        // 人里の開けた場所は怖い。味を知らないクマは畑や町に入ると引き返しやすい
        const z0 = zoneOf(b.y);
        if (!b.habituated && ((z0 === "farm" && s.rng() < 0.12) || (z0 === "town" && s.rng() < 0.3))) {
          b.mode = "return";
          break;
        }
        b.x = clamp(b.x + (s.rng() - 0.5) * speed * 1.4, 30, MAP_W - 30);
        // 森を出るまではまっすぐ下る。畑から先は、味を知らないクマは向きが定まらずにうろつく
        const down = z0 === "forest" || z0 === "buffer" || (b.habituated && z0 === "farm");
        const drift = down ? 0.35 + s.rng() * 0.5 : (s.rng() - 0.5) * 1.2;
        b.y = clamp(b.y + speed * drift, 30, MAP_H - 20);
        // 森の端でも少しは食べられる
        if (zoneOf(b.y) === "buffer") b.fat += forestGain * 0.5;
        if (b.tripH >= EXPLORE_BUDGET_H || b.y >= MAP_H - 30) b.mode = "return";
        break;
      }
      case "raid": {
        b.tripH++;
        if (!foodAvailable(s, b.target)) {
          // なくなっていたら、近くを探し直す
          const k = nearestFood(s, b, SMELL_M);
          if (k >= 0) b.target = k;
          else {
            b.mode = b.tripH < EXPLORE_BUDGET_H ? "explore" : "return";
            if (b.memory === b.target && s.foods[b.target].removed) b.memory = -1;
            break;
          }
        }
        if (s.policy.buffer && zoneOf(b.y) === "buffer" && s.rng() < (b.habituated ? 0.06 : 0.2)) {
          b.mode = "return";
          break;
        }
        const f = s.foods[b.target];
        if (moveToward(b, f.x, f.y, active ? WALK_MPH : WALK_MPH * 0.7)) {
          b.mode = "eat";
          b.eatH = 0;
        }
        break;
      }
      case "eat": {
        const f = s.foods[b.target];
        if (!foodAvailable(s, b.target)) {
          b.mode = "return";
          break;
        }
        const bite = Math.min(f.stock, f.kind === "tree" ? 0.25 : 0.3);
        f.stock -= bite;
        b.fat += bite * (f.kind === "tree" ? 0.13 : 0.12);
        b.eatH++;
        if (b.eatH === 1) {
          if (f.kind === "tree") s.treeMeals++;
          else s.garbageMeals++;
        }
        b.habituated = true;
        b.memory = b.target;
        if (b.eatH >= 5 || f.stock <= 0.01) {
          const k = nearestFood(s, b, SMELL_M);
          if (k >= 0 && b.fat < expectedFat(day) + 0.15) {
            b.mode = "raid";
            b.target = k;
          } else b.mode = "return";
        }
        break;
      }
      case "return": {
        if (moveToward(b, b.hx, b.hy, WALK_MPH * 1.1)) {
          b.mode = active ? "forage" : "rest";
          b.reported = false;
        }
        break;
      }
      case "gone":
        break;
    }

    if (b.removedDay === -1 && b.mode !== "forage" && b.mode !== "rest") {
      recordPresence(s, b);
      people(s, b, hour, day);
    } else if (b.mode === "forage") {
      people(s, b, hour, day);
    }
  }

  s.h += DT;
  if (hourOf(s.h) === 0) endDay(s, day);
}

export function isFinished(s: SimState): boolean {
  return s.h >= HOURS;
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s);
  return s;
}

export function getStats(s: SimState): SimStats {
  let alive = 0;
  let springCulled = 0;
  let outNow = 0;
  let townBears = 0;
  let habituated = 0;
  let fatSum = 0;
  let thin = 0;
  for (const b of s.bears) {
    if (b.removedDay === -2) springCulled++;
    if (b.everTown) townBears++;
    if (b.removedDay !== -1) continue;
    alive++;
    if (b.y >= BUFFER_Y) outNow++;
    if (b.habituated) habituated++;
    fatSum += b.fat;
    if (b.fat < 0.6) thin++;
  }
  return {
    h: s.h,
    day: dayOf(s.h),
    alive,
    springCulled,
    captured: s.captured,
    outNow,
    townBearDays: s.townBearDays,
    farmBearDays: s.farmBearDays,
    townBears,
    encounters: s.encounters,
    injuries: s.injuries,
    injuryExp: s.injuryExp,
    treeMeals: s.treeMeals,
    garbageMeals: s.garbageMeals,
    habituated,
    fatAvg: alive > 0 ? fatSum / alive : 0,
    thinShare: alive > 0 ? thin / alive : 0,
  };
}

export type AggregateStats = Omit<SimStats, "h" | "day" | "outNow"> & {
  /** 人身被害が 1 件以上あった秋の割合 */
  injuryYearShare: number;
};

/** 乱数を変えて runs 回まわした平均 */
export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const keys = [
    "alive",
    "springCulled",
    "captured",
    "townBearDays",
    "farmBearDays",
    "townBears",
    "encounters",
    "injuries",
    "injuryExp",
    "treeMeals",
    "garbageMeals",
    "habituated",
    "fatAvg",
    "thinShare",
  ] as const;
  const acc = Object.fromEntries(keys.map((k) => [k, 0])) as Record<(typeof keys)[number], number>;
  let injuryYears = 0;
  for (let r = 0; r < runs; r++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + r * 7919 }, policy)));
    for (const k of keys) acc[k] += st[k];
    if (st.injuries > 0) injuryYears++;
  }
  for (const k of keys) acc[k] /= runs;
  return { ...acc, injuryYearShare: injuryYears / runs };
}
