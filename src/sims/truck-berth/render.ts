import { DAY_START_HOUR, LIMIT_MIN, boundOf, clock, type SimState, type Truck } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  ok: string;
  warn: string;
  crit: string;
  work: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 456;

const AREA_TOP = 80;
const AREA_BOTTOM = 372;
const YARD_X = 10;
const YARD_W = 176;
const DOCK_X = 200;
const DOCK_W = 110;
const TRUCK_W = 30;
const TRUCK_H = 15;
const TL_Y = 408;

/** 荷待ち + 荷役の長さで色を変える (1 時間まで / 2 時間まで / 2 時間超) */
function boundColor(tr: Truck, t: number, theme: RenderTheme): string {
  const b = boundOf(tr, t);
  if (b > LIMIT_MIN) return theme.crit;
  if (b > 60) return theme.warn;
  return theme.ok;
}

function drawTruck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  theme: RenderTheme,
  booked: boolean,
) {
  const cab = Math.round(w * 0.28);
  ctx.fillStyle = fill;
  // 荷台
  ctx.fillRect(x, y, w - cab - 1, h);
  // 運転席
  ctx.fillRect(x + w - cab, y + h * 0.3, cab, h * 0.7);
  if (booked) {
    // 予約車: 荷台に白い帯
    ctx.fillStyle = theme.fg;
    ctx.fillRect(x + 3, y + h / 2 - 1.5, w - cab - 7, 3);
  }
}

/**
 * 1 つのやり方 (firstCome / reservation) を 1 枚のキャンバスに描く。
 * 左が構内・路上の待機場所、右が物流センターのバース、下が 1 日のタイムライン。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const p = s.params;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 時計と進み具合
  const done = s.trucks.filter((tr) => tr.state === "done").length;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "700 22px ui-monospace, monospace";
  ctx.fillStyle = theme.fg;
  ctx.fillText(clock(s.t), YARD_X, 30);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(s.t < p.openAt ? `荷受け開始 ${clock(p.openAt)}` : "荷受け中", YARD_X, 46);
  ctx.textAlign = "right";
  ctx.font = "700 14px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`${done} / ${s.trucks.length} 台`, W - 10, 28);
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("荷降ろし完了", W - 10, 42);

  // 待機場所
  const waiting = s.trucks
    .filter((tr) => tr.state === "waiting")
    .sort((a, b) => a.tArrive - b.tArrive);
  ctx.strokeStyle = theme.border;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(YARD_X + 0.5, AREA_TOP + 0.5, YARD_W, AREA_BOTTOM - AREA_TOP);
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(`待機中 ${waiting.length} 台 (構内・路上)`, YARD_X, AREA_TOP - 6);
  const cols = 5;
  const cellW = YARD_W / cols;
  const cellH = 22;
  const maxRows = Math.floor((AREA_BOTTOM - AREA_TOP - 8) / cellH);
  const maxShow = cols * maxRows;
  for (let i = 0; i < Math.min(waiting.length, maxShow); i++) {
    const tr = waiting[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = YARD_X + col * cellW + (cellW - TRUCK_W) / 2;
    const y = AREA_TOP + 8 + row * cellH;
    drawTruck(ctx, x, y, TRUCK_W, TRUCK_H, boundColor(tr, s.t, theme), theme, tr.booked && !tr.lost);
  }
  if (waiting.length > maxShow) {
    ctx.fillStyle = theme.muted;
    ctx.font = "11px sans-serif";
    ctx.fillText(`ほか ${waiting.length - maxShow} 台`, YARD_X + 6, AREA_BOTTOM - 6);
  }

  // バース
  ctx.fillStyle = theme.grid;
  ctx.fillRect(DOCK_X, AREA_TOP, DOCK_W, AREA_BOTTOM - AREA_TOP);
  ctx.textAlign = "left";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("バース", DOCK_X, AREA_TOP - 6);
  const rowH = Math.min(56, (AREA_BOTTOM - AREA_TOP) / p.berths);
  for (let b = 0; b < p.berths; b++) {
    const y0 = AREA_TOP + b * rowH;
    ctx.strokeStyle = theme.border;
    ctx.beginPath();
    ctx.moveTo(DOCK_X, y0 + rowH);
    ctx.lineTo(DOCK_X + DOCK_W, y0 + rowH);
    ctx.stroke();
    ctx.fillStyle = theme.muted;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(`B${b + 1}`, DOCK_X + 4, y0 + 12);
    const id = s.berths[b];
    if (id === 0) {
      ctx.fillText("空き", DOCK_X + 30, y0 + rowH / 2 + 4);
      continue;
    }
    const tr = s.trucks[id - 1];
    const th = Math.min(20, rowH - 16);
    const tw = Math.round(th * 2.6);
    const tx = DOCK_X + DOCK_W - tw - 6;
    const ty = y0 + (rowH - th) / 2 - 3;
    drawTruck(ctx, tx, ty, tw, th, boundColor(tr, s.t, theme), theme, tr.booked && !tr.lost);
    // 荷降ろしの進み具合
    const prog = Math.min(1, (s.t - tr.tDock) / tr.service);
    const by = ty + th + 4;
    ctx.fillStyle = theme.border;
    ctx.fillRect(tx, by, tw, 3);
    ctx.fillStyle = theme.work;
    ctx.fillRect(tx, by, tw * prog, 3);
  }

  // タイムライン
  const tlX0 = 10;
  const tlX1 = W - 10;
  const tx = (t: number) => tlX0 + (t / p.durationMin) * (tlX1 - tlX0);
  // 午前便・午後便の時間帯
  ctx.fillStyle = theme.grid;
  ctx.fillRect(tx(p.amWindow[0]), TL_Y - 8, tx(p.pmWindow[1]) - tx(p.amWindow[0]), 16);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(tlX0, TL_Y);
  ctx.lineTo(tlX1, TL_Y);
  ctx.stroke();
  // 予約枠
  if (s.policy === "reservation") {
    ctx.strokeStyle = theme.muted;
    ctx.beginPath();
    for (const tr of s.trucks) {
      if (tr.slot < 0) continue;
      const x = Math.round(tx(tr.slot)) + 0.5;
      ctx.moveTo(x, TL_Y - 6);
      ctx.lineTo(x, TL_Y + 6);
    }
    ctx.stroke();
  }
  // 到着したトラック (下側に小さな点)
  for (const tr of s.trucks) {
    if (tr.state === "enroute") continue;
    ctx.fillStyle = tr.state === "done" ? theme.muted : boundColor(tr, s.t, theme);
    ctx.fillRect(tx(tr.tArrive) - 1, TL_Y + 9, 2, 5);
  }
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  for (let h = DAY_START_HOUR; h * 60 <= DAY_START_HOUR * 60 + p.durationMin; h += 4) {
    ctx.fillText(`${h}:00`, Math.min(tlX1 - 14, Math.max(tlX0 + 14, tx((h - DAY_START_HOUR) * 60))), TL_Y + 28);
  }
  // 現在時刻
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx(s.t), TL_Y - 12);
  ctx.lineTo(tx(s.t), TL_Y + 14);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.textAlign = "left";
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(s.policy === "reservation" ? "納品時間帯と予約枠 (縦線)" : "納品時間帯", tlX0, TL_Y - 14);
}
