import { nextStop, type Bus, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  resident: string;
  tourist: string;
  express: string;
}

export const CANVAS_W = 340;
export const CANVAS_H = 384;

const TOP = 34;
const ROW = 43;
const LINE_X = 98;
const DOTS_X = 128;
const DOT_GAP = 8;
const DOT_ROWS = 3;

function stopY(i: number): number {
  return TOP + i * ROW + 10;
}

/** バスの今の位置 (y)。走っている間は前後の停留所の間を補間する */
function busY(s: SimState, bus: Bus): number {
  if (bus.state !== "move") return stopY(bus.at);
  const to = nextStop(s, bus);
  const span = Math.max(1, bus.until - bus.since);
  const f = Math.max(0, Math.min(1, (s.t - bus.since) / span));
  return stopY(bus.at) + (stopY(to) - stopY(bus.at)) * f;
}

/**
 * 1 つの方針の世界を 1 枚のキャンバスに描く。
 * 上が京都駅、下が祇園。左に停留所名、真ん中の線の上をバスが下っていき、
 * 右に停留所で待っている人を点で並べる。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "left";
  ctx.fillText("待っている人", DOTS_X, 12);
  ctx.textAlign = "center";
  ctx.fillText("バス", LINE_X, 12);

  // 路線
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(LINE_X, stopY(0));
  ctx.lineTo(LINE_X, stopY(s.stops.length - 1));
  ctx.stroke();

  const cols = Math.floor((W - 8 - DOTS_X) / DOT_GAP) + 1;
  const maxShow = cols * DOT_ROWS;
  s.stops.forEach((stop, i) => {
    const y = stopY(i);
    // 停留所の丸と名前
    ctx.beginPath();
    ctx.arc(LINE_X, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    const expressStop = stop.express && s.policy.expressDrivers > 0;
    ctx.strokeStyle = expressStop ? theme.express : theme.muted;
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.font = expressStop ? "600 12px sans-serif" : "12px sans-serif";
    ctx.fillStyle = theme.fg;
    ctx.fillText(stop.name, LINE_X - 22, y);

    // 待っている人: 市民を先に、観光客を後に並べる (並んだ順ではなく人数の内訳を見せる)
    const q = s.queues[i];
    let r = 0;
    for (const id of q) if (s.people[id - 1].kind === "r") r++;
    const t = q.length - r;
    const shown = Math.min(q.length, maxShow);
    for (let k = 0; k < shown; k++) {
      const col = k % cols;
      const row = Math.floor(k / cols);
      ctx.beginPath();
      ctx.arc(DOTS_X + col * DOT_GAP, y - DOT_GAP + row * DOT_GAP, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = k < Math.min(r, shown) ? theme.resident : theme.tourist;
      ctx.fill();
    }
    if (q.length > maxShow) {
      ctx.font = "700 11px sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = theme.fg;
      const label = `${q.length} 人 (市民 ${r}・観光 ${t})`;
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = theme.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(W - 6 - w, y + DOT_GAP + 4, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.fg;
      ctx.fillText(label, W - 10, y + DOT_GAP + 11);
    }
  });

  // バス: 同じ高さに重なったら左右にずらす (団子運転が見えるように)
  const active = s.buses.filter((b) => b.state !== "done");
  const placed: { y: number; n: number }[] = [];
  for (const bus of active) {
    const y = busY(s, bus);
    let slot = placed.find((p) => Math.abs(p.y - y) < 18);
    if (!slot) {
      slot = { y, n: 0 };
      placed.push(slot);
    }
    const x = LINE_X - 9 - slot.n * 13 + (slot.n > 0 ? -4 : 0);
    slot.n++;
    drawBus(ctx, s, bus, x, y - 14, theme);
  }
}

function drawBus(ctx: CanvasRenderingContext2D, s: SimState, bus: Bus, x: number, y: number, theme: RenderTheme) {
  const w = 18;
  const h = 28;
  const cap = s.params.capacity;
  let r = 0;
  let t = 0;
  for (const id of bus.onboard) {
    const p = s.people[id - 1];
    const sp = p.luggage ? 2 : 1;
    if (p.kind === "r") r += sp;
    else t += sp;
  }
  ctx.fillStyle = theme.bg;
  ctx.fillRect(x, y, w, h);
  // 下から 観光客 → 市民 の順に積む
  const th = (Math.min(cap, t) / cap) * (h - 2);
  const rh = (Math.min(cap - Math.min(cap, t), r) / cap) * (h - 2);
  ctx.fillStyle = theme.tourist;
  ctx.fillRect(x + 1, y + h - 1 - th, w - 2, th);
  ctx.fillStyle = theme.resident;
  ctx.fillRect(x + 1, y + h - 1 - th - rh, w - 2, rh);
  ctx.lineWidth = bus.express ? 2 : 1.2;
  ctx.strokeStyle = bus.express ? theme.express : theme.fg;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (bus.express) {
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = theme.express;
    ctx.fillText("特", x + w / 2, y - 6);
  }
}
