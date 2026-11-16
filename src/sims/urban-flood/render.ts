import {
  HOUSES,
  UP_FLAT,
  UP_SLOPE,
  houseFloor,
  houseGround,
  slotHeight,
  type SimState,
} from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  water: string;
  accent: string;
  warn: string;
  danger: string;
}

export const CANVAS_W = 360;
export const CANVAS_H = 262;

/* 住宅街 (左) */
const H_CX = 108;
const H_HALF = 96;
const H_BOTTOM = 188;
/** 1 m を何 px で描くか (くぼ地) */
const H_SCALE = 62;
const SHOW_HOUSES = 22;

/* アンダーパス (右) */
const U_CX = 292;
const U_TOP = 96;
const U_DEPTH = 4;
const U_VSCALE = 20;
const U_HSCALE = 0.62;
const U_BOTTOM = U_TOP + U_DEPTH * U_VSCALE;

/** くぼ地の中心からの距離の割合 f (0〜1) での地面の高さ (m) */
function groundAt(f: number): number {
  return houseGround(Math.min(HOUSES - 1, Math.max(0, f * HOUSES - 0.5)));
}

/** アンダーパスの中心からの水平距離 (m) での路面の高さ (底から m) */
function roadAt(d: number): number {
  return Math.min(U_DEPTH, Math.max(0, Math.abs(d) - UP_FLAT / 2) * UP_SLOPE);
}

export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  const r = s.rain[Math.max(0, s.t - 1)] ?? 0;
  drawRain(ctx, s, r, theme);
  drawHollow(ctx, s, theme);
  drawUnderground(ctx, s, theme);
  drawUnderpass(ctx, s, r, theme);
}

function drawRain(ctx: CanvasRenderingContext2D, s: SimState, r: number, theme: RenderTheme) {
  // 雨粒: 強さに比例した本数を、時刻で決まる位置に描く (乱数を使わず毎回同じ絵)
  const n = Math.round(r * 0.9);
  ctx.strokeStyle = theme.water;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const x = (i * 97.13 + s.t * 13.7) % CANVAS_W;
    const y = 30 + ((i * 53.71 + s.t * 29.3) % 52);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = "600 12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`雨 ${r.toFixed(0)} mm/h`, 8, 18);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  const cap = s.policy.capacityMm;
  ctx.fillText(`(下水道は ${cap} mm/h まで)`, 84, 18);
  // 能力を超えているかのバー
  const barX = 236;
  const barW = 116;
  const maxMm = 150;
  ctx.fillStyle = theme.grid;
  ctx.fillRect(barX, 9, barW, 8);
  ctx.fillStyle = r > cap ? theme.danger : theme.water;
  ctx.fillRect(barX, 9, Math.min(1, r / maxMm) * barW, 8);
  ctx.strokeStyle = theme.fg;
  ctx.beginPath();
  const cx = barX + (cap / maxMm) * barW;
  ctx.moveTo(cx + 0.5, 6);
  ctx.lineTo(cx + 0.5, 20);
  ctx.stroke();
}

function drawHollow(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const y = (e: number) => H_BOTTOM - e * H_SCALE;
  const xAt = (f: number, side: number) => H_CX + side * f * H_HALF;

  // 地面
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const f = 1 - i / 40;
    pts.push([xAt(f, -1), y(groundAt(f))]);
  }
  for (let i = 1; i <= 40; i++) {
    const f = i / 40;
    pts.push([xAt(f, 1), y(groundAt(f))]);
  }
  // 水
  const h = s.hollowH;
  if (h > 0.003) {
    ctx.beginPath();
    let started = false;
    for (const [px, py] of pts) {
      const wy = y(h);
      if (py > wy) {
        if (!started) {
          ctx.moveTo(px, wy);
          started = true;
        }
        ctx.lineTo(px, py);
      }
    }
    // 右端の水面へ戻る
    const right = pts.filter(([, py]) => py > y(h)).pop();
    if (right) ctx.lineTo(right[0], y(h));
    ctx.closePath();
    ctx.fillStyle = theme.water;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 家 (600 戸のうち代表の 22 戸)
  for (let i = 0; i < SHOW_HOUSES; i++) {
    const j = Math.floor(((i + 0.5) / SHOW_HOUSES) * HOUSES);
    const f = (j + 0.5) / HOUSES;
    const side = i % 2 === 0 ? -1 : 1;
    const px = xAt(f, side) - side * 2;
    const g = houseGround(j);
    const floor = houseFloor(j);
    const depth = h - g;
    const state = depth > floor ? "above" : depth > 0 ? "below" : "dry";
    const hw = 8;
    const top = y(g) - 14;
    ctx.fillStyle = state === "above" ? theme.danger : state === "below" ? theme.warn : theme.bg;
    ctx.strokeStyle = state === "dry" ? theme.muted : ctx.fillStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - hw / 2, y(g));
    ctx.lineTo(px - hw / 2, top + 4);
    ctx.lineTo(px, top);
    ctx.lineTo(px + hw / 2, top + 4);
    ctx.lineTo(px + hw / 2, y(g));
    ctx.closePath();
    ctx.globalAlpha = state === "dry" ? 1 : 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }

  ctx.font = "600 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.fg;
  ctx.fillText("住宅街のくぼ地 (600 戸)", 8, 38);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(`水深 ${h < 0.005 ? "0" : (h * 100).toFixed(0)} cm`, 8, 52);
  ctx.fillStyle = theme.danger;
  ctx.fillText(`床上 ${s.aboveFloor} 戸`, 8, 66);
  ctx.fillStyle = theme.warn;
  ctx.fillText(`床下 ${s.belowFloor} 戸`, 72, 66);
}

