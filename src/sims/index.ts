import type { ComponentType } from "react";
import { EscalatorSim } from "./escalator/EscalatorSim";
import { EscalatorArticle } from "./escalator/article";
import { Speed30Sim } from "./speed30/Speed30Sim";
import { Speed30Article } from "./speed30/article";

export interface SimModule {
  /** インタラクティブなシミュレーション本体 (client component) */
  Sim: ComponentType;
  /** 前提・考察などの記事本文 (server component) */
  Article: ComponentType;
}

export const simModules: Record<string, SimModule> = {
  escalator: { Sim: EscalatorSim, Article: EscalatorArticle },
  speed30: { Sim: Speed30Sim, Article: Speed30Article },
};
