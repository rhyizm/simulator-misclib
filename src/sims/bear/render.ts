import {
  BUFFER_Y,
  FARM_Y,
  FRUIT_FROM_DAY,
  HOURS,
  MAP_H,
  MAP_W,
  TOWN_Y,
  dayOf,
  fmtDate,
  foodAvailable,
  hourOf,
  type SimState,
} from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  forest: string;
  fruit: string;
  habituated: string;
  injury: string;
  encounter: string;
}

export const CANVAS_W = 360;
export const CANVAS_H = 370;

const L = 10;
const R = CANVAS_W - 10;
const TOP = 40;
/** 帯ごとの縦の画素数 (森は縮めて描く) */
const BANDS: { from: number; to: number; px: number }[] = [
  { from: 0, to: BUFFER_Y, px: 112 },
  { from: BUFFER_Y, to: FARM_Y, px: 40 },
  { from: FARM_Y, to: TOWN_Y, px: 80 },
  { from: TOWN_Y, to: MAP_H, px: 80 },
];
const BOTTOM = TOP + BANDS.reduce((a, b) => a + b.px, 0);

export function sx(x: number): number {
  return L + (x / MAP_W) * (R - L);
}

export function sy(y: number): number {
  let top = TOP;
  for (const b of BANDS) {
    if (y < b.to) return top + ((y - b.from) / (b.to - b.from)) * b.px;
    top += b.px;
  }
  return BOTTOM;
}

/** 家並み (見た目だけ。世界ごとに同じ配置) */
const HOUSES: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  let a = 12345;
  const r = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
  for (let i = 0; i < 70; i++) out.push({ x: 60 + r() * (MAP_W - 120), y: TOWN_Y + 50 + r() * (MAP_H - TOWN_Y - 90) });
  for (let i = 0; i < 10; i++) out.push({ x: 80 + r() * (MAP_W - 160), y: FARM_Y + 40 + r() * (TOWN_Y - FARM_Y - 60) });
  return out;
})();

/**
 * 1 つの世界を 1 枚のキャンバスに描く。
 * 上が山、下が町。クマ (点)、柿・栗の木 (橙の丸)、ごみ置き場 (四角)、人との遭遇 (輪) と捕獲 (×)。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, th: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  const hEnd = Math.min(s.h, HOURS - 1);
  const day = dayOf(hEnd);
  const hour = s.h >= HOURS ? 23 : hourOf(s.h);
  let outNow = 0;
  let alive = 0;
  for (const b of s.bears) {
    if (b.removedDay !== -1) continue;
    alive++;
    if (b.y >= FARM_Y) outNow++;
  }

  // 日付と時刻
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = th.fg;
  ctx.font = "600 20px ui-monospace, monospace";
  const night = hour < 5 || hour >= 18;
  ctx.fillText(`${fmtDate(day)} ${String(hour).padStart(2, "0")}:00`, L, 26);
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = outNow > 0 ? th.injury : th.muted;
  ctx.fillText(`里にいるクマ ${outNow} 頭 / 山に ${alive} 頭`, R, 18);
  ctx.fillStyle = th.muted;
  ctx.font = "11px sans-serif";
  ctx.fillText(night ? "夜" : "昼", R, 32);

  // 帯
  const yB = sy(BUFFER_Y);
  const yF = sy(FARM_Y);
  const yT = sy(TOWN_Y);
  ctx.fillStyle = th.forest;
  ctx.globalAlpha = 0.16;
  ctx.fillRect(L, TOP, R - L, yB - TOP);
  ctx.globalAlpha = 1;
  if (s.policy.buffer) {
    ctx.fillStyle = th.fruit;
    ctx.globalAlpha = 0.07;
    ctx.fillRect(L, yB, R - L, yF - yB);
    ctx.globalAlpha = 1;
  } else {
    // やぶ (斜線)
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, yB, R - L, yF - yB);
    ctx.clip();
    ctx.strokeStyle = th.forest;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let x = L - 60; x < R; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, yF);
      ctx.lineTo(x + 40, yB);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = th.grid;
  ctx.fillRect(L, yF, R - L, yT - yF);
  ctx.fillRect(L, yT, R - L, BOTTOM - yT);

  // 家
  ctx.fillStyle = th.border;
  for (const hs of HOUSES) ctx.fillRect(sx(hs.x) - 2.5, sy(hs.y) - 2, 5, 4);

  // 境目
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 1;
  for (const y of [yB, yF, yT]) {
    ctx.beginPath();
    ctx.moveTo(L, y + 0.5);
    ctx.lineTo(R, y + 0.5);
    ctx.stroke();
  }
  ctx.strokeRect(L + 0.5, TOP + 0.5, R - L - 1, BOTTOM - TOP - 1);

  // 帯の名前
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = th.muted;
  ctx.fillText("奥山", L + 4, TOP + 12);
  ctx.fillText(s.policy.buffer ? "緩衝帯 (やぶを刈った草地)" : "里山の縁 (やぶ)", L + 4, yB + 12);
  ctx.fillText("畑・柿や栗の木", L + 4, yF + 12);
  ctx.fillText("町・ごみ置き場", L + 4, yT + 12);

  // 食べ物
  for (let k = 0; k < s.foods.length; k++) {
    const f = s.foods[k];
    const x = sx(f.x);
    const y = sy(f.y);
    if (f.kind === "tree") {
      if (f.removed) {
        ctx.strokeStyle = th.muted;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y - 2.5);
        ctx.lineTo(x + 2.5, y + 2.5);
        ctx.moveTo(x + 2.5, y - 2.5);
        ctx.lineTo(x - 2.5, y + 2.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      if (day >= FRUIT_FROM_DAY && f.stock > 0.01) {
        ctx.fillStyle = th.fruit;
        ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, f.stock / 1.6);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = th.fruit;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      if (f.removed) {
        ctx.strokeStyle = th.muted;
        ctx.strokeRect(x - 3, y - 3, 6, 6);
        continue;
      }
      ctx.fillStyle = foodAvailable(s, k) ? th.fruit : th.muted;
      ctx.globalAlpha = foodAvailable(s, k) ? 1 : 0.5;
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.globalAlpha = 1;
    }
  }

  // 遭遇・けが・捕獲の跡 (直近 3 日)
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    const age = s.h - e.h;
    if (age > 72) break;
    const a = 1 - age / 72;
    const x = sx(e.x);
    const y = sy(e.y);
    ctx.globalAlpha = 0.25 + 0.75 * a;
    if (e.kind === "capture") {
      ctx.strokeStyle = th.fg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = e.kind === "injury" ? th.injury : th.encounter;
      ctx.lineWidth = e.kind === "injury" ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6 + (1 - a) * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  // クマ
  for (const b of s.bears) {
    if (b.removedDay !== -1) continue;
    const x = sx(b.x);
    const y = sy(b.y);
    const resting = b.mode === "rest" || b.mode === "forage";
    ctx.globalAlpha = resting ? 0.55 : 1;
    ctx.fillStyle = b.habituated ? th.habituated : th.fg;
    ctx.beginPath();
    ctx.arc(x, y, resting ? 2.6 : 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 下の注記
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = th.muted;
  ctx.fillText("横 3 km", L, H - 6);
  ctx.textAlign = "right";
  ctx.fillText(`柿や栗が熟すのは ${fmtDate(FRUIT_FROM_DAY)} から`, R, H - 6);
}
