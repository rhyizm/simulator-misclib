import {
  LANES,
  PEAK_FROM_MIN,
  PEAK_TO_MIN,
  START_MIN,
  capacityAt,
  clockToT,
  fmtClockMin,
  queueKm,
  queueLength,
  tToClock,
  waitNowMin,
  type CarKind,
  type SimState,
} from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  jam: string;
  shifted: string;
  rebound: string;
  capacity: string;
}

export const CANVAS_W = 360;
export const CANVAS_H = 262;

const ROAD_L = 10;
const CROSS_X = 296;
const ROAD_R = CANVAS_W - 8;
const ROAD_Y = 52;
const ROAD_H = 22;
/** 道に描く長さ (交差点の手前 4 km) */
const ROAD_KM = 4;
const PX_PER_M = (CROSS_X - ROAD_L) / (ROAD_KM * 1000);
/** 行列の外を走る車の速さ (m/s、40 km/h) */
const FREE_MPS = 40 / 3.6;
const VPX = PX_PER_M * FREE_MPS;

const HIST_TOP = 118;
const HIST_BOTTOM = 232;
const HIST_L = 10;
const HIST_R = CANVAS_W - 8;
const HIST_MIN = 210;
const BIN_MIN = 5;
const BINS = HIST_MIN / BIN_MIN;

function kindColor(kind: CarKind, th: RenderTheme): string {
  if (kind === "early" || kind === "late") return th.shifted;
  if (kind === "rebound") return th.rebound;
  return th.muted;
}

/** 1 日分のビンの合計 (未来の分も含む) は世界ごとに変わらないので覚えておく */
const totalBinsCache = new WeakMap<SimState, number[]>();
function totalBins(s: SimState): number[] {
  let b = totalBinsCache.get(s);
  if (!b) {
    b = new Array(BINS).fill(0);
    for (const c of s.cars) {
      const i = Math.floor(c.tArrive / 60 / BIN_MIN);
      if (i >= 0 && i < BINS) b[i]++;
    }
    totalBinsCache.set(s, b);
  }
  return b;
}

