# Validação de runtime (app) — checklist

Execute no dispositivo ou emulador Expo. Marque cada item e anexe screenshot ou nota de sessão quando exigir prova visual.

## Batalha

| # | Caso | Procedimento | Evidência esperada |
|---|------|--------------|-------------------|
| B1 | Sprites frente/costas | Iniciar batalha selvagem ou treinador com Pokémon dex alto (≥906) | Front + back carregam sem placeholder quebrado |
| B2 | Intimidate | Trocar Pokémon com Intimidate vs oponente sem Clear Body | Mensagem de Intimidate; −1 Attack |
| B2b | Intimidate vs Clear Body | Mesmo cenário com oponente Clear Body / White Smoke | Mensagem de bloqueio; estágio não cai |
| B3 | Levitate vs Ground | Mold Breaker desligado: Earthquake vs Levitate = imune | Log “sem efeito” ou 0 |
| B3b | Mold Breaker vs Levitate | Atacante com Mold Breaker, mesmo Earthquake | Dano aplica (Ground não anulado) |
| B4 | Pressure | Usar golpe mirando alvo com Pressure | PP consome 2 |
| B5 | Static / Flame Body | Ataque de contato contra alvo com Static ou Flame Body | Chance de paralisar/queimar no atacante |
| B6 | Swift Swim / Chlorophyll | Clima chuva/sol + habilidade correspondente | Ordem de turno reflete speed boost (observar logs) |
| B7 | Blaze / Torrent / Overgrow / Swarm | HP ≤ 1/3, golpe do tipo da habilidade | Dano aumentado (~1.5× na fórmula atual) |

## Explorar

| # | Caso | Procedimento | Evidência |
|---|------|--------------|-----------|
| E1 | Bioma válido | Entrar em rota com `biomeId` configurado | Encontros carregam |
| E2 | Bioma sem config | Rota sem bioma | Feedback claro (mensagem/empty state) |
| E3 | Encontro normal | Caminhar até trigger | Batalha inicia |

## Evolução

| # | Caso | Procedimento | Evidência |
|---|------|--------------|-----------|
| V1 | Burmy / Rockruff / Combee / Salandit | Condições já cobertas pelo motor | Evolução oferecida / executada |
| V2 | Lycanroc Dusk | Rockruff nível ≥25, `own-tempo`, horário UTC 17h–18h | Destino 745 pela regra Dusk |
| V3 | Nincada → Ninjask | Nível ≥20 | Evolui para 291 |
| V4 | Shedinja | — | **Não suportado** no motor atual (sem segunda criação + slot) |

## O que scripts cobrem vs manual

- **Scripts (Node/Firestore):** backfill `stableInstanceId`, auditoria de documentos, bundle do motor de evolução.
- **Manual obrigatório:** sprites em tela, animações, feedback de UI, timing de clima e PP no cliente.

## Registro desta sessão (preencher)

- Data / build:
- Dispositivo:
- Itens validados de verdade:
- Inferido apenas por código / não testado no aparelho:
- Bugs encontrados:
