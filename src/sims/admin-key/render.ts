import { CELLS, GRID, SERVERS_PER_CELL, keysStolen, phase, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  reach: string;
  infected: string;
  detect: string;
}

export const CANVAS_W = 340;
export const CANVAS_H = 380;

const CELL = 15;
const GAP = 1;
const LEFT = (CANVAS_W - GRID * CELL) / 2;
const TOP = 54;

const BY_LABEL = { login: "不審なログインの警報", monitor: "見張りが気づいた", customer: "顧客からの問い合わせ", "": "" } as const;

function cellXY(i: number): [number, number] {
  return [LEFT + (i % GRID) * CELL, TOP + Math.floor(i / GRID) * CELL];
}

/**
 * 1 つの方針の世界を 1 枚のキャンバスに描く。
 * 400 マスが顧客サーバー (1 マス ≈ 67 台)。太線が区画の境目 (= 管理者の鍵 1 本が届く範囲)。
 * 黄色は盗まれた鍵が届いている範囲、赤はマルウェアを入れられたサーバー。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 見出し: 日数と状況
  const ph = phase(s);
  const day = Math.floor(s.t / 24);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "700 13px sans-serif";
  ctx.fillStyle = theme.fg;
  ctx.fillText(`${day} 日目`, LEFT, 14);
  ctx.font = "12px sans-serif";
  let status = "";
  let color = theme.muted;
  if (ph === "foothold") status = "顧客サーバー 1 台に侵入。管理者の鍵を探している";
  else if (ph === "prep") status = "管理者の鍵を入手。配る準備をしている";
  else if (ph === "spread") {
    status = "管理サーバーからマルウェアを配っている";
    color = theme.infected;
  } else if (ph === "detected") {
    status = `発覚 (${BY_LABEL[s.detectedBy]})`;
    color = theme.detect;
  } else status = `${s.params.horizonDays} 日たっても気づかない`;
  ctx.fillStyle = color;
  ctx.font = ph === "detected" || ph === "end" ? "700 12px sans-serif" : "12px sans-serif";
  ctx.fillText(status, LEFT + 52, 14);

  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText(`盗まれた管理者の鍵 ${keysStolen(s)} / ${s.k} 本`, LEFT, 36);
  ctx.textAlign = "right";
  ctx.fillText(`1 マス ≈ ${Math.round(SERVERS_PER_CELL)} 台`, LEFT + GRID * CELL, 36);

  // マス
  for (let i = 0; i < CELLS; i++) {
    const [x, y] = cellXY(i);
    const infected = s.infectedAt[i] >= 0;
    const reach = s.keyAt[s.segmentOf[i]] >= 0;
    if (infected) {
      ctx.fillStyle = theme.infected;
      ctx.globalAlpha = 1;
    } else if (reach) {
      ctx.fillStyle = theme.reach;
      ctx.globalAlpha = 0.45;
    } else {
      ctx.fillStyle = theme.grid;
      ctx.globalAlpha = 1;
    }
    ctx.fillRect(x + GAP, y + GAP, CELL - 2 * GAP, CELL - 2 * GAP);
    ctx.globalAlpha = 1;
  }

  // 区画の境目
  if (s.k > 1) {
    ctx.strokeStyle = theme.fg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = cellXY(i);
      const col = i % GRID;
      if (col < GRID - 1 && s.segmentOf[i + 1] !== s.segmentOf[i]) {
        ctx.moveTo(x + CELL, y);
        ctx.lineTo(x + CELL, y + CELL);
      }
      if (i + GRID < CELLS && s.segmentOf[i + GRID] !== s.segmentOf[i]) {
        ctx.moveTo(x, y + CELL);
        ctx.lineTo(x + CELL, y + CELL);
      }
    }
    ctx.stroke();
  }
  // 外枠
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(LEFT + 0.5, TOP + 0.5, GRID * CELL - 1, GRID * CELL - 1);

  // 最初に入り込まれた顧客サーバー
  const [fx, fy] = cellXY(s.foothold);
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 2;
  ctx.strokeRect(fx - 1, fy - 1, CELL + 2, CELL + 2);
  ctx.beginPath();
  ctx.arc(fx + CELL / 2, fy + CELL / 2, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = theme.fg;
  ctx.fill();

  // 下の注記
  ctx.textAlign = "left";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = theme.muted;
  ctx.fillText("□ = 最初に入り込まれた顧客サーバー", LEFT, H - 12);

  if (ph === "detected" || ph === "end") {
    const label = ph === "detected" ? `${(s.detectedAt / 24).toFixed(0)} 日目に発覚。ここで止める` : "まだ誰も気づいていない";
    ctx.font = "700 13px sans-serif";
    const w = ctx.measureText(label).width + 16;
    const cx = W / 2;
    const cy = TOP + (GRID * CELL) / 2;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(cx - w / 2, cy - 14, w, 28);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ph === "detected" ? theme.detect : theme.infected;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - w / 2 + 0.5, cy - 14 + 0.5, w - 1, 27);
    ctx.textAlign = "center";
    ctx.fillStyle = theme.fg;
    ctx.fillText(label, cx, cy);
  }
}
