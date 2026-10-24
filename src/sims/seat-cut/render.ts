import type { Row } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  cut: string;
  /** 党ごとの色 */
  parties: string[];
}

export const PER_LINE = 28;
export const CANVAS_W = 660;
const LABEL_W = 70;
const CELL = 17;
const GAP = 3;
const LINE_H = 28;
const TOP = 30;

export function canvasHeight(rows: Row[]): number {
  const lines = rows.reduce((a, r) => a + Math.ceil(r.order.length / PER_LINE), 0);
  return TOP + lines * LINE_H + 8;
}

function cellPos(k: number): { line: number; x: number } {
  return { line: Math.floor(k / PER_LINE), x: LABEL_W + (k % PER_LINE) * (CELL + GAP) };
}

/**
 * ブロックごとに、ドント方式で議席が配られる順に四角を並べる。
 * revealed: 何番目の席まで見せるか。cutAlpha: 削られる席の印の濃さ (0〜1)。
 * cuts[1] (2 つ目の世界) より後ろの席はどちらの削減案でも消え、
 * cuts[2] 〜 cuts[1] の席は 3 つ目の世界だけで消える。
 */
export function renderSeats(
  ctx: CanvasRenderingContext2D,
  rows: Row[],
  theme: RenderTheme,
  revealed: number,
  cutAlpha: number,
  worldNames: readonly string[],
) {
  const H = canvasHeight(rows);
  ctx.clearRect(0, 0, CANVAS_W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CANVAS_W, H);

  // 見出し: 何番目の席か
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const k of [1, 5, 10, 15, 20, 25]) {
    const { x } = cellPos(k - 1);
    ctx.fillText(String(k), x + CELL / 2, TOP - 12);
  }
  ctx.textAlign = "left";
  ctx.fillText("席目 →", 6, TOP - 12);

  let line0 = 0;
  for (const row of rows) {
    const lines = Math.ceil(row.order.length / PER_LINE);
    const y0 = TOP + line0 * LINE_H;
    // ブロック名と、世界ごとの定数
    ctx.font = "600 12px sans-serif";
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(row.label, 6, y0 + 4);
    if (rows.length > 1) {
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillStyle = theme.muted;
      ctx.fillText(row.cuts.join("/"), 6, y0 + 17);
    }

    for (let k = 0; k < row.order.length; k++) {
      if (k >= revealed) break;
      const { line, x } = cellPos(k);
      const y = y0 + line * LINE_H;
      const color = theme.parties[row.order[k]];
      const goneBoth = k >= row.cuts[1];
      const goneThird = !goneBoth && k >= row.cuts[2];
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      if (goneBoth) {
        ctx.globalAlpha = 1 - 0.85 * cutAlpha;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.globalAlpha = cutAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, CELL - 1.5, CELL - 1.5);
        ctx.strokeStyle = theme.cut;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3);
        ctx.lineTo(x + CELL - 3, y + CELL - 3);
        ctx.moveTo(x + CELL - 3, y + 3);
        ctx.lineTo(x + 3, y + CELL - 3);
        ctx.stroke();
      } else if (goneThird) {
        ctx.globalAlpha = 1 - 0.6 * cutAlpha;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.globalAlpha = cutAlpha;
        ctx.strokeStyle = theme.cut;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + CELL - 3);
        ctx.lineTo(x + CELL - 3, y + 3);
        ctx.stroke();
      } else {
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;

    // 削減案ごとの境目
    if (cutAlpha > 0) {
      for (const w of [1, 2]) {
        const c = row.cuts[w];
        if (c >= row.order.length || c >= revealed) continue;
        const { line, x } = cellPos(c);
        const y = y0 + line * LINE_H;
        ctx.globalAlpha = cutAlpha;
        ctx.strokeStyle = theme.cut;
        ctx.lineWidth = w === 1 ? 2 : 1;
        ctx.setLineDash(w === 1 ? [] : [3, 2]);
        ctx.beginPath();
        ctx.moveTo(x - GAP / 2, y - 3);
        ctx.lineTo(x - GAP / 2, y + CELL + 3);
        ctx.stroke();
        ctx.setLineDash([]);
        if (rows.length === 1) {
          ctx.font = "10px sans-serif";
          ctx.fillStyle = theme.cut;
          ctx.textBaseline = "alphabetic";
          ctx.fillText(worldNames[w].split(" (")[0], x + 1, y - 3);
        }
        ctx.globalAlpha = 1;
      }
    }
    line0 += lines;
  }
}
