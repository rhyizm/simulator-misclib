import { attackRate, siteStatus, type SimState, type SiteStatus } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  open: string;
  stopped: string;
  waf: string;
  patched: string;
  hacked: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 400;

const COLS = 20;
const CELL = 13;
const GRID_TOP = 36;
const GRID_LEFT = 36;
const TL_TOP = 330;
const TL_H = 40;
const TL_LEFT = 24;
const TL_RIGHT = CANVAS_W - 16;

const KIND_SHORT = { ops: "運用", small: "小規模", legacy: "古い" } as const;

/** 0 時間目 = 10 月 21 日 0 時 */
export function clockLabel(t: number): string {
  const h = Math.floor(t);
  return `10/${21 + Math.floor(h / 24)} ${String(h % 24).padStart(2, "0")}:00`;
}

/**
 * 1 つの世界 (対応) を 1 枚のキャンバスに描く。
 * 上: 400 のサイト (上から 運用 / 小規模 / 古い)。下: 1 週間の年表 (攻撃の強さと修正済みの割合)。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const p = s.params;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  ctx.fillText(clockLabel(Math.min(s.t, p.hours)), GRID_LEFT, 20);
  ctx.textAlign = "right";
  const patchedOut = s.t >= p.patchAt;
  ctx.fillStyle = patchedOut ? theme.patched : theme.muted;
  ctx.font = "11px sans-serif";
  ctx.fillText(patchedOut ? "修正版 公開済み" : "修正版 まだ", W - 16, 20);

  // サイト
  const colors: Record<SiteStatus, string> = {
    open: theme.open,
    stopped: theme.stopped,
    waf: theme.waf,
    patched: theme.patched,
    hacked: theme.hacked,
  };
  let prevKind = s.sites[0]?.kind;
  ctx.font = "9px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = theme.muted;
  ctx.fillText(KIND_SHORT[prevKind ?? "ops"], GRID_LEFT - 4, GRID_TOP + 9);
  for (let i = 0; i < s.sites.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = GRID_LEFT + col * CELL;
    const y = GRID_TOP + row * CELL;
    const kind = s.sites[i].kind;
    if (kind !== prevKind) {
      // 種類の境目に線を引く
      prevKind = kind;
      ctx.strokeStyle = theme.fg;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 1, y - 1);
      ctx.lineTo(GRID_LEFT + COLS * CELL, y - 1);
      if (col > 0) {
        ctx.moveTo(x - 1, y - 1);
        ctx.lineTo(x - 1, y + CELL - 1);
        ctx.lineTo(GRID_LEFT - 1, y + CELL - 1);
      }
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(KIND_SHORT[kind], GRID_LEFT - 4, GRID_TOP + (row + (col > 0 ? 1 : 0)) * CELL + 9);
    }
    const st = siteStatus(s, i);
    const c = colors[st];
    if (st === "open") {
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 2.5, y + 2.5, CELL - 6, CELL - 6);
    } else if (st === "stopped") {
      // 止めているサイトは × 印
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + CELL - 4, y + CELL - 4);
      ctx.moveTo(x + CELL - 4, y + 3);
      ctx.lineTo(x + 3, y + CELL - 4);
      ctx.stroke();
    } else if (st === "waf") {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2.5, y + 2.5, CELL - 6, CELL - 6);
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x + 2.5, y + 2.5, CELL - 6, CELL - 6);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = c;
      ctx.fillRect(x + 2, y + 2, CELL - 5, CELL - 5);
    }
  }

  // 年表: 攻撃の強さ (塗り) と修正済みの割合 (線)
  const x = (t: number) => TL_LEFT + (t / p.hours) * (TL_RIGHT - TL_LEFT);
  const base = TL_TOP + TL_H;
  let peak = 0;
  for (let t = 0; t <= p.hours; t += 2) peak = Math.max(peak, attackRate(p, t));
  ctx.fillStyle = theme.hacked;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.moveTo(x(0), base);
  for (let t = 0; t <= p.hours; t += 1) ctx.lineTo(x(t), base - (attackRate(p, t) / peak) * (TL_H - 4));
  ctx.lineTo(x(p.hours), base);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = theme.patched;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  s.series.forEach((pt, i) => {
    const px = x(pt.t);
    const py = base - (pt.patched / s.sites.length) * (TL_H - 4);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TL_LEFT, base);
  ctx.lineTo(TL_RIGHT, base);
  ctx.stroke();

  // 修正版の公開
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = theme.patched;
  ctx.beginPath();
  ctx.moveTo(x(p.patchAt), TL_TOP - 2);
  ctx.lineTo(x(p.patchAt), base);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = theme.muted;
  for (let d = 0; d * 24 <= p.hours; d += 1) {
    if (d % 2 === 1) continue;
    ctx.fillText(`${21 + d}日`, x(d * 24), base + 14);
  }

  // 現在位置
  ctx.fillStyle = theme.fg;
  ctx.beginPath();
  const nx = x(Math.min(s.t, p.hours));
  ctx.moveTo(nx, base + 17);
  ctx.lineTo(nx - 4, base + 23);
  ctx.lineTo(nx + 4, base + 23);
  ctx.closePath();
  ctx.fill();
}
