/**
 * 救急車の選定療養費シミュレーション: 純粋な計算モデル。
 *
 * ひとつの市を平面の地図として扱い、消防署にいる救急車が 119 番の現場へ向かい、
 * 病院へ運び、署へ戻る様子を 1 日ぶん動かす。
 *
 * 「救急車が必要になった人」(体の具合が悪くなった人) は、どちらの世界でも同じ時刻・同じ場所・同じ重さで現れる。
 * 違うのは、その人が 119 番をするかどうか (費用のルールでやめる人・遅れる人が出る) と、救急車の台数だけ。
 *
 * 時刻はすべて「0:00 からの経過秒」。描画や React に依存しない。
 */

/** 傷病の程度。0 軽症 / 1 中等症 / 2 重症 / 3 心肺停止 */
export type Severity = 0 | 1 | 2 | 3;
export const SEVERITY_LABEL = ["軽症", "中等症", "重症", "心肺停止"] as const;

/** 1 ステップの長さ (秒)。出来事は正確な時刻で処理するので、描画の細かさだけを決める */
export const DT = 10;
/** グラフ用の記録間隔 (秒) */
export const SERIES_EVERY = 300;
/** 道のりは直線距離の何倍か */
export const ROUTE_FACTOR = 1.3;
/** 署にいる救急車が出るまでの準備 (秒) */
export const TURNOUT_SEC = 60;
/** 病院への受け入れの問い合わせ 1 回にかかる時間 (秒) */
export const INQUIRY_SEC = 180;
/** 病院での引き継ぎ (秒) */
export const HANDOVER_SEC = 12 * 60;
/** 119 番から通報がつながるまでの、発症からのふつうの間 (秒) */
export const CALL_DELAY_SEC = 120;
/** 「重い人」は到着がこれより遅れると遅いとみなす (秒) */
export const LATE_SEC = 13 * 60;

export interface Station {
  name: string;
  x: number;
  y: number;
  units: number;
}

export interface Hospital {
  name: string;
  x: number;
  y: number;
  /** 大きな病院 (選定療養費の対象。重い人はここへ運ぶ) */
  large: boolean;
  /** 救急車で来た人を同時に診られる人数 */
  slots: number;
}

export interface DemandCenter {
  x: number;
  y: number;
  /** 広がり (km) */
  sd: number;
  weight: number;
}

export interface SimParams {
  widthKm: number;
  heightKm: number;
  stations: Station[];
  hospitals: Hospital[];
  centers: DemandCenter[];
  /** どこにでも一様に現れる人の割合 */
  uniformShare: number;
  /** 無料のときに 1 日に 119 番をする人の数 (平均) */
  dailyDemand: number;
  /** 時間帯ごとの重み (24 個) */
  hourly: number[];
  /** 程度ごとの割合 (軽症・中等症・重症・心肺停止) */
  severityMix: [number, number, number, number];
  /** 自分で「たぶん軽い」と思う人の割合 (程度ごと) */
  perceiveLow: [number, number, number, number];
  /** 軽症のうち、明らかに緊急性がない人 (病院で選定療養費を取られる人) */
  clearlyNonUrgentShare: number;
  /** 軽症のうち、大きな病院を希望する人 */
  mildPrefersLarge: number;
  /** 費用があると知って「たぶん軽い」と思う人が呼ぶのをやめる割合 */
  deter: number;
  /** 救急車の走る速さ (km/h、サイレンあり) */
  speedKmh: number;
  /** 救急外来で 1 人が場所を使う時間 (分、程度ごと) */
  erMinutes: [number, number, number, number];
  /** 現場での処置の時間 (分) */
  sceneMinutes: number;
  durationSec: number;
  seed: number;
}

export type FeeScope = "none" | "nonUrgent" | "all";

export interface Policy {
  id: string;
  name: string;
  /** 1 回の費用 (円) */
  fee: number;
  /** none: 無料 / nonUrgent: 緊急性がないときだけ (選定療養費) / all: 全員 (有料化) */
  scope: FeeScope;
  /** 呼ぶのをためらった人に #7119 (救急電話相談) を強く案内する */
  triageLine: boolean;
  /** 救急車を何台足すか (人の多い署から順に) */
  extraUnits: number;
}

