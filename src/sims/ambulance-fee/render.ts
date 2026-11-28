import { busyUnits, fmtClock, unitPos, type SimState, type UnitState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  red: string;
  amber: string;
  blue: string;
  purple: string;
  green: string;
}

export const CANVAS_W = 360;
export const CANVAS_H = 384;

const HEAD_H = 30;
const MAP_L = 8;
const MAP_R = CANVAS_W - 8;
const MAP_TOP = HEAD_H + 4;
const MAP_MAX_H = 250;
const BARS_TOP = 306;
const BARS_BOTTOM = 366;

function unitColor(st: UnitState, th: RenderTheme): string {
  switch (st) {
    case "toScene":
      return th.red;
    case "onScene":
    case "inquiring":
      return th.amber;
    case "toHospital":
      return th.blue;
    case "handover":
      return th.purple;
    default:
      return th.muted;
  }
}

function sevColor(sev: number, th: RenderTheme): string {
  return sev === 0 ? th.fg : sev === 1 ? th.amber : th.red;
}

/** 1 日分の「具合が悪くなった人」の時間帯ごとの数 (世界ごとに変わらないので覚えておく) */
const hourCache = new WeakMap<SimState, number[]>();
function hourTotals(s: SimState): number[] {
  let b = hourCache.get(s);
  if (!b) {
    b = new Array(24).fill(0);
    for (const p of s.patients) b[Math.min(23, Math.floor(p.tOnset / 3600))]++;
    hourCache.set(s, b);
  }
  return b;
}

