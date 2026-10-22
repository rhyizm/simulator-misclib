import { DAY_START_HOUR, QUICK_MIN, clock, waitOf, type Call, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  ok: string;
  warn: string;
  crit: string;
  work: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 456;

const AREA_TOP = 80;
const AREA_BOTTOM = 372;
const QUEUE_X = 10;
const QUEUE_W = 120;
const DESK_X = 142;
const DESK_W = 168;
const TL_Y = 408;
/** カスハラの通話バーの全幅が表す長さ (分) */
const HARASS_BAR_MIN = 120;

/** 保留の長さで色を変える (すぐつながる範囲 / 待てる平均まで / それ以上) */
function waitColor(c: Call, s: SimState, theme: RenderTheme): string {
  const w = waitOf(c, s.t);
  if (w > s.params.patienceMean) return theme.crit;
  if (w > QUICK_MIN) return theme.warn;
  return theme.ok;
}

/** カスハラの電話は三角、普通の電話は丸 */
function drawCaller(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, harass: boolean, fill: string, theme: RenderTheme) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  if (harass) {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y + r);
    ctx.lineTo(x - r - 1, y + r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.fg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 1 つのやり方 (noLimit / cap) を 1 枚のキャンバスに描く。
 * 左が保留中の電話、右がオペレーターの席、下が 1 日のタイムライン。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const p = s.params;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 時計と進み具合
  let answered = 0;
  let abandoned = 0;
  for (const c of s.calls) {
    if (c.harass) continue;
    if (c.state === "abandoned") abandoned++;
    else if (c.state === "talking" || c.state === "done") answered++;
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "700 22px ui-monospace, monospace";
  ctx.fillStyle = theme.fg;
  ctx.fillText(clock(s.t), QUEUE_X, 30);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(s.t < p.closeAt ? `受付中 (${clock(p.closeAt)} まで)` : "受付終了", QUEUE_X, 46);
  ctx.textAlign = "right";
  ctx.font = "700 14px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`${answered} 人`, W - 70, 28);
  ctx.fillStyle = abandoned > 0 ? theme.crit : theme.fg;
  ctx.fillText(`${abandoned} 人`, W - 10, 28);
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("つながった", W - 70, 42);
  ctx.fillText("あきらめた", W - 10, 42);

  // 保留中の電話
  ctx.strokeStyle = theme.border;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(QUEUE_X + 0.5, AREA_TOP + 0.5, QUEUE_W, AREA_BOTTOM - AREA_TOP);
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(`保留中 ${s.queue.length} 人`, QUEUE_X, AREA_TOP - 6);
  const cols = 5;
  const cell = QUEUE_W / cols;
  const maxRows = Math.floor((AREA_BOTTOM - AREA_TOP - 8) / cell);
  const maxShow = cols * maxRows;
  for (let i = 0; i < Math.min(s.queue.length, maxShow); i++) {
    const c = s.calls[s.queue[i]];
    const x = QUEUE_X + (i % cols) * cell + cell / 2;
    const y = AREA_TOP + 6 + Math.floor(i / cols) * cell + cell / 2;
    drawCaller(ctx, x, y, 7, c.harass, waitColor(c, s, theme), theme);
  }
  if (s.queue.length > maxShow) {
    ctx.fillStyle = theme.muted;
    ctx.font = "11px sans-serif";
    ctx.fillText(`ほか ${s.queue.length - maxShow} 人`, QUEUE_X + 6, AREA_BOTTOM - 6);
  }

  // オペレーターの席
  ctx.fillStyle = theme.grid;
  ctx.fillRect(DESK_X, AREA_TOP, DESK_W, AREA_BOTTOM - AREA_TOP);
  ctx.textAlign = "left";
  ctx.font = "600 11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("オペレーター", DESK_X, AREA_TOP - 6);
  const rowH = Math.min(64, (AREA_BOTTOM - AREA_TOP) / s.ops.length);
  const barX = DESK_X + 26;
  const barW = DESK_W - 34;
  for (let i = 0; i < s.ops.length; i++) {
    const op = s.ops[i];
    const y0 = AREA_TOP + i * rowH;
    ctx.strokeStyle = theme.border;
    ctx.beginPath();
    ctx.moveTo(DESK_X, y0 + rowH);
    ctx.lineTo(DESK_X + DESK_W, y0 + rowH);
    ctx.stroke();
    const midY = y0 + rowH / 2;
    ctx.fillStyle = theme.muted;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${i + 1}`, DESK_X + 6, midY + 3);

    const barY = midY - 7;
    if (op.state === "left") {
      ctx.fillStyle = theme.muted;
      ctx.font = "600 11px sans-serif";
      ctx.fillText(`早退 (${clock(op.tLeft)})`, barX, midY + 4);
      continue;
    }
    if (op.state === "talking") {
      const c = s.calls[op.call];
      const elapsed = s.t - c.tStart;
      ctx.fillStyle = theme.border;
      ctx.fillRect(barX, barY, barW, 8);
      if (c.harass) {
        ctx.fillStyle = theme.crit;
        ctx.fillRect(barX, barY, barW * Math.min(1, elapsed / HARASS_BAR_MIN), 8);
        if (s.policy === "cap") {
          // 打ち切りの上限
          const cx = Math.round(barX + barW * Math.min(1, p.capMin / HARASS_BAR_MIN)) + 0.5;
          ctx.strokeStyle = theme.fg;
          ctx.beginPath();
          ctx.moveTo(cx, barY - 3);
          ctx.lineTo(cx, barY + 11);
          ctx.stroke();
        }
        ctx.fillStyle = theme.crit;
        ctx.font = "600 10px sans-serif";
        ctx.fillText(`カスハラ対応 ${Math.floor(elapsed)} 分${c.attempt > 1 ? ` (${c.attempt} 回目)` : ""}`, barX, barY - 3);
      } else {
        ctx.fillStyle = theme.work;
        ctx.fillRect(barX, barY, barW * Math.min(1, elapsed / c.need), 8);
      }
    } else {
      ctx.fillStyle = theme.muted;
      ctx.font = "10px sans-serif";
      const label = op.state === "wrapup" ? "後処理" : op.state === "recover" ? "席を離れて休憩" : "空き";
      ctx.fillText(label, barX, barY + 8);
    }
    // たまった負担
    const sy = barY + 12;
    const ratio = Math.min(1, op.stress / p.stressLimit);
    ctx.fillStyle = theme.border;
    ctx.fillRect(barX, sy, barW, 3);
    if (ratio > 0) {
      ctx.fillStyle = ratio > 0.75 ? theme.crit : theme.warn;
      ctx.fillRect(barX, sy, barW * ratio, 3);
    }
  }

  // タイムライン: カスハラ対応の時間帯 (上) と、あきらめた客 (下)
  const tlX0 = 10;
  const tlX1 = W - 10;
  const tx = (t: number) => tlX0 + (Math.min(t, p.durationMin) / p.durationMin) * (tlX1 - tlX0);
  ctx.fillStyle = theme.grid;
  ctx.fillRect(tx(0), TL_Y - 8, tx(p.closeAt) - tx(0), 16);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(tlX0, TL_Y);
  ctx.lineTo(tlX1, TL_Y);
  ctx.stroke();
  for (const c of s.calls) {
    if (c.harass && (c.state === "talking" || c.state === "done")) {
      const end = c.state === "talking" ? s.t : c.tEnd;
      ctx.fillStyle = theme.crit;
      ctx.fillRect(tx(c.tStart), TL_Y - 6 + (c.op % 4) * 3, Math.max(1.5, tx(end) - tx(c.tStart)), 2.5);
    } else if (c.state === "abandoned") {
      ctx.fillStyle = theme.muted;
      ctx.fillRect(tx(c.tEnd) - 0.5, TL_Y + 9, 1.5, 5);
    }
  }
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  for (let h = DAY_START_HOUR; (h - DAY_START_HOUR) * 60 <= p.durationMin; h += 2) {
    ctx.fillText(`${h}:00`, Math.min(tlX1 - 14, Math.max(tlX0 + 14, tx((h - DAY_START_HOUR) * 60))), TL_Y + 28);
  }
  // 現在時刻
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx(s.t), TL_Y - 12);
  ctx.lineTo(tx(s.t), TL_Y + 14);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.textAlign = "left";
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("受付時間とカスハラ対応 (赤)、あきらめた客 (下の線)", tlX0, TL_Y - 14);
}