function drawUnderground(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const top = 202;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  // 下水道の幹線
  const pipeX = 12;
  const pipeW = 120;
  ctx.fillStyle = theme.muted;
  ctx.fillText("下水道", pipeX, top + 8);
  roundRect(ctx, pipeX, top + 14, pipeW, 12, 6);
  ctx.fillStyle = theme.grid;
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  const load = Math.max(0, Math.min(1, s.pipeLoad));
  if (load > 0) {
    roundRect(ctx, pipeX + 1, top + 15, (pipeW - 2) * load, 10, 5);
    ctx.fillStyle = load >= 0.999 ? theme.danger : theme.water;
    ctx.fill();
  }
  ctx.fillStyle = theme.fg;
  ctx.fillText(load >= 0.999 ? "満杯 (あふれる)" : `${Math.round(load * 100)}%`, pipeX, top + 42);

  // 貯留槽
  const tx = 148;
  const tw = 60;
  const th = 36;
  const ty = top + 2;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  if (s.policy.tankM3 <= 0) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = theme.border;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw, th);
    ctx.setLineDash([]);
    ctx.fillText("貯留槽なし", tx + tw / 2, ty + th / 2 + 4);
  } else {
    const fill = Math.min(1, s.tank / s.policy.tankM3);
    ctx.fillStyle = theme.water;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(tx, ty + th * (1 - fill), tw, th * fill);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fill >= 0.999 ? theme.danger : theme.border;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw, th);
    ctx.fillStyle = theme.fg;
    ctx.fillText(`貯留槽 ${Math.round(fill * 100)}%`, tx + tw / 2, ty + th + 14);
  }
  ctx.textAlign = "left";
}

function drawUnderpass(ctx: CanvasRenderingContext2D, s: SimState, r: number, theme: RenderTheme) {
  const halfM = UP_FLAT / 2 + U_DEPTH / UP_SLOPE;
  const xOf = (d: number) => U_CX + d * U_HSCALE;
  const yOf = (e: number) => U_BOTTOM - e * U_VSCALE;
  const left = -halfM - 10;
  const right = halfM + 10;

  // 水
  const h = s.underH;
  if (h > 0.003) {
    const reach = UP_FLAT / 2 + h / UP_SLOPE;
    ctx.beginPath();
    ctx.moveTo(xOf(-reach), yOf(h));
    ctx.lineTo(xOf(-UP_FLAT / 2), yOf(0));
    ctx.lineTo(xOf(UP_FLAT / 2), yOf(0));
    ctx.lineTo(xOf(reach), yOf(h));
    ctx.closePath();
    ctx.fillStyle = theme.water;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 路面
  ctx.beginPath();
  ctx.moveTo(xOf(left), yOf(U_DEPTH));
  for (let d = -halfM; d <= halfM; d += 1) ctx.lineTo(xOf(d), yOf(roadAt(d)));
  ctx.lineTo(xOf(right), yOf(U_DEPTH));
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 上を通る線路
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(xOf(-UP_FLAT / 2 - 8), yOf(U_DEPTH) + 1);
  ctx.lineTo(xOf(UP_FLAT / 2 + 8), yOf(U_DEPTH) + 1);
  ctx.stroke();
  ctx.lineWidth = 1;

  // 30 cm の目盛り
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = theme.warn;
  ctx.beginPath();
  ctx.moveTo(xOf(-UP_FLAT / 2 - 6), yOf(0.3));
  ctx.lineTo(xOf(UP_FLAT / 2 + 6), yOf(0.3));
  ctx.stroke();
  ctx.setLineDash([]);

  // 止まった車
  for (const c of s.stuck) {
    const row = Math.floor(c.slot / 2);
    const side = c.slot % 2 === 0 ? -1 : 1;
    const d = side * (row * 7 + 3);
    const e = slotHeight(c.slot);
    const px = xOf(d);
    const py = yOf(e);
    ctx.fillStyle = c.trapped ? theme.danger : c.outAt >= 0 ? theme.muted : theme.warn;
    ctx.fillRect(px - 4, py - 5, 8, 5);
  }

  // ゲート
  const closed = s.closedAt >= 0;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  if (closed) {
    for (const side of [-1, 1]) {
      const gx = xOf(side * (halfM + 2));
      ctx.fillStyle = theme.danger;
      ctx.fillRect(gx - 7, yOf(U_DEPTH) - 12, 14, 3);
      ctx.fillRect(gx - 1, yOf(U_DEPTH) - 12, 2, 12);
    }
    ctx.fillStyle = theme.danger;
    ctx.fillText("通行止め", U_CX, U_TOP - 6);
  } else if (s.crewEta >= 0) {
    ctx.fillStyle = theme.warn;
    ctx.fillText(`職員の到着まで ${s.crewEta - s.t} 分`, U_CX, U_TOP - 6);
  } else if (s.policy.warning && r >= 50) {
    ctx.fillStyle = theme.warn;
    ctx.fillText("カーナビに警告", U_CX, U_TOP - 6);
  }

  ctx.textAlign = "left";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText("アンダーパス", 232, U_BOTTOM + 22);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = h >= 0.3 ? theme.danger : theme.muted;
  ctx.fillText(`水深 ${h < 0.005 ? "0" : (h * 100).toFixed(0)} cm`, 232, U_BOTTOM + 36);
  ctx.fillStyle = theme.muted;
  ctx.fillText(`止まった車 ${s.stalledTotal} 台`, 232, U_BOTTOM + 50);
  ctx.fillStyle = s.trapped > 0 ? theme.danger : theme.muted;
  ctx.fillText(`閉じ込め ${s.trapped} 人`, 232, U_BOTTOM + 64);
  ctx.fillStyle = theme.muted;
  ctx.fillText(`迂回 ${s.detoured} 台`, 232, U_BOTTOM + 78);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
