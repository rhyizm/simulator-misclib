import { tailPos, type Encounter, type SimState, type Vehicle } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  tunnel: string;
  phone: string;
  glance: string;
  hit: string;
  safe: string;
}

/** 横幅はキャンバスの表示幅に合わせる (スマホでも文字が潰れないように)。高さは固定 */
export const CANVAS_W = 640;
export const CANVAS_H = 180;

const ROAD_TOP = 82;
const ROAD_H = 30;
/** 追突の印を何秒間大きく出すか */
const MARK_SEC = 6;

/**
 * 1 つの世界 (前を見ている / ながらスマホ) の道路を 1 枚のキャンバスに描く。
 * 左から車がやって来て、右に止まった渋滞の列がある。
 */
export function renderSim(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  theme: RenderTheme,
  carColor: string,
  width: number = CANVAS_W,
) {
  const W = width;
  const H = CANVAS_H;
  const narrow = W < 480;
  const MARGIN_L = 12;
  const MARGIN_R = 12;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const p = s.params;
  const L = p.roadLengthM;
  const roadW = W - MARGIN_L - MARGIN_R;
  const pxPerM = roadW / L;
  const x = (m: number) => MARGIN_L + Math.max(0, Math.min(L, m)) * pxPerM;
  const midY = ROAD_TOP + ROAD_H / 2;

  // トンネル
  if (p.tunnel) {
    const [a, b] = p.tunnel;
    ctx.fillStyle = theme.tunnel;
    ctx.fillRect(x(a), ROAD_TOP - 14, x(b) - x(a), ROAD_H + 28);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("トンネル", x(a) + 4, ROAD_TOP - 4);
  }

  // 道路
  ctx.fillStyle = theme.grid;
  ctx.fillRect(MARGIN_L, ROAD_TOP, roadW, ROAD_H);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_L, ROAD_TOP);
  ctx.lineTo(MARGIN_L + roadW, ROAD_TOP);
  ctx.moveTo(MARGIN_L, ROAD_TOP + ROAD_H);
  ctx.lineTo(MARGIN_L + roadW, ROAD_TOP + ROAD_H);
  ctx.stroke();

  // 目盛り
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "center";
  let tick = 100;
  while (tick * pxPerM < 44) tick *= 2;
  for (let m = 0; m <= L + 1e-6; m += tick) {
    ctx.fillRect(x(m) - 0.5, ROAD_TOP + ROAD_H, 1, 4);
    ctx.fillText(`${m}m`, Math.min(W - 18, Math.max(16, x(m))), ROAD_TOP + ROAD_H + 15);
  }

  // 最後尾と、最後尾が見えはじめる範囲
  const tail = tailPos(s);
  const seeFrom = Math.max(0, tail - p.sightM);
  ctx.strokeStyle = theme.safe;
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x(seeFrom), ROAD_TOP - 26);
  ctx.lineTo(x(tail), ROAD_TOP - 26);
  ctx.moveTo(x(seeFrom), ROAD_TOP - 30);
  ctx.lineTo(x(seeFrom), ROAD_TOP - 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.font = "10px sans-serif";
  ctx.fillStyle = theme.safe;
  ctx.textAlign = "left";
  ctx.fillText(`最後尾が見える ${p.sightM}m`, x(seeFrom) + 3, ROAD_TOP - 30);

  // これまでの追突の場所 (道路の下の小さな印)
  for (const e of s.encounters) {
    if (!e.crash) continue;
    ctx.globalAlpha = 0.4 + Math.min(0.6, e.deaths);
    ctx.fillStyle = theme.hit;
    ctx.fillRect(x(e.pos) - 1.5, ROAD_TOP + ROAD_H + 20, 3, 8);
  }
  ctx.globalAlpha = 1;

  // 目を離して走った区間 (いま目を離している車だけ)
  for (const v of s.vehicles) {
    if (v.offFromPos < 0 || v.pos <= v.offFromPos) continue;
    ctx.strokeStyle = v.offIsPhone ? theme.phone : theme.glance;
    ctx.globalAlpha = v.offIsPhone ? 0.9 : 0.5;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x(v.offFromPos), midY - 9);
    ctx.lineTo(x(v.pos), midY - 9);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 車
  for (const v of s.vehicles) {
    if (v.pos - v.len > L) continue;
    drawVehicle(ctx, v, x, midY, pxPerM, theme, carColor);
  }

  // 最近の追突
  for (const e of s.encounters) {
    if (!e.crash) continue;
    const age = s.t - e.t;
    if (age > MARK_SEC + 2) continue;
    drawCrash(ctx, e, x(e.pos), age, theme, W);
  }

  // 見出しの集計
  const crashes = s.encounters.filter((e) => e.crash).length;
  ctx.textAlign = "left";
  ctx.font = "600 12px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(narrow ? `着いた ${s.encounters.length} 台` : `最後尾に着いた ${s.encounters.length} 台`, 12, 20);
  ctx.fillStyle = crashes > 0 ? theme.hit : theme.fg;
  ctx.fillText(`追突 ${crashes} 回`, narrow ? 96 : 160, 20);
  const phoning = s.vehicles.filter((v) => v.offIsPhone && v.offFromPos >= 0).length;
  ctx.textAlign = "right";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = phoning > 0 ? theme.phone : theme.muted;
  ctx.fillText(narrow ? `スマホ中 ${phoning} 台` : `いまスマホを見ている ${phoning} 台`, W - 12, 20);
}