/** 119 番をしたか */
export type Decision =
  /** すぐ 119 番 */
  | "call"
  /** #7119 に相談してから 119 番 */
  | "advised"
  /** ためらって様子を見て、悪くなってから 119 番 (呼び控え) */
  | "delayed"
  /** 救急車を使わずに自分で受診・様子見 */
  | "self";

export interface Patient {
  id: number;
  x: number;
  y: number;
  severity: Severity;
  /** 具合が悪くなった時刻 (秒) */
  tOnset: number;
  perceivedLow: boolean;
  clearlyNonUrgent: boolean;
  prefersLarge: boolean;
  /** 救急外来の滞在の揺らぎ (倍率) */
  erFactor: number;
  sceneFactor: number;
  decision: Decision;
  /** 119 番の時刻 (秒、呼ばなかったら -1) */
  tCall: number;
  /** --- ここから実行中に決まる --- */
  unit: number;
  tDispatch: number;
  tArrive: number;
  /** 現場を出た時刻 */
  tDepart: number;
  tHospital: number;
  hospital: number;
  inquiries: number;
  /** 近くの署の救急車が出払っていて、ほかの署から来た */
  fromFar: boolean;
  charged: boolean;
}

export type UnitState = "idle" | "toScene" | "onScene" | "inquiring" | "toHospital" | "handover" | "returning";

export interface Unit {
  id: number;
  station: number;
  state: UnitState;
  patient: number;
  /** 動きの始点と終点 (時刻 t0 に (x0,y0)、t1 に (x1,y1)) */
  x0: number;
  y0: number;
  t0: number;
  x1: number;
  y1: number;
  t1: number;
  /** 次の出来事の時刻 (秒) */
  tNext: number;
  /** 問い合わせ中の候補の何番目か */
  candidate: number;
  candidates: number[];
}

export interface Bed {
  until: number;
}

export interface SeriesPoint {
  t: number;
  /** 出動中の救急車の台数 */
  busy: number;
  /** 救急車を待っている 119 番の数 */
  waiting: number;
  /** 大きな病院の救急外来の埋まり (0〜1) */
  erLoad: number;
}

