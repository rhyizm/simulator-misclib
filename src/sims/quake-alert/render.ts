import type { EventKind, SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  resident: string;
  hit: string;
  falseAlarm: string;
  miss: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 400;

/** 地震のあと、住民の反応をこの年数だけ表示しておく */
export const FLASH_YEARS = 0.6;

const COLS = 20;
const CELL = 13;
const GRID_TOP = 58;
const GRID_LEFT = (CANVAS_W - COLS * CELL) / 2;
const TL_TOP = 340;
const TL_LEFT = 24;
const TL_RIGHT = CANVAS_W - 24;

export const KIND_LABEL: Record<EventKind, string> = {
  hit: "的中",
  false: "空振り",
  miss: "見逃し",
  quiet: "警報なし",
};

function kindColor(theme: RenderTheme, kind: EventKind): string {
  if (kind === "hit") return theme.hit;
  if (kind === "false") return theme.falseAlarm;
  if (kind === "miss") return theme.miss;
  return theme.muted;
}

/**
 * 1 つの世界 (しきい値) を 1 枚のキャンバスに描く。
 * 上: 町の 400 人 (点の濃さ = 警報への信頼)。下: 30 年の年表。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const last = s.last;
  const flashing = last !== null && last.kind !== "quiet" && s.t - last.t < FLASH_YEARS;

  // 見出し: 経過年数と、直近の地震の結果
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  ctx.fillText(`${Math.min(s.t, s.params.years).toFixed(1)} 年目`, GRID_LEFT, 22);
  if (flashing && last) {
    const color = kindColor(theme, last.kind);
    const label = `${KIND_LABEL[last.kind]}${last.glitch ? " (誤作動)" : ""}`;
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = color;
    ctx.fillText(label, W - GRID_LEFT, 22);
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = theme.muted;
    ctx.fillText(
      `実際 ${last.intensity.toFixed(1)} / 推定 ${last.estimate.toFixed(1)}`,
      W - GRID_LEFT,
      40,
    );
  }

  // 住民
  const strongNow = flashing && last !== null && (last.kind === "hit" || last.kind === "miss");
  for (let i = 0; i < s.trust.length; i++) {
    const cx = GRID_LEFT + (i % COLS) * CELL + CELL / 2;
    const cy = GRID_TOP + Math.floor(i / COLS) * CELL + CELL / 2;
    const acted = flashing && last ? last.acted[i] : false;
    if (flashing && last && acted) {
      // 身構えた人 (的中なら守れた、空振りなら無駄足)
      ctx.fillStyle = kindColor(theme, last.kind);
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    } else if (strongNow) {
      // 強い揺れなのに身を守れなかった人
      ctx.strokeStyle = theme.miss;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.12 + 0.88 * Math.max(0, Math.min(1, s.trust[i]));
      ctx.fillStyle = theme.resident;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // 年表
  const years = s.params.years;
  const x = (t: number) => TL_LEFT + (t / years) * (TL_RIGHT - TL_LEFT);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TL_LEFT, TL_TOP + 22);
  ctx.lineTo(TL_RIGHT, TL_TOP + 22);
  ctx.stroke();
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = theme.muted;
  for (let y = 0; y <= years; y += 10) {
    ctx.fillText(`${y}年`, x(y), TL_TOP + 40);
  }
  // 空振りは上、的中は中央、見逃しは下に
  const rowY: Record<EventKind, number> = { false: TL_TOP + 4, hit: TL_TOP + 13, miss: TL_TOP + 22, quiet: 0 };
  for (const e of s.log) {
    ctx.strokeStyle = kindColor(theme, e.kind);
    ctx.lineWidth = e.glitch ? 2.5 : 1.5;
    ctx.beginPath();
    const ex = x(e.t);
    ctx.moveTo(ex, rowY[e.kind] - 4);
    ctx.lineTo(ex, rowY[e.kind] + 4);
    ctx.stroke();
  }
  // 現在位置
  ctx.fillStyle = theme.fg;
  ctx.beginPath();
  const nx = x(Math.min(s.t, years));
  ctx.moveTo(nx, TL_TOP + 25);
  ctx.lineTo(nx - 4, TL_TOP + 31);
  ctx.lineTo(nx + 4, TL_TOP + 31);
  ctx.closePath();
  ctx.fill();
}
