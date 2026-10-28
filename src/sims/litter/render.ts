import { CELL_M, CELLS, NEAR_PATROL_M, STREET_M, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  litter: string;
  holding: string;
  bin: string;
  patrol: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 300;

const ROWS = 4;
const ROW_M = STREET_M / ROWS;
const LEFT = 10;
const ROW_W = CANVAS_W - LEFT * 2;
const PX_PER_M = ROW_W / ROW_M;
const TOP = 40;
const ROW_H = 64;
const BAND_H = 34;
/** 1 区画 (5 m) に描くごみの最大数。これを超えた分は区画を塗って表す */
const MAX_DRAW = 30;

/** 通りの位置 (m) を画面の座標へ。100 m ごとに折り返して 4 段に描く */
function toScreen(x: number): { px: number; row: number } {
  const row = Math.min(ROWS - 1, Math.floor(x / ROW_M));
  const u = x - row * ROW_M;
  const along = row % 2 === 0 ? u : ROW_M - u;
  return { px: LEFT + along * PX_PER_M, row };
}

function bandTop(row: number): number {
  return TOP + row * ROW_H + 14;
}

/** 同じ id なら毎回同じ値になる 0〜1 の擬似乱数 (描画位置のばらつき用) */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function fmtClock(s: SimState): string {
  const total = s.params.startHour * 60 + Math.floor(s.t / 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 1 つの世界の通りを 1 枚のキャンバスに描く */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 見出し: 時刻と道のごみ
  let street = 0;
  for (const v of s.litter) street += v;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 13px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(fmtClock(s), LEFT, 22);
  ctx.textAlign = "right";
  ctx.fillStyle = theme.litter;
  ctx.fillText(`道のごみ ${street} 個`, W - LEFT, 22);

  // 通り (4 段、端で折り返す)
  for (let r = 0; r < ROWS; r++) {
    const y = bandTop(r);
    ctx.fillStyle = theme.grid;
    ctx.fillRect(LEFT, y, ROW_W, BAND_H);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(LEFT + 0.5, y + 0.5, ROW_W - 1, BAND_H - 1);
    // 段のつなぎ目
    if (r < ROWS - 1) {
      const cx = r % 2 === 0 ? LEFT + ROW_W - 6 : LEFT + 6;
      ctx.beginPath();
      ctx.moveTo(cx, y + BAND_H);
      ctx.lineTo(cx, bandTop(r + 1));
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = "10px sans-serif";
    ctx.textAlign = r % 2 === 0 ? "left" : "right";
    ctx.fillStyle = theme.muted;
    ctx.fillText(`${r * ROW_M}〜${(r + 1) * ROW_M} m`, r % 2 === 0 ? LEFT : LEFT + ROW_W, y - 3);
  }

  // 見回りの人のまわり (この中ではほとんど捨てない)
  for (const p of s.patrollers) {
    const lo = Math.max(0, p.x - NEAR_PATROL_M);
    const hi = Math.min(STREET_M, p.x + NEAR_PATROL_M);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = theme.patrol;
    // 段をまたぐときは段ごとに分けて塗る
    for (let a = lo; a < hi; ) {
      const row = Math.min(ROWS - 1, Math.floor(a / ROW_M));
      const b = Math.min(hi, (row + 1) * ROW_M);
      const pa = toScreen(a).px;
      const pb = toScreen(b - 1e-6).px;
      ctx.fillRect(Math.min(pa, pb), bandTop(row), Math.abs(pb - pa), BAND_H);
      a = b;
    }
    ctx.globalAlpha = 1;
  }

  // ごみ
  const cellPx = CELL_M * PX_PER_M;
  for (let c = 0; c < CELLS; c++) {
    const n = s.litter[c];
    if (n === 0) continue;
    const { px, row } = toScreen((c + 0.5) * CELL_M);
    const x0 = px - cellPx / 2;
    const y0 = bandTop(row);
    if (n > MAX_DRAW) {
      ctx.globalAlpha = Math.min(0.55, 0.15 + (n - MAX_DRAW) / 120);
      ctx.fillStyle = theme.litter;
      ctx.fillRect(x0, y0 + 1, cellPx, BAND_H - 2);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = theme.litter;
    for (let k = 0; k < Math.min(n, MAX_DRAW); k++) {
      const lx = x0 + 1 + hash01(c, k) * (cellPx - 4);
      const ly = y0 + 2 + hash01(k, c + 977) * (BAND_H - 6);
      ctx.fillRect(lx, ly, 2.5, 2.5);
    }
  }

  // ごみ箱
  for (const b of s.bins) {
    const { px, row } = toScreen(b.x);
    const y = bandTop(row) - 13;
    const w = 10;
    const h = 12;
    const ratio = s.policy.binCapacity > 0 ? Math.min(1, b.fill / s.policy.binCapacity) : 0;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(px - w / 2, y, w, h);
    ctx.fillStyle = ratio >= 1 ? theme.litter : theme.bin;
    ctx.fillRect(px - w / 2, y + h * (1 - ratio), w, h * ratio);
    ctx.strokeStyle = ratio >= 1 ? theme.litter : theme.bin;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px - w / 2 + 0.5, y + 0.5, w - 1, h - 1);
  }

  // 歩く人
  for (const w of s.walkers) {
    const { px, row } = toScreen(Math.max(0, Math.min(STREET_M - 1e-6, w.x)));
    const py = bandTop(row) + 6 + hash01(w.id, 31) * (BAND_H - 12);
    ctx.beginPath();
    ctx.arc(px, py, w.phase === 1 ? 2.6 : 2, 0, Math.PI * 2);
    if (w.phase === 1) {
      ctx.fillStyle = theme.holding;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = theme.fg;
      ctx.globalAlpha = w.phase === 0 ? 0.55 : 0.25;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 見回りの人
  for (const p of s.patrollers) {
    const { px, row } = toScreen(Math.max(0, Math.min(STREET_M - 1e-6, p.x)));
    const py = bandTop(row) + BAND_H / 2;
    ctx.beginPath();
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 5, py);
    ctx.lineTo(px, py + 6);
    ctx.lineTo(px - 5, py);
    ctx.closePath();
    ctx.fillStyle = theme.patrol;
    ctx.fill();
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
