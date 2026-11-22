import type { Pax, SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  touch: string;
  wt: string;
  ticket: string;
  stop: string;
}

export const CANVAS_W = 340;
export const CANVAS_H = 440;

const GATE_Y = 128;
const GATE_H = 26;
const QUEUE_TOP = GATE_Y + GATE_H + 10;
const QUEUE_BOTTOM = CANVAS_H - 24;
const DOT_GAP = 6;
const COLS = 4;

function paxColor(p: Pax, theme: RenderTheme): string {
  if (p.kind === "wt") return theme.wt;
  if (p.kind === "ticket") return theme.ticket;
  return theme.touch;
}

function withAlpha(ctx: CanvasRenderingContext2D, a: number, f: () => void) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = a;
  f();
  ctx.globalAlpha = prev;
}

/**
 * 改札口を上から見た図。下から人が来て通路ごとに並び、改札を通って上へ抜ける。
 * ウォークスルー対応の通路は色を薄く敷き、扉が閉まった通路には赤い棒を出す。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const n = s.lanes.length;
  const marginX = 16;
  const pitch = (W - marginX * 2) / n;
  const laneX = (i: number) => marginX + pitch * (i + 0.5);

  // ウォークスルー対応の通路の帯
  for (let i = 0; i < n; i++) {
    const kind = s.lanes[i].kind;
    if (kind === "touch") continue;
    withAlpha(ctx, kind === "wtOnly" ? 0.2 : 0.11, () => {
      ctx.fillStyle = theme.wt;
      ctx.fillRect(marginX + pitch * i + 2, 30, pitch - 4, QUEUE_BOTTOM - 30);
    });
  }

  // 見出し
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 10px sans-serif";
  for (let i = 0; i < n; i++) {
    const kind = s.lanes[i].kind;
    ctx.fillStyle = kind === "touch" ? theme.muted : theme.fg;
    const label = kind === "touch" ? "タッチ" : kind === "mixed" ? "WT・タッチ" : "WT 専用";
    ctx.fillText(label, laneX(i), GATE_Y - 8);
  }
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "left";
  ctx.fillText("出口 ↑", 8, 16);
  ctx.textAlign = "right";
  ctx.font = "700 14px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`${s.passed} 人`, W - 8, 18);
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("通過", W - 8, 30);

  // 改札機 (通路のあいだの筐体)
  ctx.fillStyle = theme.grid;
  for (let i = 0; i <= n; i++) {
    const x = marginX + pitch * i;
    ctx.fillRect(x - 4, GATE_Y, 8, GATE_H);
  }
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    const x = marginX + pitch * i;
    ctx.strokeRect(x - 4, GATE_Y, 8, GATE_H);
  }

  // 閉まった扉
  for (let i = 0; i < n; i++) {
    const lane = s.lanes[i];
    if (s.t < lane.closedUntil) {
      ctx.fillStyle = theme.stop;
      ctx.fillRect(marginX + pitch * i + 4, GATE_Y + GATE_H / 2 - 2.5, pitch - 8, 5);
    }
  }

  const drawDot = (p: Pax, x: number, y: number, r: number) => {
    ctx.beginPath();
    if (p.luggage) {
      ctx.rect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = paxColor(p, theme);
    ctx.fill();
  };

  // 待ち行列
  const maxRows = Math.floor((QUEUE_BOTTOM - QUEUE_TOP) / DOT_GAP);
  const maxShow = maxRows * COLS;
  ctx.textAlign = "center";
  for (let i = 0; i < n; i++) {
    const q = s.lanes[i].queue;
    const cx = laneX(i);
    const shown = Math.min(q.length, maxShow);
    for (let k = 0; k < shown; k++) {
      const p = s.pax[q[k] - 1];
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      const x = cx + (col - (COLS - 1) / 2) * DOT_GAP;
      const y = QUEUE_TOP + row * DOT_GAP;
      drawDot(p, x, y, 2.4);
      if (p.confused && s.lanes[i].kind === "wtOnly") {
        ctx.strokeStyle = theme.stop;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.font = "10px sans-serif";
    ctx.fillStyle = theme.muted;
    const label = q.length > maxShow ? `${q.length}+` : `${q.length}`;
    ctx.fillText(label, cx, H - 8);
  }

  // 通過した人は上へ抜けていく
  for (const id of s.recent) {
    const p = s.pax[id - 1];
    const dt = s.t - p.tPass;
    if (dt < 0) continue;
    const y = GATE_Y - 6 - dt * 32;
    if (y < 34) continue;
    const x = laneX(p.lane) + ((id * 37) % 11) - 5;
    withAlpha(ctx, Math.max(0.2, 1 - dt / 3), () => drawDot(p, x, y, 3.2));
  }
}
