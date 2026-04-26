/**
 * Smoke test da engine empacotada — executa resolveTurn com inputs sintéticos
 * para garantir que o bundle é funcional e determinístico.
 *
 * Não é um test unitário formal, só valida que a engine carrega e não explode.
 */
const engine = require("./engine.bundle.cjs");

function mon(id, speciesId, name, level, atk, def, spa, spd, spe, hp, moves) {
  return {
    id, speciesId, name, level,
    hpCurrent: hp, hpTotal: hp,
    stats: { hp, atk, def, spa, spd, spe },
    types: ["normal"],
    sprite: { front: null, back: null },
    moves: moves.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type || "normal",
      category: m.category || "physical",
      power: m.power || 40,
      accuracy: m.accuracy || 100,
      pp: m.pp || 15,
      ppMax: m.pp || 15,
      priority: 0,
      critStage: 0,
      effects: [{ kind: "damage", target: "target" }],
    })),
    status: "none",
    statusTurns: 0,
    accuracyStage: 0, evasionStage: 0,
    atkStage: 0, defStage: 0, spaStage: 0, spdStage: 0, speStage: 0,
    friendship: 70,
    volatileStatuses: [],
  };
}

const playerTeam = [
  mon("p1", 25, "Pikachu", 30, 55, 40, 50, 50, 90, 100, [
    { id: "thunder-shock", name: "Thunder Shock", type: "electric", power: 40 },
  ]),
];
const enemyTeam = [
  mon("e1", 133, "Eevee", 30, 55, 50, 45, 65, 55, 100, [
    { id: "tackle", name: "Tackle", type: "normal", power: 40 },
  ]),
];

const fieldState = {
  weather: "none", weatherTurns: 0, trickRoomTurns: 0,
  playerReflectTurns: 0, enemyReflectTurns: 0,
  playerLightScreenTurns: 0, enemyLightScreenTurns: 0,
  playerSpikesLayers: 0, enemySpikesLayers: 0,
  playerStealthRock: false, enemyStealthRock: false,
};

const seed = 12345;
const rng = engine.createSeededRng(seed);

const resolution = engine.resolveTurn({
  playerTeam,
  enemyTeam,
  playerActive: 0,
  enemyActive: 0,
  playerAction: { type: "fight", moveIndex: 0 },
  enemyAction: { type: "fight", moveIndex: 0 },
  canRun: false,
  typeMultiplier: engine.getBattleTypeMultiplier,
  fieldState,
  gymType: null,
  rng,
  lockEnemyAction: true,
});

const hpP = resolution.playerTeam[0].hpCurrent;
const hpE = resolution.enemyTeam[0].hpCurrent;
console.log("[smoke] resolved ok. events:", resolution.events.length, "hp player:", hpP, "hp enemy:", hpE, "result:", resolution.result);
if (resolution.events.length === 0 && hpE === 100 && hpP === 100) {
  console.error("[smoke] FAIL: nothing happened");
  process.exit(1);
}
console.log("[smoke] PASS");
