import { CAR_LEN, kmh, type Car, type Encounter, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  pedestrian: string;
  hit: string;
  safe: string;
}

/** 横幅はキャンバスの表示幅に合わせる (スマホでも文字が潰れないように)。高さは固定 */
export const CANVAS_W = 640;
export const CANVAS_H = 150;

const ROAD_TOP = 72;
const ROAD_H = 34;
/** 結末の印を何秒間残すか */
const MARK_SEC = 5;

/**
 * 1 つの世界 (上限 60 / 上限 30) の道路を 1 枚のキャンバスに描く。
 * 左が住宅地の入口、右が幹線道路への出口。
 */
export function renderSim(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  theme: RenderTheme,
  carColor: string,
  width: number = CANVAS_W,
) {
  const W = width;
  const H = CANVAS_H;
  const narrow = W < 480;
  const MARGIN_L = narrow ? 44 : 56;
  const MARGIN_R = narrow ? 40 : 56;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const L = s.params.roadLengthM;
  const roadW = W - MARGIN_L - MARGIN_R;
  const x = (m: number) => MARGIN_L + (m / L) * roadW;
  const midY = ROAD_TOP + ROAD_H / 2;

  // 道路
  ctx.fillStyle = theme.grid;
  ctx.fillRect(MARGIN_L, ROAD_TOP, roadW, ROAD_H);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_L, ROAD_TOP);
  ctx.lineTo(MARGIN_L + roadW, ROAD_TOP);
  ctx.moveTo(MARGIN_L, ROAD_TOP + ROAD_H);
  ctx.lineTo(MARGIN_L + roadW, ROAD_TOP + ROAD_H);
  ctx.stroke();

  // 100 m ごとの目盛り
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let tick = 100;
  while ((tick / L) * roadW < 40) tick *= tick === 100 ? 2.5 : 2;
  for (let m = 0; m <= L + 1e-6; m += tick) {
    ctx.fillRect(x(m) - 0.5, ROAD_TOP + ROAD_H, 1, 4);
    ctx.fillText(`${m}m`, x(m), ROAD_TOP + ROAD_H + 15);
  }

  // 一時停止の線
  for (const line of s.stopLines) {
    ctx.fillStyle = theme.fg;
    ctx.fillRect(x(line) - 1, ROAD_TOP + 2, 2, ROAD_H - 4);
    ctx.fillStyle = theme.muted;
    ctx.fillText("止まれ", x(line), ROAD_TOP - 6);
  }

  // 入口と出口
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "right";
  ctx.fillText("住宅地", MARGIN_L - 6, midY - 2);
  ctx.fillText("入口 →", MARGIN_L - 6, midY + 12);
  ctx.textAlign = "left";
  ctx.fillText("幹線", MARGIN_L + roadW + 6, midY - 2);
  ctx.fillText("道路へ", MARGIN_L + roadW + 6, midY + 12);

  // 入口で待っている車
  if (s.entryQueue.length > 0) {
    ctx.textAlign = "right";
    ctx.fillStyle = theme.muted;
    ctx.fillText(`待ち ${s.entryQueue.length}`, MARGIN_L - 6, ROAD_TOP + ROAD_H + 15);
  }

  // これまでにぶつかった場所 (道路の下の小さな印)
  for (const e of s.encounters) {
    if (!e.hit) continue;
    ctx.globalAlpha = 0.35 + Math.min(0.65, e.fatality * 4);
    ctx.fillStyle = theme.hit;
    ctx.fillRect(x(e.pedPos) - 1.5, ROAD_TOP + ROAD_H + 20, 3, 8);
  }
  ctx.globalAlpha = 1;

  // 最近の飛び出しと、その結末
  for (const e of s.encounters) {
    const age = s.t - e.t;
    if (age > MARK_SEC + 3) continue;
    drawEncounter(ctx, e, x(e.pedPos), age, theme);
  }

  // 車 (速度の数字が隣の車と重なるときは後ろの車の数字を省く)
  let lastLabelX = Infinity;
  for (const id of s.onRoad) {
    const car = s.cars[id - 1];
    const showLabel = lastLabelX - x(car.pos) > 22;
    drawCar(ctx, car, x, midY, theme, carColor, roadW / L, showLabel);
    if (showLabel && car.v >= 0.5) lastLabelX = x(car.pos);
  }

  // 見出しの集計
  const hits = s.encounters.filter((e) => e.hit).length;
  ctx.textAlign = "left";
  ctx.font = "600 12px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`飛び出し ${s.encounters.length} 回`, 12, 20);
  ctx.fillStyle = hits > 0 ? theme.hit : theme.fg;
  ctx.fillText(`ぶつかった ${hits} 回`, narrow ? 104 : 120, 20);
  ctx.textAlign = "right";
  ctx.fillStyle = theme.muted;
  ctx.font = "11px sans-serif";
  ctx.fillText(narrow ? `通過 ${s.done} 台` : `幹線道路に出た車 ${s.done} 台`, W - 12, 20);
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  car: Car,
  x: (m: number) => number,
  midY: number,
  theme: RenderTheme,
  color: string,
  pxPerM: number,
  showLabel: boolean,
) {
  const len = Math.max(12, CAR_LEN * pxPerM);
  const front = x(car.pos);
  const h = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(front - len, midY + 2, len, h, 3);
  ctx.fill();
  // ブレーキランプ
  if (car.emergency || car.waitUntil >= 0) {
    ctx.fillStyle = theme.hit;
    ctx.fillRect(front - len, midY + 3, 2, h - 2);
  }
  // 速度 (止まっている車は数字を出さない。一時停止で並ぶと重なるので)
  if (!showLabel || car.v < 0.5) return;
  ctx.font = "600 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`${Math.round(kmh(car.v))}`, front - len / 2, midY - 2);
}

function drawEncounter(ctx: CanvasRenderingContext2D, e: Encounter, px: number, age: number, theme: RenderTheme) {
  const fade = age > MARK_SEC ? Math.max(0, 1 - (age - MARK_SEC) / 3) : 1;
  ctx.globalAlpha = fade;
  const pedY = ROAD_TOP + 9;
  // 人
  ctx.beginPath();
  ctx.arc(px, pedY, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = theme.pedestrian;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.bg;
  ctx.stroke();

  // 結末: ぶつかった速度か、止まれた余裕
  const outcomeKnown = age > 0.3;
  if (outcomeKnown) {
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "center";
    if (e.hit) {
      ctx.fillStyle = theme.hit;
      ctx.beginPath();
      ctx.arc(px, pedY, 9, 0, Math.PI * 2);
      ctx.strokeStyle = theme.hit;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillText(`${Math.round(e.impactKmh)}km/h 衝突`, px, ROAD_TOP - 20);
      ctx.font = "10px sans-serif";
      ctx.fillText(`致死率 ${(e.fatality * 100).toFixed(1)}%`, px, ROAD_TOP - 32);
    } else {
      ctx.fillStyle = theme.safe;
      ctx.fillText(`止まれた (${e.margin.toFixed(1)}m 手前)`, px, ROAD_TOP - 20);
    }
  }
  ctx.globalAlpha = 1;
}