export interface SimState {
  params: SimParams;
  policy: Policy;
  t: number;
  stations: Station[];
  patients: Patient[];
  /** 119 番の時刻順に並べた添字 */
  callOrder: number[];
  nextCall: number;
  units: Unit[];
  beds: Bed[][];
  /** 空いた救急車を待っている 119 番 (先着順) */
  pending: number[];
  series: SeriesPoint[];
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

function normal(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function poisson(rng: () => number, lambda: number): number {
  // 平均が大きいので正規近似で十分
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** 道のりを走る時間 (秒) */
export function travelSec(p: SimParams, km: number): number {
  return ((km * ROUTE_FACTOR) / p.speedKmh) * 3600;
}

/** 費用のルールのもとで、呼ぶのをためらう確率 */
export function holdBackProb(p: SimParams, policy: Policy, pt: Pick<Patient, "severity" | "perceivedLow">): number {
  if (pt.severity === 3 || policy.scope === "none") return 0;
  if (policy.scope === "nonUrgent") return pt.perceivedLow ? p.deter : 0;
  // 全員から取る: 軽いと思う人はより強く、重いと思う人もお金を気にして一部ためらう
  return pt.perceivedLow ? Math.min(1, p.deter * 1.6) : 0.08;
}

/** 救急車の台数を署ごとに決める (足す分は需要の大きい署から順に) */
export function stationsWithExtra(p: SimParams, extra: number): Station[] {
  const st = p.stations.map((s) => ({ ...s }));
  for (let i = 0; i < extra; i++) st[i % st.length].units++;
  return st;
}

/**
 * その日に具合が悪くなる人を全部作り、ルールに従って 119 番をするかどうかを決める。
 * くじは全員が同じ順番で引くので、ルールだけが違う世界を公平に比べられる。
 */
export function createSim(params: SimParams, policy: Policy): SimState {
  const rng = mulberry32(params.seed);
  const n = poisson(rng, params.dailyDemand * (params.durationSec / 86400));
  const hourSum = params.hourly.reduce((a, b) => a + b, 0);
  const centerSum = params.centers.reduce((a, c) => a + c.weight, 0);
  const patients: Patient[] = [];
  for (let i = 0; i < n; i++) {
    // 時刻
    let r = rng() * hourSum;
    let h = 0;
    while (h < 23 && r >= params.hourly[h]) r -= params.hourly[h++];
    const tOnset = Math.min(params.durationSec - 1, (h + rng()) * 3600);
    // 場所
    let x: number;
    let y: number;
    const where = rng();
    const pick = rng() * centerSum;
    const nx = normal(rng);
    const ny = normal(rng);
    if (where < params.uniformShare) {
      x = rng() * params.widthKm;
      y = rng() * params.heightKm;
    } else {
      let acc = 0;
      let c = params.centers[0];
      for (const cc of params.centers) {
        acc += cc.weight;
        if (pick < acc) {
          c = cc;
          break;
        }
      }
      x = c.x + c.sd * nx;
      y = c.y + c.sd * ny;
      rng();
      rng();
    }
    x = Math.min(params.widthKm - 0.2, Math.max(0.2, x));
    y = Math.min(params.heightKm - 0.2, Math.max(0.2, y));
    // 程度
    let sr = rng();
    let sev: Severity = 0;
    for (let k = 0; k < 4; k++) {
      if (sr < params.severityMix[k] || k === 3) {
        sev = k as Severity;
        break;
      }
      sr -= params.severityMix[k];
    }
    const perceivedLow = rng() < params.perceiveLow[sev];
    const nonUrgentLot = rng();
    const clearlyNonUrgent = sev === 0 && perceivedLow && nonUrgentLot < params.clearlyNonUrgentShare / Math.max(1e-6, params.perceiveLow[0]);
    const prefersLarge = sev > 0 || rng() < params.mildPrefersLarge;
    const erFactor = Math.max(0.4, 1 + 0.3 * normal(rng));
    const sceneFactor = Math.max(0.5, 1 + 0.25 * normal(rng));
    // ルールに従う判断 (くじは全員が同じだけ引く)
    const holdLot = rng();
    const consultLot = rng();
    const adviceLot = rng();
    const delayLot = rng();

    let decision: Decision = "call";
    let tCall = tOnset + CALL_DELAY_SEC;
    const pt = { severity: sev, perceivedLow };
    if (holdLot < holdBackProb(params, policy, pt)) {
      if (policy.triageLine && consultLot < 0.8) {
        // #7119: 中等症以上の 9 割と、軽症の 15% に「救急車を」と助言する
        const advised = sev > 0 ? adviceLot < 0.9 : adviceLot < 0.15;
        if (advised) {
          decision = "advised";
          tCall = tOnset + CALL_DELAY_SEC + 8 * 60;
        } else if (sev > 0) {
          decision = "delayed";
          tCall = tOnset + (60 + 180 * delayLot) * 60;
        } else {
          decision = "self";
          tCall = -1;
        }
      } else if (sev > 0) {
        decision = "delayed";
        tCall = tOnset + (60 + 180 * delayLot) * 60;
      } else {
        decision = "self";
        tCall = -1;
      }
    }
    if (tCall >= params.durationSec) tCall = params.durationSec - 1;

    patients.push({
      id: i,
      x,
      y,
      severity: sev,
      tOnset,
      perceivedLow,
      clearlyNonUrgent,
      prefersLarge,
      erFactor,
      sceneFactor,
      decision,
      tCall,
      unit: -1,
      tDispatch: -1,
      tArrive: -1,
      tDepart: -1,
      tHospital: -1,
      hospital: -1,
      inquiries: 0,
      fromFar: false,
      charged: false,
    });
  }
  const callOrder = patients
    .filter((p) => p.tCall >= 0)
    .sort((a, b) => a.tCall - b.tCall || a.id - b.id)
    .map((p) => p.id);

  const stations = stationsWithExtra(params, policy.extraUnits);
  const units: Unit[] = [];
  stations.forEach((s, si) => {
    for (let k = 0; k < s.units; k++) {
      units.push({
        id: units.length,
        station: si,
        state: "idle",
        patient: -1,
        x0: s.x,
        y0: s.y,
        t0: 0,
        x1: s.x,
        y1: s.y,
        t1: 0,
        tNext: Infinity,
        candidate: 0,
        candidates: [],
      });
    }
  });
  const beds = params.hospitals.map((h) => Array.from({ length: h.slots }, () => ({ until: -1 })));

  return {
    params,
    policy,
    t: 0,
    stations,
    patients,
    callOrder,
    nextCall: 0,
    units,
    beds,
    pending: [],
    series: [{ t: 0, busy: 0, waiting: 0, erLoad: 0 }],
  };
}

/** 時刻 t での救急車の位置 */
export function unitPos(u: Unit, t: number): { x: number; y: number } {
  if (u.t1 <= u.t0 || t >= u.t1) return { x: u.x1, y: u.y1 };
  if (t <= u.t0) return { x: u.x0, y: u.y0 };
  const f = (t - u.t0) / (u.t1 - u.t0);
  return { x: u.x0 + (u.x1 - u.x0) * f, y: u.y0 + (u.y1 - u.y0) * f };
}

function moveTo(s: SimState, u: Unit, t: number, x: number, y: number, extraDelay = 0) {
  const pos = unitPos(u, t);
  u.x0 = pos.x;
  u.y0 = pos.y;
  u.t0 = t + extraDelay;
  u.x1 = x;
  u.y1 = y;
  u.t1 = u.t0 + travelSec(s.params, dist(pos.x, pos.y, x, y));
  u.tNext = u.t1;
}

function available(u: Unit): boolean {
  return u.state === "idle" || u.state === "returning";
}

function nearestStation(s: SimState, x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  s.stations.forEach((st, i) => {
    const d = dist(st.x, st.y, x, y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** いちばん早く着ける空いた救急車を出す。空いていなければ false */
function tryDispatch(s: SimState, pid: number, t: number): boolean {
  const pt = s.patients[pid];
  let best: Unit | null = null;
  let bestT = Infinity;
  for (const u of s.units) {
    if (!available(u)) continue;
    const pos = unitPos(u, t);
    const tt = travelSec(s.params, dist(pos.x, pos.y, pt.x, pt.y)) + (u.state === "idle" ? TURNOUT_SEC : 0);
    if (tt < bestT) {
      bestT = tt;
      best = u;
    }
  }
  if (!best) return false;
  const u = best;
  const turnout = u.state === "idle" ? TURNOUT_SEC : 0;
  u.state = "toScene";
  u.patient = pid;
  moveTo(s, u, t, pt.x, pt.y, turnout);
  pt.unit = u.id;
  pt.tDispatch = t;
  pt.fromFar = u.station !== nearestStation(s, pt.x, pt.y);
  return true;
}

/** 運ぶ先の候補を、問い合わせる順に並べる */
export function hospitalCandidates(s: SimState, pt: Patient): number[] {
  const hs = s.params.hospitals.map((h, i) => ({ i, h, d: dist(h.x, h.y, pt.x, pt.y) }));
  const large = hs.filter((e) => e.h.large).sort((a, b) => a.d - b.d).map((e) => e.i);
  const small = hs.filter((e) => !e.h.large).sort((a, b) => a.d - b.d).map((e) => e.i);
  if (pt.severity >= 2) return large;
  if (pt.severity === 1) return [...large, ...small];
  return pt.prefersLarge ? [large[0], ...small, ...large.slice(1)] : [...small, ...large];
}

function canAccept(s: SimState, hi: number, sev: Severity, t: number): number {
  const h = s.params.hospitals[hi];
  if (!h.large && sev >= 2) return -1;
  return s.beds[hi].findIndex((b) => b.until <= t);
}

function processUnit(s: SimState, u: Unit) {
  const t = u.tNext;
  const p = s.params;
  const pt = u.patient >= 0 ? s.patients[u.patient] : null;
  switch (u.state) {
    case "toScene": {
      pt!.tArrive = t;
      u.state = "onScene";
      u.x0 = u.x1;
      u.y0 = u.y1;
      u.t0 = u.t1 = t;
      u.tNext = t + p.sceneMinutes * 60 * pt!.sceneFactor;
      return;
    }
    case "onScene":
    case "inquiring": {
      if (u.state === "onScene") {
        u.candidates = hospitalCandidates(s, pt!);
        u.candidate = 0;
        u.state = "inquiring";
      }
      // 問い合わせ 1 回
      pt!.inquiries++;
      const hi = u.candidates[u.candidate % u.candidates.length];
      const bed = canAccept(s, hi, pt!.severity, t);
      if (bed >= 0) {
        const h = p.hospitals[hi];
        const arriveH = t + travelSec(p, dist(pt!.x, pt!.y, h.x, h.y));
        s.beds[hi][bed].until = arriveH + p.erMinutes[pt!.severity] * 60 * pt!.erFactor;
        pt!.hospital = hi;
        pt!.tDepart = t;
        u.state = "toHospital";
        moveTo(s, u, t, h.x, h.y);
      } else {
        u.candidate++;
        u.tNext = t + INQUIRY_SEC;
      }
      return;
    }
    case "toHospital": {
      pt!.tHospital = t;
      const h = p.hospitals[pt!.hospital];
      const pol = s.policy;
      if (pol.scope === "all") pt!.charged = true;
      else if (pol.scope === "nonUrgent" && h.large && pt!.clearlyNonUrgent && pt!.decision !== "advised") pt!.charged = true;
      u.state = "handover";
      u.x0 = u.x1;
      u.y0 = u.y1;
      u.t0 = u.t1 = t;
      u.tNext = t + HANDOVER_SEC;
      return;
    }
    case "handover": {
      u.patient = -1;
      u.state = "returning";
      const st = s.stations[u.station];
      moveTo(s, u, t, st.x, st.y);
      // 待っている 119 番があれば、ここからすぐ向かう
      serveQueue(s, t);
      return;
    }
    case "returning": {
      u.state = "idle";
      u.tNext = Infinity;
      u.x0 = u.x1;
      u.y0 = u.y1;
      u.t0 = u.t1 = t;
      serveQueue(s, t);
      return;
    }
    default:
      u.tNext = Infinity;
  }
}

function serveQueue(s: SimState, t: number) {
  while (s.pending.length > 0) {
    if (!tryDispatch(s, s.pending[0], t)) return;
    s.pending.shift();
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

/** 出動中の救急車の台数 */
export function busyUnits(s: SimState): number {
  return s.units.filter((u) => u.state !== "idle" && u.state !== "returning").length;
}

/** 大きな病院の救急外来の埋まり (0〜1) */
export function erLoad(s: SimState, t: number = s.t): number {
  let used = 0;
  let total = 0;
  s.params.hospitals.forEach((h, i) => {
    if (!h.large) return;
    total += h.slots;
    for (const b of s.beds[i]) if (b.until > t) used++;
  });
  return total > 0 ? used / total : 0;
}

export function step(s: SimState, dt: number = DT) {
  if (isFinished(s)) return;
  const t1 = Math.min(s.params.durationSec, s.t + dt);
  for (;;) {
    // いちばん早い出来事を 1 つずつ処理する (119 番と救急車の出来事)
    const nextCallT = s.nextCall < s.callOrder.length ? s.patients[s.callOrder[s.nextCall]].tCall : Infinity;
    let nu: Unit | null = null;
    for (const u of s.units) if (u.tNext < t1 && (!nu || u.tNext < nu.tNext)) nu = u;
    const nextUnitT = nu ? nu.tNext : Infinity;
    if (nextCallT >= t1 && nextUnitT >= t1) break;
    if (nextCallT <= nextUnitT) {
      const pid = s.callOrder[s.nextCall++];
      if (s.pending.length > 0 || !tryDispatch(s, pid, nextCallT)) s.pending.push(pid);
    } else {
      processUnit(s, nu!);
    }
  }
  s.t = t1;
  if (Math.floor(t1 / SERIES_EVERY) !== Math.floor((t1 - dt) / SERIES_EVERY)) {
    s.series.push({
      t: t1,
      busy: busyUnits(s),
      waiting: s.pending.length,
      erLoad: Math.round(erLoad(s) * 100) / 100,
    });
  }
}

export function runToEnd(s: SimState): SimState {
  // 集計用は 1 分刻みで回す (出来事の時刻は正確なので結果は同じ)
  while (!isFinished(s)) step(s, 60);
  return s;
}

/** 心肺停止の人が助かる見込み: 発症から救急車が着くまでの分数で下がる (単純化した目安) */
export function arrestSurvival(minutes: number): number {
  return 0.3 * Math.exp(-0.11 * Math.max(0, minutes - 4));
}

export interface SimStats {
  t: number;
  /** 具合が悪くなった人 (これまで) */
  onset: number;
  /** 119 番をした人 */
  calls: number;
  callsMild: number;
  callsSevere: number;
  /** 救急車を使わなかった軽症 */
  selfMild: number;
  /** #7119 に相談してから呼んだ人 */
  advised: number;
  /** ためらって遅れた中等症以上 (呼び控え) */
  delayedSevere: number;
  /** 呼び控えで遅れた時間の合計 (時間) */
  delayHours: number;
  /** 病院へ運んだ人 */
  transported: number;
  transportedMild: number;
  /** 大きな病院へ運んだ人 */
  toLarge: number;
  /** 費用を払った人 */
  charged: number;
  /** 119 番から救急車が着くまでの平均 (分) */
  avgResponseMin: number;
  /** 重症・心肺停止: 119 番から着くまで (分) */
  severeResponseMin: number;
  /** 重症・心肺停止: 着くまで 13 分を超えた割合 */
  severeLateShare: number;
  /** 救急車が着いた重症・心肺停止の人数 */
  severeArrived: number;
  /** 中等症以上: 具合が悪くなってから着くまでの平均 (分) */
  severeOnsetToArriveMin: number;
  /** 近くの署の救急車が出払っていて、ほかの署から来た割合 */
  fromFarShare: number;
  /** 空いた救急車がなく待った 119 番 */
  queued: number;
  /** 搬送困難 (問い合わせ 4 回以上かつ現場 30 分以上) */
  difficult: number;
  /** 心肺停止の人数と、助かる見込みの合計 */
  arrests: number;
  arrestSaved: number;
  /** いま出動中の救急車 */
  busyNow: number;
  waitingNow: number;
}

export function getStats(s: SimState): SimStats {
  let onset = 0;
  let calls = 0;
  let callsMild = 0;
  let callsSevere = 0;
  let selfMild = 0;
  let advised = 0;
  let delayedSevere = 0;
  let delaySec = 0;
  let transported = 0;
  let transportedMild = 0;
  let toLarge = 0;
  let charged = 0;
  let respSum = 0;
  let respN = 0;
  let sevRespSum = 0;
  let sevRespN = 0;
  let sevLate = 0;
  let onsetSum = 0;
  let onsetN = 0;
  let far = 0;
  let queued = 0;
  let difficult = 0;
  let arrests = 0;
  let saved = 0;
  for (const pt of s.patients) {
    if (pt.tOnset > s.t) continue;
    onset++;
    if (pt.decision === "self") {
      if (pt.severity === 0) selfMild++;
      continue;
    }
    if (pt.decision === "delayed" && pt.severity > 0) {
      delayedSevere++;
      delaySec += Math.min(s.t, pt.tCall) - pt.tOnset - CALL_DELAY_SEC;
    }
    if (pt.tCall > s.t) continue;
    calls++;
    if (pt.severity === 0) callsMild++;
    else callsSevere++;
    if (pt.decision === "advised") advised++;
    if (pt.tDispatch < 0 || pt.tDispatch - pt.tCall > 1) queued++;
    if (pt.tArrive >= 0) {
      const r = pt.tArrive - pt.tCall;
      respSum += r;
      respN++;
      if (pt.fromFar) far++;
      if (pt.severity >= 2) {
        sevRespSum += r;
        sevRespN++;
        if (r > LATE_SEC) sevLate++;
      }
      if (pt.severity >= 1) {
        onsetSum += pt.tArrive - pt.tOnset;
        onsetN++;
      }
      if (pt.severity === 3) {
        arrests++;
        saved += arrestSurvival((pt.tArrive - pt.tOnset) / 60);
      }
    }
    if (pt.tHospital >= 0) {
      transported++;
      if (pt.severity === 0) transportedMild++;
      if (s.params.hospitals[pt.hospital].large) toLarge++;
      if (pt.charged) charged++;
    }
    if (pt.tDepart >= 0 && pt.inquiries >= 4 && pt.tDepart - pt.tArrive >= 30 * 60) difficult++;
  }
  return {
    t: s.t,
    onset,
    calls,
    callsMild,
    callsSevere,
    selfMild,
    advised,
    delayedSevere,
    delayHours: delaySec / 3600,
    transported,
    transportedMild,
    toLarge,
    charged,
    avgResponseMin: respN > 0 ? respSum / respN / 60 : 0,
    severeResponseMin: sevRespN > 0 ? sevRespSum / sevRespN / 60 : 0,
    severeLateShare: sevRespN > 0 ? sevLate / sevRespN : 0,
    severeArrived: sevRespN,
    severeOnsetToArriveMin: onsetN > 0 ? onsetSum / onsetN / 60 : 0,
    fromFarShare: respN > 0 ? far / respN : 0,
    queued,
    difficult,
    arrests,
    arrestSaved: saved,
    busyNow: busyUnits(s),
    waitingNow: s.pending.length,
  };
}

export type AggregateStats = Omit<SimStats, "t" | "busyNow" | "waitingNow">;

/** 乱数を変えて runs 日まわした平均 (心肺停止の数と助かる見込みは合計) */
export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const keys = [
    "onset",
    "calls",
    "callsMild",
    "callsSevere",
    "selfMild",
    "advised",
    "delayedSevere",
    "delayHours",
    "transported",
    "transportedMild",
    "toLarge",
    "charged",
    "avgResponseMin",
    "severeResponseMin",
    "severeLateShare",
    "severeArrived",
    "severeOnsetToArriveMin",
    "fromFarShare",
    "queued",
    "difficult",
    "arrests",
    "arrestSaved",
  ] as const;
  const acc = Object.fromEntries(keys.map((k) => [k, 0])) as Record<(typeof keys)[number], number>;
  // 平均の時間・割合は、日ごとではなく件数で重みづける
  let respW = 0;
  let sevW = 0;
  let onsetW = 0;
  for (let r = 0; r < runs; r++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + r * 7919 }, policy)));
    for (const k of keys) {
      if (k === "avgResponseMin" || k === "fromFarShare") acc[k] += st[k] * st.calls;
      else if (k === "severeResponseMin" || k === "severeLateShare") acc[k] += st[k] * st.severeArrived;
      else if (k === "severeOnsetToArriveMin") acc[k] += st[k] * st.callsSevere;
      else acc[k] += st[k];
    }
    respW += st.calls;
    sevW += st.severeArrived;
    onsetW += st.callsSevere;
  }
  const out = {} as AggregateStats;
  for (const k of keys) {
    if (k === "avgResponseMin" || k === "fromFarShare") out[k] = respW > 0 ? acc[k] / respW : 0;
    else if (k === "severeResponseMin" || k === "severeLateShare") out[k] = sevW > 0 ? acc[k] / sevW : 0;
    else if (k === "severeOnsetToArriveMin") out[k] = onsetW > 0 ? acc[k] / onsetW : 0;
    else if (k === "arrests" || k === "arrestSaved") out[k] = acc[k];
    else out[k] = acc[k] / runs;
  }
  return out;
}

/** 経過秒 → "14:05" */
export function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const h = Math.floor(m / 60) % 24;
  return `${h}:${String(m % 60).padStart(2, "0")}`;
}
