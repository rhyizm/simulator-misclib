import { fmtClock, isSnowing, isWorkTime, type SimState, type Unit } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  lit: string;
  fault: string;
  tree: string;
  crew: string;
  road: string;
  gen: string;
}

export const CANVAS_W = 360;
export const CANVAS_H = 262;

function unitXY(s: SimState, u: Unit): [number, number] {
  const net = s.net;
  const a = u.node;
  if (u.path.length === 0 || u.prog <= 0) return [net.x[a], net.y[a]];
  const b = u.path[0];
  const seg = net.parent[b] === a ? b : a;
  const f = Math.min(1, u.prog / net.lenKm[seg]);
  return [net.x[a] + (net.x[b] - net.x[a]) * f, net.y[a] + (net.y[b] - net.y[a]) * f];
}

/** 雪の粒: 時刻から決まる擬似乱数の位置 (毎回同じ絵になる) */
function drawSnow(ctx: CanvasRenderingContext2D, t: number, th: RenderTheme) {
  ctx.fillStyle = th.fg;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 70; i++) {
    const sx = (i * 97.13) % CANVAS_W;
    const speed = 22 + (i % 7) * 4;
    const sy = (((i * 53.7 + t * 60 * speed) % (CANVAS_H - 30)) + (CANVAS_H - 30)) % (CANVAS_H - 30);
    const drift = Math.sin(t * 6 + i) * 3;
    ctx.fillRect(sx + drift, 30 + sy, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
}

/**
 * 1 つの世界を 1 枚のキャンバスに描く。
 * 左の変電所から右へ延びるのが幹線 (国道沿い)、上下に枝分かれするのが山あいの集落へ向かう支線。
 * 丸が集落 (大きさは家の数)、黄色は電気が来ている、灰色は停電。× は切れた電線、▲ は道をふさぐ倒木。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, th: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const net = s.net;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  const snowing = isSnowing(s.params, s.t);
  const day = isWorkTime(s.params, s.t);

  // 時計と停電の戸数
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = th.fg;
  ctx.font = "600 15px ui-monospace, monospace";
  ctx.fillText(fmtClock(s.t), 8, 20);
  ctx.textAlign = "right";
  ctx.font = "600 13px sans-serif";
  ctx.fillStyle = s.out > 0 ? th.fault : th.muted;
  ctx.fillText(s.out > 0 ? `停電 ${s.out.toLocaleString()} 戸` : s.t > 1 && s.peakOut > 0 ? "全戸に電気が戻った" : "停電なし", W - 8, 20);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = th.muted;
  const status = [snowing ? "雪が降っている" : "", day ? "" : "夜: 山の中は作業できない"].filter(Boolean).join("・");
  ctx.textAlign = "left";
  ctx.fillText(status, 8, 34);

  if (snowing) drawSnow(ctx, s.t, th);

  // 区間 (電線)
  for (let v = 1; v < net.n; v++) {
    const p = net.parent[v];
    const on = s.grid[v];
    ctx.strokeStyle = on ? th.fg : th.muted;
    ctx.globalAlpha = on ? 0.75 : 0.5;
    ctx.lineWidth = net.trunk[v] ? 3 : 1.6;
    ctx.setLineDash(on ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(net.x[p], net.y[p]);
    ctx.lineTo(net.x[v], net.y[v]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;

  // 道の倒木 (▲) と切れた電線 (×)
  for (let v = 1; v < net.n; v++) {
    const p = net.parent[v];
    const mx = (net.x[p] + net.x[v]) / 2;
    const my = (net.y[p] + net.y[v]) / 2;
    if (s.roadLeft[v] > 0) {
      ctx.fillStyle = th.tree;
      const ox = net.trunk[v] ? 0 : -5;
      const oy = net.trunk[v] ? 7 : 0;
      ctx.beginPath();
      ctx.moveTo(mx + ox, my + oy - 4);
      ctx.lineTo(mx + ox + 3.5, my + oy + 2.5);
      ctx.lineTo(mx + ox - 3.5, my + oy + 2.5);
      ctx.closePath();
      ctx.fill();
    }
    if (s.lineLeft[v] > 0) {
      ctx.strokeStyle = th.fault;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 3.5, my - 3.5);
      ctx.lineTo(mx + 3.5, my + 3.5);
      ctx.moveTo(mx + 3.5, my - 3.5);
      ctx.lineTo(mx - 3.5, my + 3.5);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // 集落 (丸の大きさ = 家の数)
  for (let v = 1; v < net.n; v++) {
    const r = 1.8 + Math.sqrt(net.homes[v]) * 0.32;
    const on = s.grid[v] || s.genPowered[v];
    ctx.beginPath();
    ctx.arc(net.x[v], net.y[v], r, 0, Math.PI * 2);
    ctx.fillStyle = on ? th.lit : th.bg;
    ctx.fill();
    ctx.strokeStyle = on ? th.lit : th.muted;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (s.genPowered[v]) {
      ctx.strokeStyle = th.gen;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(net.x[v], net.y[v], r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // 変電所
  ctx.fillStyle = th.fg;
  ctx.fillRect(net.x[0] - 5, net.y[0] - 5, 10, 10);
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = th.muted;
  ctx.fillText("変電所", net.x[0] - 6, net.y[0] + 17);

  // 作業班・道路部隊・電源車
  for (const u of s.units) {
    if (s.t < u.fromH) continue;
    const [x, y] = unitXY(s, u);
    // 詰所 (変電所) で待っている班は、少しずつずらして並べる
    const atBase = u.node === 0 && u.path.length === 0;
    const bx = atBase ? x + 2 + (u.id % 6) * 5 : x;
    const by = atBase ? y - 14 - Math.floor(u.id / 6) * 5 : y;
    if (u.kind === "crew") {
      ctx.fillStyle = th.crew;
      ctx.fillRect(bx - 2.5, by - 2.5, 5, 5);
    } else if (u.kind === "road") {
      ctx.fillStyle = th.road;
      ctx.beginPath();
      ctx.moveTo(bx, by - 3.5);
      ctx.lineTo(bx + 3.5, by);
      ctx.lineTo(bx, by + 3.5);
      ctx.lineTo(bx - 3.5, by);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = th.gen;
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 下の帯: 倒れている木の数
  let lines = 0;
  let roads = 0;
  for (let v = 1; v < net.n; v++) {
    lines += s.lineFaults[v];
    roads += s.roadBlocks[v];
  }
  ctx.fillStyle = th.muted;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`いま切れている電線 ${lines} か所・道をふさいでいる倒木 ${roads} か所`, 8, H - 8);
}