/**
 * 1 つの世界を 1 枚のキャンバスに描く。
 * 上: 交差点の手前 4 km の道と、そこに伸びる行列。
 * 下: 5 分ごとに交差点へ来た台数 (時間をずらした車は色つき) と、交差点が通せる台数の線。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, th: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  const q = queueLength(s);
  const km = queueKm(q);
  const wait = waitNowMin(s);

  // 時計と行列の状態
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = th.fg;
  ctx.font = "600 20px ui-monospace, monospace";
  ctx.fillText(fmtClockMin(tToClock(s.t)), ROAD_L, 24);
  ctx.textAlign = "right";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = q > 0 && wait >= 1 ? th.jam : th.muted;
  ctx.fillText(
    q === 0 ? "行列なし" : `行列 ${km.toFixed(1)} km (${q} 台)・いま着くと ${wait.toFixed(0)} 分待ち`,
    W - 8,
    22,
  );

  // 道
  ctx.fillStyle = th.grid;
  ctx.fillRect(ROAD_L, ROAD_Y, ROAD_R - ROAD_L, ROAD_H);
  ctx.strokeStyle = th.border;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(ROAD_L, ROAD_Y + ROAD_H / 2);
  ctx.lineTo(ROAD_R, ROAD_Y + ROAD_H / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 行列 (2 車線に 7 m おきに並ぶとして長さに換算)
  const qLenPx = Math.min(CROSS_X - ROAD_L, km * 1000 * PX_PER_M);
  if (q > 0) {
    ctx.fillStyle = th.jam;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(CROSS_X - qLenPx, ROAD_Y + 2, qLenPx, ROAD_H - 4);
    ctx.globalAlpha = 1;
    if (km > ROAD_KM) {
      ctx.fillStyle = th.jam;
      ctx.font = "600 11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`◀ ${ROAD_KM} km より先まで`, ROAD_L, ROAD_Y - 6);
    }
  }
  const tailX = CROSS_X - qLenPx;

  // 行列の後ろへ向かって走ってくる車
  const lookahead = (tailX - ROAD_L) / VPX;
  for (let i = s.nextArrival; i < s.cars.length; i++) {
    const c = s.cars[i];
    const dt = c.tArrive - s.t;
    if (dt > lookahead) break;
    const x = tailX - dt * VPX;
    const lane = c.id % LANES;
    ctx.fillStyle = kindColor(c.kind, th);
    ctx.fillRect(x - 1.5, ROAD_Y + 4 + lane * (ROAD_H / 2), 3, ROAD_H / 2 - 8 + 2);
  }
  // 交差点を抜けて中心部へ向かう車
  const after = (ROAD_R - CROSS_X) / VPX;
  for (let i = s.head - 1; i >= 0; i--) {
    const c = s.cars[i];
    const dt = s.t - c.tPass;
    if (dt > after) break;
    const x = CROSS_X + dt * VPX;
    const lane = c.id % LANES;
    ctx.fillStyle = kindColor(c.kind, th);
    ctx.fillRect(x - 1.5, ROAD_Y + 4 + lane * (ROAD_H / 2), 3, ROAD_H / 2 - 8 + 2);
  }

  // 交差点 (通せる台数が落ちているときは色を変える)
  const capNow = capacityAt(s, s.t);
  const reduced = capNow < s.capacityToday * 0.99;
  ctx.fillStyle = reduced ? th.jam : th.fg;
  ctx.fillRect(CROSS_X - 1, ROAD_Y - 4, 3, ROAD_H + 8);
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = reduced ? th.jam : th.muted;
  ctx.fillText(reduced ? `事故 ${Math.round(capNow)} 台/分` : `交差点 ${Math.round(capNow)} 台/分`, CROSS_X - 4, ROAD_Y + ROAD_H + 16);
  ctx.textAlign = "left";
  ctx.fillStyle = th.muted;
  ctx.fillText(`← ${ROAD_KM} km 手前`, ROAD_L, ROAD_Y + ROAD_H + 16);
  ctx.textAlign = "right";
  ctx.fillText("中心部", ROAD_R, ROAD_Y - 6);

  // 5 分ごとの到着台数
  const bins: Record<"normal" | "shifted" | "rebound", number[]> = {
    normal: new Array(BINS).fill(0),
    shifted: new Array(BINS).fill(0),
    rebound: new Array(BINS).fill(0),
  };
  for (let i = 0; i < s.nextArrival; i++) {
    const c = s.cars[i];
    const b = Math.floor(c.tArrive / 60 / BIN_MIN);
    if (b < 0 || b >= BINS) continue;
    const k = c.kind === "early" || c.kind === "late" ? "shifted" : c.kind === "rebound" ? "rebound" : "normal";
    bins[k][b]++;
  }
  const total = totalBins(s);
  const capBin = s.capacityToday * BIN_MIN;
  const yMax = Math.max(Math.ceil((capBin * 1.9) / 50) * 50, Math.ceil(Math.max(...total) / 50) * 50);
  const binW = (HIST_R - HIST_L) / BINS;
  const xOfMin = (clockMin: number) => HIST_L + ((clockMin - START_MIN) / HIST_MIN) * (HIST_R - HIST_L);
  const yOf = (v: number) => HIST_BOTTOM - (v / yMax) * (HIST_BOTTOM - HIST_TOP);

  // ピークの時間帯
  ctx.fillStyle = th.grid;
  ctx.fillRect(xOfMin(PEAK_FROM_MIN), HIST_TOP, xOfMin(PEAK_TO_MIN) - xOfMin(PEAK_FROM_MIN), HIST_BOTTOM - HIST_TOP);
  ctx.fillStyle = th.muted;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ピーク 7:30〜8:30", (xOfMin(PEAK_FROM_MIN) + xOfMin(PEAK_TO_MIN)) / 2, HIST_TOP - 4);
  ctx.textAlign = "left";
  ctx.fillText("5 分ごとに来た台数", HIST_L, HIST_TOP - 4);

  for (let b = 0; b < BINS; b++) {
    const x = HIST_L + b * binW + 0.5;
    const w = binW - 1;
    // この日に来る予定の台数 (まだ来ていない分は枠だけ)
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 1;
    if (total[b] > 0) ctx.strokeRect(x + 0.5, yOf(total[b]) + 0.5, w - 1, HIST_BOTTOM - yOf(total[b]) - 0.5);
    let acc = 0;
    for (const k of ["normal", "rebound", "shifted"] as const) {
      const v = bins[k][b];
      if (v === 0) continue;
      ctx.fillStyle = k === "normal" ? th.muted : k === "rebound" ? th.rebound : th.shifted;
      ctx.globalAlpha = k === "normal" ? 0.55 : 1;
      ctx.fillRect(x, yOf(acc + v), w, yOf(acc) - yOf(acc + v));
      ctx.globalAlpha = 1;
      acc += v;
    }
  }

  // 交差点が 5 分に通せる台数
  ctx.strokeStyle = th.capacity;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  for (let b = 0; b <= BINS; b++) {
    const t = clockToT(START_MIN + Math.min(b, BINS - 1) * BIN_MIN + 0.5);
    const y = yOf(capacityAt(s, t) * BIN_MIN);
    const x = HIST_L + b * binW;
    if (b === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    if (b < BINS) ctx.lineTo(x + binW, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.fillStyle = th.capacity;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`通せる台数 ${Math.round(capBin)}`, HIST_R, yOf(capBin) - 4);

  // 今の時刻
  const xNow = xOfMin(tToClock(Math.min(s.t, HIST_MIN * 60)));
  ctx.strokeStyle = th.fg;
  ctx.beginPath();
  ctx.moveTo(xNow + 0.5, HIST_TOP);
  ctx.lineTo(xNow + 0.5, HIST_BOTTOM);
  ctx.stroke();

  // 軸
  ctx.strokeStyle = th.border;
  ctx.beginPath();
  ctx.moveTo(HIST_L, HIST_BOTTOM + 0.5);
  ctx.lineTo(HIST_R, HIST_BOTTOM + 0.5);
  ctx.stroke();
  ctx.fillStyle = th.muted;
  ctx.textAlign = "center";
  for (const m of [6 * 60 + 30, 7 * 60 + 30, 8 * 60 + 30, 9 * 60 + 30]) {
    ctx.fillText(fmtClockMin(m), xOfMin(m), HIST_BOTTOM + 13);
  }
  ctx.textAlign = "right";
  ctx.fillText(`${yMax}`, HIST_R, HIST_TOP + 10);
}
