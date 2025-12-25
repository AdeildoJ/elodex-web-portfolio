export type TipoDocumento = "MISSAO" | "EVENTO";
export type Direcionamento = "TREINADOR" | "LADRAO";

/**
 * ✅ Recompensa para MISSÃO (fase)
 * (mantém o que você já vinha usando: Pokemon / Item / Ecoin / Pokecoin)
 */
export type MissionRewardTypes = "POKEMON" | "ITEM" | "ECOIN" | "POKECOIN";

export type MissionRewards = {
  tipos: MissionRewardTypes[];
  pokemon?: { pokemonId: number };
  item?: { itemId: string; quantidade: number };
  ecoin?: { quantidade: number };
  pokecoin?: { quantidade: number };
};

/**
 * ✅ Objetivo de fase da MISSÃO
 * - ITEM: busca item JSON
 * - POKEMON: busca pokemon JSON + ação CAPTURAR/DERROTAR
 * - PVP: número vitórias + permiteRoubo (apenas se direcionamento = LADRAO na UI)
 */
export type PhaseObjective =
  | { tipo: "ITEM"; itemId: string }
  | { tipo: "POKEMON"; pokemonId: number; acao: "CAPTURAR" | "DERROTAR" }
  | { tipo: "PVP"; quantidadeVitorias: number; permiteRoubo: boolean };

export type MissionDialogBalloon = { ordem: number; texto: string };

export type MissionPhase = {
  indice: number;
  objetivo: PhaseObjective;
  recompensas: MissionRewards;
  historia: {
    texto: string;
    npc: { imagemUrl: string };
    dialogos: {
      quantidadeFalas: number;
      quantidadeBaloes: number;
      baloes: MissionDialogBalloon[];
    };
  };
};

export type MissionConfig = {
  fases: MissionPhase[];
};

/**
 * ✅ EVENTO
 * Recompensas de marco do EVENTO (apenas Pokemon/Item/Ecoin)
 */
export type EventReward =
  | { tipo: "POKEMON"; pokemonId: number }
  | { tipo: "ITEM"; itemId: string; quantidade: number }
  | { tipo: "ECOIN"; quantidade: number };

export type EventCaptureMilestone = {
  quantidadeMarco: number;
  premio: EventReward;
};

export type EventCaptureTarget = {
  pokemonId: number;
  quantidadeNecessaria: number;
  marcos: EventCaptureMilestone[];
};

export type EventPvpMilestone = {
  quantidadeVitorias: number;
  premio: EventReward;
};

export type EventConfig =
  | {
      tipoEvento: "CAPTURA";
      dataInicio: string; // YYYY-MM-DD
      dataFim: string; // YYYY-MM-DD
      objetivos: EventCaptureTarget[];
    }
  | {
      tipoEvento: "PVP";
      dataInicio: string; // YYYY-MM-DD
      dataFim: string; // YYYY-MM-DD
      quantidadeVitoriasNecessarias: number;
      marcos: EventPvpMilestone[];
      permiteRoubo: boolean; // UI controla: só LADRAO pode marcar, TREINADOR salva false
    };

export type MissionEventDoc = {
  id?: string;

  // raiz (sempre presente)
  tipo: TipoDocumento; // MISSAO | EVENTO
  titulo: string;
  direcionamento: Direcionamento;
  descricaoGeral: string;
  isActive: boolean;

  // payload por tipo
  missao?: MissionConfig;
  evento?: EventConfig;
};
