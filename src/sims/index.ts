import type { ComponentType } from "react";
import { EscalatorSim } from "./escalator/EscalatorSim";
import { EscalatorArticle } from "./escalator/article";
import { ToiletSim } from "./toilet/ToiletSim";
import { ToiletArticle } from "./toilet/article";

export interface SimModule {
  /** インタラクティブなシミュレーション本体 (client component) */
  Sim: ComponentType;
  /** 前提・考察などの記事本文 (server component) */
  Article: ComponentType;
}

export const simModules: Record<string, SimModule> = {
  escalator: { Sim: EscalatorSim, Article: EscalatorArticle },
  toilet: { Sim: ToiletSim, Article: ToiletArticle },
};
