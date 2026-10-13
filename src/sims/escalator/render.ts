import type { SimState, Person } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  stander: string;
  walker: string;
  drunk: string;
  fallen: string;
  critical: string;
}

export const CANVAS_W = 320;
export const CANVAS_H = 560;

const STRIP_TOP = 56;
const STRIP_BOTTOM = 400;
const LANE_W = 40;
const QUEUE_TOP = 428;

/**
 * 1 つの乗り方 (walkLane / standBoth) を 1 枚のキャンバスに描く。
 * walkLaneSide: 歩く側のレーンを右に描くか左に描くか (関東式 = 右)。
 */
export function renderSim(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  theme: RenderTheme,
  walkLaneSide: "right" | "left",
) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const len = s.params.lengthSteps;
  const stripH = STRIP_BOTTOM - STRIP_TOP;
  const stepPx = stripH / len;
  const stripX = W / 2 - LANE_W;

  // レーンの x 座標 (レーン 1 = 歩く側)
  const laneX = (lane: 0 | 1): number => {
    if (s.policy === "standBoth") return stripX + LANE_W * (lane + 0.5);
    const walkRight = walkLaneSide === "right";
    const isWalk = lane === 1;
    const right = walkRight ? isWalk : !isWalk;
    return stripX + LANE_W * (right ? 1.5 : 0.5);
  };

  // 手すり + 段
  ctx.fillStyle = theme.grid;
  ctx.fillRect(stripX - 6, STRIP_TOP - 4, LANE_W * 2 + 12, stripH + 8);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(stripX, STRIP_TOP, LANE_W * 2, stripH);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  const frac = ((s.beltOffset % 1) + 1) % 1;
  ctx.beginPath();
  for (let k = 0; k <= len; k++) {
    const y = STRIP_BOTTOM - (k + frac) * stepPx;
    if (y < STRIP_TOP || y > STRIP_BOTTOM) continue;
    ctx.moveTo(stripX, y);
    ctx.lineTo(stripX + LANE_W * 2, y);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(stripX + LANE_W, STRIP_TOP);
  ctx.lineTo(stripX + LANE_W, STRIP_BOTTOM);
  ctx.stroke();

  // レーン見出し
  ctx.font = "600 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.muted;
  if (s.policy === "walkLane") {
    ctx.fillText("立つ", laneX(0), STRIP_TOP - 10);
    ctx.fillText("歩く", laneX(1), STRIP_TOP - 10);
  } else {
    ctx.fillText("立つ", laneX(0), STRIP_TOP - 10);
    ctx.fillText("立つ", laneX(1), STRIP_TOP - 10);
  }

  // 降り口 / 乗り口 ラベル
  ctx.textAlign = "left";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("降り口 ↑", stripX + LANE_W * 2 + 12, STRIP_TOP + 12);
  ctx.fillText("乗り口", stripX + LANE_W * 2 + 12, STRIP_BOTTOM - 2);
  ctx.textAlign = "right";
  ctx.font = "700 14px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`${s.exited} 人`, stripX - 14, STRIP_TOP + 14);
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("到着", stripX - 14, STRIP_TOP + 26);

  // 乗っている人
  const drawPerson = (p: Person, x: number, y: number) => {
    const r = 6.5;
    let fill = theme.stander;
    if (p.relSpeed > 0) fill = theme.walker;
    if (p.isDrunk) fill = theme.drunk;
    if (p.state === "tumbling" || p.state === "fallen") fill = theme.fallen;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.bg;
    ctx.stroke();
    if (p.state === "fallen") {
      // 倒れている: ×
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 3);
      ctx.lineTo(x + 3, y + 3);
      ctx.moveTo(x + 3, y - 3);
      ctx.lineTo(x - 3, y + 3);
      ctx.stroke();
    } else if (p.state === "tumbling") {
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + 3, y + 3);
      ctx.stroke();
    } else if (p.relSpeed > 0) {
      // 歩く人: 上向きの山形
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 3, y + 1.5);
      ctx.lineTo(x, y - 2);
      ctx.lineTo(x + 3, y + 1.5);
      ctx.stroke();
    }
  };

  for (const lane of [0, 1] as const) {
    for (const id of s.riders[lane]) {
      const p = s.people[id - 1];
      const y = STRIP_BOTTOM - p.pos * stepPx - stepPx / 2;
      drawPerson(p, laneX(lane), y);
    }
  }

  // 非常停止
  if (s.stoppedUntil !== null) {
    ctx.fillStyle = theme.critical;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(stripX, STRIP_TOP, LANE_W * 2, stripH);
    ctx.globalAlpha = 1;
    const remain = Math.max(0, Math.ceil(s.stoppedUntil - s.t));
    const label = `⚠ 非常停止中 残り ${remain} 秒`;
    ctx.font = "700 12px sans-serif";
    ctx.textAlign = "center";
    const tw = ctx.measureText(label).width;
    const by = STRIP_TOP + stripH / 2;
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(W / 2 - tw / 2 - 8, by - 12, tw + 16, 20);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.critical;
    ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - tw / 2 - 8, by - 12, tw + 16, 20);
    ctx.fillStyle = theme.critical;
    ctx.fillText(label, W / 2, by + 3);
  }

  // 待ち行列
  ctx.textAlign = "center";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  const dot = 5;
  const gapPx = 9;
  if (s.policy === "walkLane") {
    for (const lane of [0, 1] as const) {
      const q = s.queues[lane];
      const cx = laneX(lane);
      const cols = 4;
      const maxShow = 40;
      for (let i = 0; i < Math.min(q.length, maxShow); i++) {
        const p = s.people[q[i] - 1];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = cx - ((cols - 1) * gapPx) / 2 + col * gapPx;
        const y = QUEUE_TOP + row * gapPx;
        ctx.beginPath();
        ctx.arc(x, y, dot / 2, 0, Math.PI * 2);
        ctx.fillStyle = p.isDrunk ? theme.drunk : p.lane === 1 ? theme.walker : theme.stander;
        ctx.fill();
      }
      ctx.fillStyle = theme.muted;
      const label = q.length > maxShow ? `${q.length} 人 (+${q.length - maxShow})` : `${q.length} 人`;
      ctx.fillText(label, cx, QUEUE_TOP + Math.ceil(maxShow / cols) * gapPx + 10);
    }
  } else {
    const q = s.queues[0];
    const cols = 8;
    const maxShow = 80;
    const cx = W / 2;
    for (let i = 0; i < Math.min(q.length, maxShow); i++) {
      const p = s.people[q[i] - 1];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cx - ((cols - 1) * gapPx) / 2 + col * gapPx;
      const y = QUEUE_TOP + row * gapPx;
      ctx.beginPath();
      ctx.arc(x, y, dot / 2, 0, Math.PI * 2);
      ctx.fillStyle = p.isDrunk ? theme.drunk : p.pref === "walk" ? theme.walker : theme.stander;
      ctx.fill();
    }
    ctx.fillStyle = theme.muted;
    const label = q.length > maxShow ? `${q.length} 人 (+${q.length - maxShow})` : `${q.length} 人`;
    ctx.fillText(label, cx, QUEUE_TOP + Math.ceil(maxShow / cols) * gapPx + 10);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = theme.muted;
  ctx.fillText("待ち行列", 12, QUEUE_TOP + 4);
}
