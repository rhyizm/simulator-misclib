import { BELIEVER, CORRECTED, DOUBTER, INFORMED, UNAWARE, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  believer: string;
  corrected: string;
  informed: string;
  doubter: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 380;

const GRID_TOP = 48;
const BAR_TOP = 336;

/** 発表のあと、見出しに「訂正」を出しておく時間 (h) */
const FLASH_HOURS = 1.5;

/**
 * 1 つの世界を 1 枚のキャンバスに描く。
 * 上: 400 人 (色 = 状態、輪 = いま広めている)。下: 状態ごとの人数の帯。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const side = s.net.side;
  const cell = Math.floor((W - 32) / side);
  const left = (W - cell * side) / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 見出し: 経過時間と、訂正の状況
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  ctx.fillText(`${Math.min(s.t, s.params.hours).toFixed(1)} 時間後`, left, 22);
  ctx.textAlign = "right";
  if (Number.isNaN(s.officialAt)) {
    const delay = s.policy.delay;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = theme.muted;
    ctx.fillText(Number.isFinite(delay) ? `訂正まで ${(delay - s.t).toFixed(1)} h` : "訂正なし", W - left, 22);
  } else {
    const fresh = s.t - s.officialAt < FLASH_HOURS;
    ctx.font = fresh ? "700 13px sans-serif" : "11px sans-serif";
    ctx.fillStyle = fresh ? theme.informed : theme.muted;
    ctx.fillText(fresh ? "公式が訂正を発表" : `訂正から ${(s.t - s.officialAt).toFixed(1)} h`, W - left, 22);
  }

  // 分断されているときは境目に線
  if (s.params.split) {
    const mx = left + (side / 2) * cell;
    ctx.strokeStyle = theme.border;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(mx, GRID_TOP - 6);
    ctx.lineTo(mx, GRID_TOP + side * cell + 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 住民
  const r = cell * 0.32;
  for (let i = 0; i < s.net.n; i++) {
    const cx = left + (i % side) * cell + cell / 2;
    const cy = GRID_TOP + Math.floor(i / side) * cell + cell / 2;
    const st = s.status[i];
    let color = theme.grid;
    if (st === BELIEVER) color = theme.believer;
    else if (st === CORRECTED) color = theme.corrected;
    else if (st === INFORMED) color = theme.informed;
    else if (st === DOUBTER) color = theme.doubter;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, st === UNAWARE ? r * 0.7 : r, 0, Math.PI * 2);
    ctx.fill();
    // いま広めている人は輪で囲む
    const spreading =
      (st === BELIEVER && sharing(s.rumorFrom[i], s.t, s.params.activeHours)) ||
      sharing(s.fixFrom[i], s.t, s.params.activeHours);
    if (spreading) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 状態ごとの人数の帯
  const counts = [0, 0, 0, 0, 0];
  for (const v of s.status) counts[v]++;
  const order: [number, string][] = [
    [BELIEVER, theme.believer],
    [CORRECTED, theme.corrected],
    [INFORMED, theme.informed],
    [DOUBTER, theme.doubter],
    [UNAWARE, theme.grid],
  ];
  const barW = W - left * 2;
  let x = left;
  for (const [k, color] of order) {
    const w = (counts[k] / s.net.n) * barW;
    ctx.fillStyle = color;
    ctx.fillRect(x, BAR_TOP, w, 12);
    x += w;
  }
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.believer;
  ctx.fillText(`信じている ${counts[BELIEVER]}`, left, BAR_TOP + 30);
  ctx.textAlign = "right";
  ctx.fillStyle = theme.informed;
  ctx.fillText(`訂正を知っている ${counts[CORRECTED] + counts[INFORMED]}`, W - left, BAR_TOP + 30);
}

function sharing(from: number, t: number, activeHours: number): boolean {
  return !Number.isNaN(from) && Math.exp(-(t - from) / activeHours) > 0.25;
}
