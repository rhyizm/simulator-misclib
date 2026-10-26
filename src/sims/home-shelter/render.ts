import type { SimState } from "./model";
import { BLOCK } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  home: string;
  low: string;
  shelter: string;
  overflow: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 420;

const COLS = 20;
const CELL = 13;
const GRID_TOP = 34;
const GRID_LEFT = (CANVAS_W - COLS * CELL) / 2;
const BAR_TOP = 312;

/**
 * 1 つの世界 (備えの量) を 1 枚のキャンバスに描く。
 * 上: 町の 400 世帯 (色 = 家に残れているか)。下: 避難所の混み具合と、ライフラインの戻り具合。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  const day = Math.min(s.t, s.params.days);
  ctx.fillText(`${Math.floor(day)} 日目 ${String(Math.floor((day % 1) * 24)).padStart(2, "0")}時`, GRID_LEFT, 22);

  // 集合住宅の街区は背景を薄く塗る
  for (let b = 0; b * BLOCK < s.town.length; b++) {
    if (!s.town[b * BLOCK].apartment) continue;
    const r0 = Math.floor((b * BLOCK) / COLS);
    const r1 = Math.floor((Math.min(s.town.length, (b + 1) * BLOCK) - 1) / COLS);
    ctx.fillStyle = theme.grid;
    ctx.fillRect(GRID_LEFT - 2, GRID_TOP + r0 * CELL - 1, COLS * CELL + 4, (r1 - r0 + 1) * CELL + 2);
  }
  ctx.textAlign = "right";
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("濃い帯 = 集合住宅", W - GRID_LEFT, 22);

  for (let i = 0; i < s.houses.length; i++) {
    const hs = s.houses[i];
    const h = s.town[i];
    const cx = GRID_LEFT + (i % COLS) * CELL + CELL / 2;
    const cy = GRID_TOP + Math.floor(i / COLS) * CELL + CELL / 2;
    // 世帯の人数で四角の大きさを変える (1〜4 人)
    const half = 2.4 + h.size * 0.8;
    if (hs.status === "damaged") {
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx + half, cy + half);
      ctx.moveTo(cx + half, cy - half);
      ctx.lineTo(cx - half, cy + half);
      ctx.stroke();
    } else if (hs.status === "overflow") {
      ctx.strokeStyle = theme.overflow;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(cx - half + 0.8, cy - half + 0.8, half * 2 - 1.6, half * 2 - 1.6);
    } else {
      ctx.fillStyle = hs.status === "home" ? theme.home : hs.status === "low" ? theme.low : theme.shelter;
      ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    }
  }

  // 避難所の混み具合
  let shelter = 0;
  let overflow = 0;
  let water = 0;
  let toilet = 0;
  let food = 0;
  s.houses.forEach((hs, i) => {
    const h = s.town[i];
    if (hs.status === "shelter" || hs.status === "damaged") shelter += h.size;
    if (hs.status === "overflow") overflow += h.size;
    if (s.t >= h.waterDay) water++;
    if (s.t >= h.toiletDay) toilet++;
    if (s.t >= h.foodDay) food++;
  });
  const barL = GRID_LEFT;
  const barW = COLS * CELL;
  const scale = Math.max(s.capacity * 4, shelter + overflow);
  const px = (n: number) => (n / scale) * barW;
  ctx.textAlign = "left";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText("避難所", barL, BAR_TOP);
  ctx.textAlign = "right";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = overflow > 0 ? theme.overflow : theme.muted;
  ctx.fillText(
    overflow > 0 ? `${shelter} 人 + 入れない ${overflow} 人` : `${shelter} / 定員 ${s.capacity} 人`,
    barL + barW,
    BAR_TOP,
  );
  const by = BAR_TOP + 6;
  ctx.fillStyle = theme.grid;
  ctx.fillRect(barL, by, barW, 12);
  ctx.fillStyle = theme.shelter;
  ctx.fillRect(barL, by, px(shelter), 12);
  ctx.strokeStyle = theme.overflow;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(barL + px(shelter) + 0.75, by + 0.75, Math.max(0, px(overflow) - 1.5), 10.5);
  // 定員の目盛り
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(barL + px(s.capacity), by - 3);
  ctx.lineTo(barL + px(s.capacity), by + 15);
  ctx.stroke();

  // ライフラインの戻り具合 (世帯の割合)
  const n = s.houses.length;
  const lines: [string, number][] = [
    ["水道", water / n],
    ["トイレ", toilet / n],
    ["お店", food / n],
  ];
  lines.forEach(([label, v], k) => {
    const y = BAR_TOP + 42 + k * 20;
    ctx.textAlign = "left";
    ctx.font = "11px sans-serif";
    ctx.fillStyle = theme.muted;
    ctx.fillText(label, barL, y + 8);
    const lx = barL + 44;
    const lw = barW - 44 - 40;
    ctx.fillStyle = theme.grid;
    ctx.fillRect(lx, y, lw, 8);
    ctx.fillStyle = theme.muted;
    ctx.fillRect(lx, y, lw * v, 8);
    ctx.textAlign = "right";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = theme.fg;
    ctx.fillText(`${Math.round(v * 100)}%`, barL + barW, y + 8);
  });
}
