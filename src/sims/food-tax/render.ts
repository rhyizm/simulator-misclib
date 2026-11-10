import { CUT_MONTHS, PAY_MONTHS, isCut, priceIndex, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  worker: string;
  pension: string;
  store: string;
}

export type View = "yen" | "share";

export const CANVAS_W = 380;
export const CANVAS_H = 250;

const TOP = 44;
const BOTTOM = 210;
const LEFT = 36;
const RIGHT = 318;
const STORE_X = 332;
const STORE_W = 38;

export function monthLabel(t: number): string {
  const m = Math.floor(t + 1e-9);
  const y = 2027 + Math.floor((m + 3) / 12);
  const mm = ((m + 3) % 12) + 1;
  return `${y}年${mm}月`;
}

function fmtTick(v: number, view: View): string {
  if (view === "share") return `${(v * 100).toFixed(v < 0.01 ? 1 : 0)}%`;
  return `${Math.round(v / 10000)}万`;
}

/**
 * 1 つの方針の世界を 1 枚のキャンバスに描く。
 * 横に世帯を年収の低い順に並べ、縦棒は 8% のままと比べた得の累計。
 * 右の箱は、値下げに回らずお店に残った減税分。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme, view: View, yMax: number) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const p = s.params;
  const cut = isCut(s.policy);
  const inCut = cut && s.t < CUT_MONTHS;

  // 見出し: 年月、税率、値段
  ctx.font = "bold 13px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.fg;
  ctx.fillText(monthLabel(Math.min(s.t, 35.99)), 8, 14);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = inCut ? theme.worker : theme.muted;
  ctx.fillText(`食料品の税 ${inCut ? "1%" : "8%"}`, 96, 14);
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "right";
  ctx.fillText(`値段 ${priceIndex(s.t, p.inflation, cut, p.passThrough).toFixed(1)}`, W - 8, 14);

  // 振り込みの直後は知らせる
  const justPaid = PAY_MONTHS.some((m) => s.t >= m && s.t < m + 1.2) && s.payBudget > 0 && (s.policy.kind === "flat" || s.policy.kind === "targeted" || s.policy.workerSupport > 0);
  if (justPaid) {
    ctx.textAlign = "left";
    ctx.fillStyle = theme.store;
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("給付の振り込み", 8, 31);
  }

  // 目盛り
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 2; i++) {
    const v = (yMax * i) / 2;
    const y = BOTTOM - ((BOTTOM - TOP) * i) / 2;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LEFT, y);
    ctx.lineTo(RIGHT, y);
    ctx.stroke();
    ctx.fillStyle = theme.muted;
    ctx.fillText(fmtTick(v, view), LEFT - 4, y);
  }

  // 世帯の棒
  const n = s.households.length;
  const bw = (RIGHT - LEFT) / n;
  const plotH = BOTTOM - TOP;
  for (let i = 0; i < n; i++) {
    const h = s.households[i];
    const v = view === "yen" ? s.gain[i] : s.gain[i] / h.income;
    const frac = Math.min(1, v / yMax);
    const bh = frac * plotH;
    ctx.fillStyle = h.kind === "pension" ? theme.pension : theme.worker;
    ctx.fillRect(LEFT + i * bw, BOTTOM - bh, Math.max(0.8, bw - 0.4), bh);
    if (v > yMax) {
      // 枠を超えた世帯は上に印
      ctx.fillRect(LEFT + i * bw, TOP - 4, Math.max(0.8, bw - 0.4), 2);
    }
  }

  // 五分位の区切り
  ctx.strokeStyle = theme.border;
  ctx.setLineDash([2, 3]);
  for (let q = 1; q < 5; q++) {
    const x = LEFT + ((q * n) / 5) * bw;
    ctx.beginPath();
    ctx.moveTo(x, TOP);
    ctx.lineTo(x, BOTTOM);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(LEFT, BOTTOM + 0.5);
  ctx.lineTo(RIGHT, BOTTOM + 0.5);
  ctx.stroke();

  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  ctx.font = "10px sans-serif";
  const labels = ["低い 20%", "", "真ん中", "", "高い 20%"];
  for (let q = 0; q < 5; q++) {
    if (!labels[q]) continue;
    ctx.fillText(labels[q], LEFT + ((q + 0.5) * n * bw) / 5, BOTTOM + 12);
  }
  ctx.fillText("← 年収の低い世帯　　　世帯 (年収順)　　　高い世帯 →", (LEFT + RIGHT) / 2, BOTTOM + 30);

  // お店に残った分 (1 世帯あたりに直して、同じ縦軸で描く)
  ctx.fillStyle = theme.muted;
  ctx.fillText("お店", STORE_X + STORE_W / 2, TOP - 10);
  ctx.strokeStyle = theme.border;
  ctx.strokeRect(STORE_X + 0.5, TOP + 0.5, STORE_W - 1, plotH);
  const leakPerHh = s.leak / n;
  if (view === "yen" && leakPerHh > 0) {
    const lh = Math.min(1, leakPerHh / yMax) * plotH;
    ctx.fillStyle = theme.store;
    ctx.fillRect(STORE_X + 3, BOTTOM - lh, STORE_W - 6, lh);
  }
  ctx.fillStyle = theme.muted;
  ctx.font = "10px sans-serif";
  ctx.fillText(view === "yen" ? `${(leakPerHh / 10000).toFixed(1)}万` : "–", STORE_X + STORE_W / 2, BOTTOM + 12);
}