/**
 * 1 つの世界を 1 枚のキャンバスに描く。
 * 上: 市の地図。署 (□)、病院 (H と救急外来の空き)、救急車、119 番を待つ人、ためらっている人。
 * 下: 1 時間ごとの 119 番の件数。救急車を呼ばなかった人は枠だけで描く。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, th: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const p = s.params;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  // 地図の縮尺
  const scale = Math.min((MAP_R - MAP_L) / p.widthKm, MAP_MAX_H / p.heightKm);
  const mapW = p.widthKm * scale;
  const mapH = p.heightKm * scale;
  const ox = MAP_L + (MAP_R - MAP_L - mapW) / 2;
  const oy = MAP_TOP + (MAP_MAX_H - mapH) / 2;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;

  // 見出し
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = th.fg;
  ctx.font = "600 20px ui-monospace, monospace";
  ctx.fillText(fmtClock(s.t), MAP_L, 22);
  const busy = busyUnits(s);
  ctx.textAlign = "right";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = s.pending.length > 0 ? th.red : th.muted;
  ctx.fillText(
    `出動中 ${busy} / ${s.units.length} 台` + (s.pending.length > 0 ? `・空きを待つ 119 番 ${s.pending.length}` : ""),
    W - 8,
    20,
  );

  // 地図の枠と 5 km ごとの線
  ctx.fillStyle = th.grid;
  ctx.fillRect(ox, oy, mapW, mapH);
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 5; x < p.widthKm; x += 5) {
    ctx.moveTo(X(x) + 0.5, oy);
    ctx.lineTo(X(x) + 0.5, oy + mapH);
  }
  for (let y = 5; y < p.heightKm; y += 5) {
    ctx.moveTo(ox, Y(y) + 0.5);
    ctx.lineTo(ox + mapW, Y(y) + 0.5);
  }
  ctx.globalAlpha = 0.4;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, mapW - 1, mapH - 1);
  ctx.fillStyle = th.muted;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("1 マス 5 km", ox + 4, oy + mapH - 4);

  // 救急車を呼ばずに済ませた軽症の人 (発症から 40 分だけ薄く表示)
  // ためらって様子を見ている重い人 (119 番まで)
  for (const pt of s.patients) {
    if (pt.tOnset > s.t) continue;
    const x = X(pt.x);
    const y = Y(pt.y);
    if (pt.decision === "self") {
      if (s.t - pt.tOnset > 40 * 60) continue;
      ctx.strokeStyle = th.green;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 3);
      ctx.lineTo(x + 3, y + 3);
      ctx.moveTo(x + 3, y - 3);
      ctx.lineTo(x - 3, y + 3);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      continue;
    }
    if ((pt.decision === "delayed" || pt.decision === "advised") && s.t < pt.tCall) {
      // ためらっている: 中が空いた三角
      ctx.strokeStyle = pt.decision === "delayed" ? th.red : th.amber;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 4.5, y + 3);
      ctx.lineTo(x - 4.5, y + 3);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 1;
      continue;
    }
    if (pt.tCall >= 0 && pt.tCall <= s.t && (pt.tArrive < 0 || pt.tArrive > s.t)) {
      // 119 番をして救急車を待っている
      const waited = s.t - pt.tCall;
      const r = 3 + ((waited / 60) % 3);
      ctx.strokeStyle = sevColor(pt.severity, th);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = sevColor(pt.severity, th);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 病院
  p.hospitals.forEach((h, i) => {
    const x = X(h.x);
    const y = Y(h.y);
    const size = h.large ? 14 : 10;
    ctx.fillStyle = th.bg;
    ctx.strokeStyle = h.large ? th.blue : th.muted;
    ctx.lineWidth = h.large ? 2 : 1;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    ctx.lineWidth = 1;
    ctx.fillStyle = h.large ? th.blue : th.muted;
    ctx.font = `600 ${h.large ? 10 : 8}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("H", x, y + (h.large ? 4 : 3));
    // 救急外来の空き (●が使用中)
    const beds = s.beds[i];
    const pip = 4;
    const startX = x - (beds.length * (pip + 1.5)) / 2;
    beds.forEach((b, k) => {
      const used = b.until > s.t;
      ctx.fillStyle = used ? (h.large ? th.blue : th.muted) : th.bg;
      ctx.strokeStyle = h.large ? th.blue : th.muted;
      ctx.fillRect(startX + k * (pip + 1.5), y + size / 2 + 2, pip, pip);
      ctx.strokeRect(startX + k * (pip + 1.5) + 0.5, y + size / 2 + 2.5, pip - 1, pip - 1);
    });
  });

  // 署
  s.stations.forEach((st) => {
    const x = X(st.x);
    const y = Y(st.y);
    ctx.strokeStyle = th.fg;
    ctx.strokeRect(x - 5.5, y - 5.5, 11, 11);
    ctx.fillStyle = th.muted;
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(st.name, x, y + 15);
  });

  // 救急車
  for (const u of s.units) {
    const pos = unitPos(u, s.t);
    let x = X(pos.x);
    let y = Y(pos.y);
    if (u.state === "idle") {
      // 署の中に並べる
      const mates = s.units.filter((v) => v.station === u.station && v.state === "idle");
      const k = mates.indexOf(u);
      x += (k - (mates.length - 1) / 2) * 3.5;
      y += 0;
    }
    ctx.fillStyle = unitColor(u.state, th);
    ctx.beginPath();
    ctx.arc(x, y, u.state === "idle" ? 2 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (u.state === "inquiring") {
      ctx.strokeStyle = th.amber;
      ctx.beginPath();
      ctx.arc(x, y, 6 + ((s.t / 30) % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 1 時間ごとの 119 番
  const totals = hourTotals(s);
  const called = new Array(24).fill(0);
  const calledSev = new Array(24).fill(0);
  const notCalled = new Array(24).fill(0);
  for (const pt of s.patients) {
    if (pt.tOnset > s.t) continue;
    const hOn = Math.min(23, Math.floor(pt.tOnset / 3600));
    if (pt.decision === "self") {
      notCalled[hOn]++;
      continue;
    }
    if (pt.tCall > s.t) continue;
    const hc = Math.min(23, Math.floor(pt.tCall / 3600));
    if (pt.severity === 0) called[hc]++;
    else calledSev[hc]++;
  }
  const yMax = Math.max(6, Math.ceil(Math.max(...totals) / 2) * 2 + 2);
  const bw = (MAP_R - MAP_L) / 24;
  const yOf = (v: number) => BARS_BOTTOM - (v / yMax) * (BARS_BOTTOM - BARS_TOP);
  ctx.fillStyle = th.muted;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("1 時間ごとの 119 番 (枠だけ = 救急車を使わなかった軽症)", MAP_L, BARS_TOP - 6);
  for (let h = 0; h < 24; h++) {
    const x = MAP_L + h * bw + 0.5;
    const w = bw - 1.5;
    let acc = 0;
    const seg = (v: number, color: string, alpha: number) => {
      if (v <= 0) return;
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, yOf(acc + v), w, yOf(acc) - yOf(acc + v));
      ctx.globalAlpha = 1;
      acc += v;
    };
    seg(calledSev[h], th.red, 0.85);
    seg(called[h], th.muted, 0.6);
    if (notCalled[h] > 0) {
      ctx.strokeStyle = th.green;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(x + 0.5, yOf(acc + notCalled[h]) + 0.5, w - 1, yOf(acc) - yOf(acc + notCalled[h]) - 1);
      ctx.setLineDash([]);
    }
  }
  // 今の時刻
  const xNow = MAP_L + (s.t / 86400) * (MAP_R - MAP_L);
  ctx.strokeStyle = th.fg;
  ctx.beginPath();
  ctx.moveTo(xNow + 0.5, BARS_TOP);
  ctx.lineTo(xNow + 0.5, BARS_BOTTOM);
  ctx.stroke();
  ctx.strokeStyle = th.border;
  ctx.beginPath();
  ctx.moveTo(MAP_L, BARS_BOTTOM + 0.5);
  ctx.lineTo(MAP_R, BARS_BOTTOM + 0.5);
  ctx.stroke();
  ctx.fillStyle = th.muted;
  ctx.textAlign = "center";
  for (const h of [0, 6, 12, 18, 24]) {
    ctx.fillText(`${h}時`, Math.min(MAP_R - 8, Math.max(MAP_L + 8, MAP_L + h * bw)), BARS_BOTTOM + 13);
  }
}