function drawVehicle(
  ctx: CanvasRenderingContext2D,
  v: Vehicle,
  x: (m: number) => number,
  midY: number,
  pxPerM: number,
  theme: RenderTheme,
  color: string,
) {
  const moving = v.state !== "stopped" && v.state !== "crashed" && !v.initial;
  const len = Math.max(moving ? 5 : 2.5, v.len * pxPerM - (moving ? 0 : 0.6));
  const h = v.kind === "truck" ? 12 : 8;
  const front = x(v.pos);
  ctx.fillStyle = v.initial ? theme.muted : color;
  ctx.globalAlpha = v.initial ? 0.55 : 1;
  ctx.fillRect(front - len, midY - h / 2 + 3, len, h);
  ctx.globalAlpha = 1;
  // ブレーキランプ
  if (v.state === "brake" && v.decel > 0) {
    ctx.fillStyle = theme.hit;
    ctx.fillRect(front - len, midY - h / 2 + 3, 1.5, h);
  }
  if (v.state === "crashed") {
    ctx.strokeStyle = theme.hit;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(front - len - 1, midY - h / 2 + 2, len + 2, h + 2);
  }
  if (!moving) return;
  // 前を見ていない車: 頭の上に小さなスマホ (短い目線外しは点)
  if (v.offFromPos >= 0) {
    if (v.offIsPhone) {
      ctx.fillStyle = theme.phone;
      ctx.beginPath();
      ctx.roundRect(front - len / 2 - 3, midY - 26, 6, 10, 1.5);
      ctx.fill();
    } else {
      ctx.fillStyle = theme.glance;
      ctx.beginPath();
      ctx.arc(front - len / 2, midY - 20, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCrash(ctx: CanvasRenderingContext2D, e: Encounter, px: number, age: number, theme: RenderTheme, W: number) {
  const fade = age > MARK_SEC ? Math.max(0, 1 - (age - MARK_SEC) / 2) : 1;
  ctx.globalAlpha = fade;
  const y = ROAD_TOP + ROAD_H / 2 + 3;
  ctx.strokeStyle = theme.hit;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, y, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "700 11px sans-serif";
  ctx.fillStyle = theme.hit;
  const tx = Math.min(W - 60, Math.max(60, px));
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(e.impactKmh)}km/h で追突`, tx, ROAD_TOP + ROAD_H + 44);
  ctx.font = "10px sans-serif";
  const who = e.kind === "truck" ? "トラック" : "乗用車";
  ctx.fillText(`${who}・前を見ていなかった ${e.blind.toFixed(1)} 秒`, tx, ROAD_TOP + ROAD_H + 56);
  ctx.globalAlpha = 1;
}
