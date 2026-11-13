import type { Server, SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  /** 待っている人 */
  wait: string;
  /** 締め切りが近い人 */
  urgent: string;
  /** 赤判定・検査 */
  red: string;
  /** 終わった人 */
  done: string;
}

export const CANVAS_W = 340;
export const CANVAS_H = 312;

const PAD = 10;
const DOT_GAP = 7;
const DOT_R = 2.5;
/** 締め切りまでこれより短い人を「急いでいる」色で描く (秒) */
const URGENT_SEC = 600;

/** 待っている人を点で並べ、入りきらなければ人数を出す。描いた高さを返す */
function drawQueue(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  queue: number[],
  y: number,
  rows: number,
  base: string,
  theme: RenderTheme,
) {
  const cols = Math.floor((CANVAS_W - PAD * 2) / DOT_GAP);
  const max = cols * rows;
  const shown = Math.min(queue.length, max);
  for (let k = 0; k < shown; k++) {
    const tr = s.people[queue[k] - 1];
    const col = k % cols;
    const row = Math.floor(k / cols);
    ctx.beginPath();
    ctx.arc(PAD + 3 + col * DOT_GAP, y + row * DOT_GAP, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = tr.tDeadline - s.t < URGENT_SEC ? theme.urgent : base;
    ctx.fill();
  }
  if (queue.length > max) {
    const label = `ほか ${queue.length - max} 人`;
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "right";
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(CANVAS_W - PAD - w, y + (rows - 1) * DOT_GAP - 7, w, 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.fg;
    ctx.fillText(label, CANVAS_W - PAD - 4, y + (rows - 1) * DOT_GAP);
  }
}

/** 端末や検査台を四角で並べる。使っている間は進み具合を塗る */
function drawServers(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  servers: Server[],
  y: number,
  size: number,
  gap: number,
  fill: string,
  theme: RenderTheme,
): number {
  const perRow = Math.max(1, Math.floor((CANVAS_W - PAD * 2 + gap) / (size + gap)));
  servers.forEach((sv, i) => {
    const x = PAD + (i % perRow) * (size + gap);
    const yy = y + Math.floor(i / perRow) * (size + gap);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x, yy, size, size);
    if (sv.who !== 0) {
      const f = Math.max(0, Math.min(1, (s.t - sv.since) / Math.max(1, sv.until - sv.since)));
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, yy, size, size);
      ctx.globalAlpha = 1;
      ctx.fillRect(x, yy + size * (1 - f), size, size * f);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = sv.who !== 0 ? fill : theme.border;
    ctx.strokeRect(x + 0.5, yy + 0.5, size - 1, size - 1);
  });
  const rows = Math.ceil(servers.length / perRow);
  return rows * (size + gap) - gap;
}

function heading(ctx: CanvasRenderingContext2D, text: string, right: string, y: number, theme: RenderTheme) {
  ctx.font = "600 12px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.fg;
  ctx.fillText(text, PAD, y);
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = theme.muted;
  ctx.fillText(right, CANVAS_W - PAD, y);
}

/**
 * 1 つの方針の世界を 1 枚のキャンバスに描く。
 * 上から 端末の列 → 端末 → 検査の列 → 検査台 → 出口 (終わった人 / あきらめた人)。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  let y = 14;
  heading(ctx, "① 端末の前の列", `${s.kioskQueue.length} 人`, y, theme);
  y += 16;
  drawQueue(ctx, s, s.kioskQueue, y, 6, theme.wait, theme);
  y += 6 * DOT_GAP + 8;

  const busyK = s.kiosks.filter((k) => k.who !== 0).length;
  heading(ctx, "② 税関確認の端末", `${busyK} / ${s.kiosks.length} 台が使用中`, y, theme);
  y += 12;
  y += drawServers(ctx, s, s.kiosks, y, 14, 4, theme.fg, theme) + 16;

  heading(ctx, "③ 検査を待つ列 (赤判定)", `${s.inspectQueue.length} 人`, y, theme);
  y += 16;
  drawQueue(ctx, s, s.inspectQueue, y, 8, theme.red, theme);
  y += 8 * DOT_GAP + 8;

  const busyI = s.inspectors.filter((k) => k.who !== 0).length;
  heading(ctx, "④ 税関の検査台", `${busyI} / ${s.inspectors.length} 人が検査中`, y, theme);
  y += 12;
  y += drawServers(ctx, s, s.inspectors, y, 22, 6, theme.red, theme) + 18;

  // 出口: 終わった人とあきらめた人の数
  let done = 0;
  let gave = 0;
  for (const tr of s.people) {
    if (tr.stage === "done" && tr.tDone <= s.t) done++;
    else if (tr.stage === "gaveUp") gave++;
  }
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 8);
  ctx.lineTo(CANVAS_W - PAD, y - 8);
  ctx.stroke();
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.done;
  ctx.fillRect(PAD, y + 4, 9, 9);
  ctx.fillStyle = theme.fg;
  ctx.fillText(`手続きを終えた ${done} 人`, PAD + 14, y + 9);
  ctx.fillStyle = theme.urgent;
  ctx.fillRect(CANVAS_W / 2 + 4, y + 4, 9, 9);
  ctx.fillStyle = theme.fg;
  ctx.font = gave > 0 ? "700 12px sans-serif" : "12px sans-serif";
  ctx.fillText(`返金をあきらめた ${gave} 人`, CANVAS_W / 2 + 18, y + 9);
}
