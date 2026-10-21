import type { Fixture, Gender, SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  female: string;
  male: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 362;

const ROOM_TOP = 46;
const CELL = 36;
const CELL_GAP = 6;
const ROWS = 4;
const QUEUE_TOP = ROOM_TOP + ROWS * (CELL + CELL_GAP) + 26;

interface Rect {
  x: number;
  w: number;
}

/**
 * 1 つの配分を 1 枚のキャンバスに描く。
 * 左が女性用、右が男性用、可変トイレがあれば真ん中に置く。下に待ち行列。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const hasFlex = s.layout.flexStalls > 0;
  const flexW = hasFlex ? CELL + 12 : 0;
  const roomW = (W - 16 - flexW - (hasFlex ? 16 : 8)) / 2;
  const rooms: Record<Gender, Rect> = {
    f: { x: 8, w: roomW },
    m: { x: W - 8 - roomW, w: roomW },
  };
  const flexRect: Rect = { x: 8 + roomW + 8, w: flexW };
  const color = (g: Gender) => (g === "f" ? theme.female : theme.male);
  const roomH = ROWS * (CELL + CELL_GAP) + 4;

  // 部屋の枠と見出し
  ctx.textBaseline = "alphabetic";
  for (const g of ["f", "m"] as const) {
    const r = rooms[g];
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, ROOM_TOP - 4.5, r.w - 1, roomH);
    const fixed = s.fixtures.filter((f) => f.kind !== "flex" && f.side === g);
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = color(g);
    ctx.fillText(g === "f" ? "女性用" : "男性用", r.x + 2, ROOM_TOP - 24);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = theme.muted;
    const label =
      g === "f"
        ? `${fixed.length} 個`
        : `${fixed.length} 個 (個室 ${s.layout.maleStalls}・小 ${s.layout.urinals})`;
    ctx.fillText(label, r.x + 2, ROOM_TOP - 10);
  }
  if (hasFlex) {
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = theme.muted;
    ctx.fillText("可変", flexRect.x + flexRect.w / 2, ROOM_TOP - 24);
    ctx.font = "11px sans-serif";
    ctx.fillText(`${s.layout.flexStalls} 個`, flexRect.x + flexRect.w / 2, ROOM_TOP - 10);
  }

  // 便器
  const placeIn = (r: Rect, fixtures: Fixture[]) => {
    const cols = Math.max(1, Math.floor((r.w - 8 + CELL_GAP) / (CELL + CELL_GAP)));
    const used = cols * (CELL + CELL_GAP) - CELL_GAP;
    const x0 = r.x + (r.w - used) / 2;
    fixtures.forEach((f, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawFixture(ctx, s, f, x0 + col * (CELL + CELL_GAP), ROOM_TOP + row * (CELL + CELL_GAP), theme, color(f.side));
    });
  };
  for (const g of ["f", "m"] as const) {
    placeIn(rooms[g], s.fixtures.filter((f) => f.kind !== "flex" && f.side === g));
  }
  if (hasFlex) placeIn(flexRect, s.fixtures.filter((f) => f.kind === "flex"));

  // 待ち行列
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.muted;
  ctx.fillText("待ち行列", 8, QUEUE_TOP - 10);
  const dot = 6;
  const gapPx = 10;
  for (const g of ["f", "m"] as const) {
    const r = rooms[g];
    const q = s.queues[g];
    const cols = Math.floor((r.w - 8) / gapPx);
    const rows = 8;
    const maxShow = cols * rows;
    const x0 = r.x + (r.w - (cols - 1) * gapPx) / 2;
    ctx.fillStyle = color(g);
    for (let i = 0; i < Math.min(q.length, maxShow); i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.beginPath();
      ctx.arc(x0 + col * gapPx, QUEUE_TOP + row * gapPx, dot / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = theme.fg;
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "center";
    const label = q.length > maxShow ? `${q.length} 人 (+${q.length - maxShow})` : `${q.length} 人`;
    ctx.fillText(label, r.x + r.w / 2, QUEUE_TOP + rows * gapPx + 12);
    ctx.font = "11px sans-serif";
  }
}

function drawFixture(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  f: Fixture,
  x: number,
  y: number,
  theme: RenderTheme,
  color: string,
) {
  const urinal = f.kind === "urinal";
  const w = urinal ? CELL * 0.62 : CELL;
  const fx = x + (CELL - w) / 2;
  const rad = urinal ? 10 : 5;
  roundRect(ctx, fx, y, w, CELL, rad);
  ctx.fillStyle = theme.grid;
  ctx.fill();
  ctx.lineWidth = f.kind === "flex" ? 2 : 1;
  ctx.strokeStyle = f.kind === "flex" ? color : theme.border;
  if (f.kind === "flex") ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (f.user === 0) return;
  const person = s.people[f.user - 1];
  // 使用中: 塗りつぶし + 残り時間のバー
  roundRect(ctx, fx + 3, y + 3, w - 6, CELL - 6, Math.max(2, rad - 3));
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = person.gender === "f" ? theme.female : theme.male;
  ctx.fill();
  ctx.globalAlpha = 1;
  const remain = Math.max(0, Math.min(1, (f.until - s.t) / person.useSec));
  ctx.fillStyle = theme.bg;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(fx + 3, y + CELL - 7, (w - 6) * remain, 3);
  ctx.globalAlpha = 1;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
