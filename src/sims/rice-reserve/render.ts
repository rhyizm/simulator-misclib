import { CRISIS_RATIO, EMPTY_MONTHS, LOW_RATIO, MONTHS, govStock, monthOfYear, yearOf, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  gov: string;
  priv: string;
  crisis: string;
  low: string;
}

export const CANVAS_W = 340;
export const CANVAS_H = 250;

const TOP = 40;
const BOTTOM = 196;
const H = BOTTOM - TOP;

/** 政府の倉庫: 1 マス = 5 万 t、横 6 マス × 縦 6 段 = 180 万 t まで */
const BLOCK = 5;
const COLS = 6;
const CELL = 13;
const WH_X = 14;

/** 民間在庫のタンク: 0〜600 万 t */
const PRIV_MAX = 600;
const TANK_X = 140;
const TANK_W = 54;

/** 値段の温度計: 1,500〜7,500 円 (それより高いときは上に張り付く) */
const P_MIN = 1500;
const P_MAX = 7500;
const THERMO_X = 262;

function priceY(p: number): number {
  const f = (Math.min(P_MAX, Math.max(P_MIN, p)) - P_MIN) / (P_MAX - P_MIN);
  return BOTTOM - f * H;
}

function withAlpha(color: string, alpha: number): string {
  // #rrggbb のときだけ透明度を付ける
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `${color}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0")}`;
  }
  return color;
}

/**
 * 1 つの方針の世界を 1 枚のキャンバスに描く。
 * 左が政府の倉庫 (マスの濃さ = 米の新しさ)、真ん中が民間在庫のタンク、右が店頭の値段の温度計。
 * 下に最近の出来事を出す。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, th: RenderTheme) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textBaseline = "alphabetic";

  const y = yearOf(Math.max(0, s.month - (s.month > 0 ? 1 : 0)));
  const mo = monthOfYear(Math.max(0, s.month - (s.month > 0 ? 1 : 0)));
  ctx.fillStyle = th.fg;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText(`${y + 1} 年目 ${MONTHS[mo]} 月`, 12, 18);
  ctx.fillStyle = th.muted;
  ctx.font = "11px system-ui, sans-serif";
  const yieldIdx = s.yields[yearOf(Math.min(s.month, s.params.years * 12 - 1))];
  if (mo >= 1) ctx.fillText(`今年の作況 ${yieldIdx}`, 110, 18);

  // ── 政府の倉庫 ──
  const lots = [...s.lots].sort((a, b) => a.year - b.year);
  const blocks: number[] = []; // 各マスの米の年齢
  for (const l of lots) {
    const n = Math.round(l.tons / BLOCK);
    for (let i = 0; i < n; i++) blocks.push(y - l.year);
  }
  const rows = Math.ceil(180 / BLOCK / COLS);
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(WH_X - 3, BOTTOM - rows * CELL - 3, COLS * CELL + 6, rows * CELL + 6);
  // 新しい米ほど下に (古いものから先に出ていく様子が上から減って見える)
  const newestFirst = [...blocks].sort((a, b) => a - b);
  for (let i = 0; i < newestFirst.length && i < rows * COLS; i++) {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    const age = newestFirst[i];
    const alpha = Math.max(0.25, 1 - age * 0.15);
    ctx.fillStyle = withAlpha(th.gov, alpha);
    ctx.fillRect(WH_X + c * CELL, BOTTOM - (r + 1) * CELL, CELL - 2, CELL - 2);
  }
  // 目標の線
  const targetRows = s.policy.target / BLOCK / COLS;
  const ty = BOTTOM - targetRows * CELL - 1;
  ctx.strokeStyle = th.fg;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(WH_X - 6, ty);
  ctx.lineTo(WH_X + COLS * CELL + 6, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = th.muted;
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText(`目標 ${s.policy.target}`, WH_X + COLS * CELL + 8, ty + 3);
  ctx.fillStyle = th.fg;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.fillText(`政府備蓄 ${Math.round(govStock(s))} 万t`, WH_X - 2, BOTTOM + 16);

  // ── 民間在庫のタンク ──
  ctx.strokeStyle = th.border;
  ctx.strokeRect(TANK_X, TOP, TANK_W, H);
  const privH = (Math.min(PRIV_MAX, Math.max(0, s.priv)) / PRIV_MAX) * H;
  const monthly = s.params.demand / 12;
  const empty = s.priv < EMPTY_MONTHS * monthly;
  ctx.fillStyle = empty ? th.crisis : th.priv;
  ctx.fillRect(TANK_X + 1, BOTTOM - privH, TANK_W - 2, privH);
  // 1 か月分の線
  const oneY = BOTTOM - (monthly / PRIV_MAX) * H;
  ctx.strokeStyle = th.crisis;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(TANK_X - 4, oneY);
  ctx.lineTo(TANK_X + TANK_W + 4, oneY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = th.muted;
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText("1か月分", TANK_X + TANK_W + 6, oneY + 3);
  // 届く途中の放出米
  let incoming = 0;
  for (const sh of s.pipeline) incoming += sh.tons;
  if (incoming > 0) {
    ctx.fillStyle = th.gov;
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.fillText(`← 放出 ${Math.round(incoming)}万t 輸送中`, TANK_X - 30, TOP - 6);
  }
  ctx.fillStyle = th.fg;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.fillText(`民間在庫 ${Math.round(s.priv)} 万t`, TANK_X - 8, BOTTOM + 16);
  if (empty) {
    ctx.fillStyle = th.crisis;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("品薄", TANK_X + 2, BOTTOM - privH - 6);
  }

  // ── 値段の温度計 ──
  const ref = s.params.refPrice;
  const crisis = s.price >= CRISIS_RATIO * ref;
  const low = s.price <= LOW_RATIO * ref;
  ctx.strokeStyle = th.border;
  ctx.strokeRect(THERMO_X, TOP, 14, H);
  for (const [ratio, label] of [
    [CRISIS_RATIO, "米騒動"],
    [1, "いつも"],
    [LOW_RATIO, "安すぎ"],
  ] as const) {
    const ly = priceY(ref * ratio);
    ctx.strokeStyle = ratio === 1 ? th.muted : ratio > 1 ? th.crisis : th.low;
    ctx.beginPath();
    ctx.moveTo(THERMO_X - 4, ly);
    ctx.lineTo(THERMO_X + 18, ly);
    ctx.stroke();
    ctx.fillStyle = th.muted;
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(label, THERMO_X + 20, ly + 3);
  }
  const py = priceY(s.price);
  ctx.fillStyle = crisis ? th.crisis : low ? th.low : th.fg;
  ctx.fillRect(THERMO_X + 3, py, 8, BOTTOM - py);
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(s.price).toLocaleString("ja-JP")} 円`, CANVAS_W - 8, 18);
  ctx.fillStyle = th.muted;
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText("5kg あたり", CANVAS_W - 8, 31);
  ctx.textAlign = "left";

  // ── 最近の出来事 ──
  const recent = s.events.filter((e) => e.month >= s.month - 6).slice(-2);
  ctx.font = "11px system-ui, sans-serif";
  recent.forEach((e, i) => {
    const color =
      e.kind === "release" ? th.gov : e.kind === "empty" ? th.crisis : e.kind === "buy" ? th.priv : th.muted;
    ctx.fillStyle = color;
    const ey = yearOf(e.month);
    const em = MONTHS[monthOfYear(e.month)];
    ctx.fillText(`${ey + 1}年目${em}月 ${e.text}`, 12, BOTTOM + 34 + i * 14);
  });
}
