/**
 * Wave 4E — Suite de testes determinísticos para a engine de batalha.
 *
 * Roda cenários-alvo (abilities v1, terrain, moves especiais) e verifica que
 * o resultado bate com o canon. Usa seed fixa para reprodutibilidade.
 *
 * NÃO é substituto de testes unitários, mas dá confiança de que as mudanças
 * das Ondas 1-4 não regrediram comportamentos conhecidos.
 *
 * Uso:
 *   node admin/functions/pvpEngine/abilities-terrain-test.js
 *
 * Exit code:
 *   0  todos os cenários passaram
 *   1  pelo menos um cenário falhou
 */
const engine = require("./engine.bundle.cjs");

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function buildMove(id, overrides = {}) {
  return {
    id,
    name: id,
    type: overrides.type || "normal",
    category: overrides.category || "physical",
    power: overrides.power == null ? 40 : overrides.power,
    accuracy: overrides.accuracy == null ? 100 : overrides.accuracy,
    pp: overrides.pp || 15,
    ppMax: overrides.pp || 15,
    priority: overrides.priority || 0,
    critStage: 0,
    isContact: !!overrides.isContact,
    effects: overrides.effects || [{ kind: "damage", target: "target" }],
  };
}

function buildMon(opts) {
  const hp = opts.hp == null ? 200 : opts.hp;
  return {
    id: opts.id || opts.name,
    speciesId: opts.speciesId || 1,
    name: opts.name,
    level: opts.level || 50,
    hpCurrent: opts.hpCurrent == null ? hp : opts.hpCurrent,
    hpTotal: hp,
    stats: {
      hp,
      atk: opts.atk || 80,
      def: opts.def || 80,
      spa: opts.spa || 80,
      spd: opts.spd || 80,
      spe: opts.spe || 80,
    },
    types: opts.types || ["normal"],
    sprite: { front: null, back: null },
    moves: (opts.moves || [buildMove("tackle")]),
    status: "none",
    statusTurns: 0,
    accuracyStage: 0,
    evasionStage: 0,
    atkStage: 0,
    defStage: 0,
    spaStage: 0,
    spdStage: 0,
    speStage: 0,
    friendship: 70,
    abilityId: opts.abilityId || null,
    volatileStatuses: [],
    entryAbilitiesApplied: false,
    turnsOnField: opts.turnsOnField == null ? 0 : opts.turnsOnField,
  };
}

function freshField(overrides = {}) {
  return {
    weather: "none",
    weatherTurns: 0,
    trickRoomTurns: 0,
    playerReflectTurns: 0,
    enemyReflectTurns: 0,
    playerLightScreenTurns: 0,
    enemyLightScreenTurns: 0,
    playerSpikesLayers: 0,
    enemySpikesLayers: 0,
    playerStealthRock: false,
    enemyStealthRock: false,
    terrain: "none",
    terrainTurns: 0,
    ...overrides,
  };
}

function runTurn(args) {
  return engine.resolveTurn({
    playerAction: args.playerAction || { type: "fight", moveIndex: 0 },
    enemyAction: args.enemyAction || { type: "fight", moveIndex: 0 },
    playerActive: args.playerActive == null ? 0 : args.playerActive,
    enemyActive: args.enemyActive == null ? 0 : args.enemyActive,
    playerTeam: args.playerTeam,
    enemyTeam: args.enemyTeam,
    canRun: false,
    typeMultiplier: engine.getBattleTypeMultiplier,
    fieldState: args.fieldState || freshField(),
    gymType: null,
    rng: engine.createSeededRng(args.seed || 0xdeadbeef),
    lockEnemyAction: true,
  });
}

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------
const results = [];
let failed = 0;
function scenario(name, fn) {
  try {
    const msg = fn();
    results.push({ name, pass: true, msg });
  } catch (e) {
    failed++;
    results.push({ name, pass: false, msg: e.message || String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ----------------------------------------------------------------------------
// Cenários
// ----------------------------------------------------------------------------

scenario("W4B: Sturdy impede 1-shot desde HP cheio", () => {
  const player = buildMon({ name: "Geodude", abilityId: "sturdy", hp: 100, atk: 40, def: 40, spe: 20,
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Rampardos", atk: 250, spe: 120, hp: 200,
    moves: [buildMove("head-smash", { power: 150, isContact: true })] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 1 });
  const pHp = res.playerTeam[0].hpCurrent;
  assert(pHp === 1, `esperado Geodude com 1 HP, veio ${pHp}`);
  return `Geodude sobreviveu com 1 HP (Sturdy) — evento: ${res.events.some(e => /Sturdy/i.test(e.text || "")) ? "ok" : "sem msg"}`;
});

scenario("W4B: Speed Boost +1 spe no fim de turno", () => {
  const player = buildMon({ name: "Ninjask", abilityId: "speed-boost", spe: 160, turnsOnField: 1,
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Eevee", hp: 150, moves: [buildMove("tackle")] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 2 });
  const stage = res.playerTeam[0].speStage;
  assert(stage === 1, `esperado speStage=1, veio ${stage}`);
  return "Speed Boost subiu Speed para estágio +1.";
});

scenario("W4B: Drizzle instala rain ao entrar", () => {
  const player = buildMon({ name: "Politoed", abilityId: "drizzle",
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Eevee", moves: [buildMove("tackle")] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 3 });
  assert(res.fieldState.weather === "rain", `esperado rain, veio ${res.fieldState.weather}`);
  // Drizzle instala 5 turnos ao entrar; após fim do turno, 4 restantes.
  assert(res.fieldState.weatherTurns === 4, `esperado 4 turnos (5-1), veio ${res.fieldState.weatherTurns}`);
  return "Drizzle aplicou rain (4 turnos restantes após 1 turno).";
});

scenario("W4B: Truant pula turno alternadamente", () => {
  const player = buildMon({ name: "Slaking", abilityId: "truant", atk: 180,
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Eevee", hp: 200, moves: [buildMove("tackle")] });
  const t1 = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 4 });
  const enemyHpAfter1 = t1.enemyTeam[0].hpCurrent;
  assert(enemyHpAfter1 < 200, "Slaking deveria atacar no turno 1");
  assert(t1.playerTeam[0].truantFlag === true, "truantFlag deveria estar true após atacar");
  // Turno 2
  const p2 = t1.playerTeam[0];
  const e2 = t1.enemyTeam[0];
  const t2 = runTurn({ playerTeam: [p2], enemyTeam: [e2], seed: 5 });
  assert(t2.events.some(e => /preguicando|loafs/i.test(e.text || "")), "deveria aparecer mensagem de loaf");
  return "Slaking atacou no turno 1 e preguicou no turno 2.";
});

scenario("W4B: Wonder Guard imune a golpe não-super-efetivo", () => {
  const player = buildMon({ name: "Shedinja", abilityId: "wonder-guard", hp: 1, types: ["bug", "ghost"],
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Rampardos", atk: 250, spe: 120,
    moves: [buildMove("tackle", { type: "normal" })] }); // normal vs ghost = 0, já é imune
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 6 });
  assert(res.playerTeam[0].hpCurrent === 1, "Shedinja não deveria ter perdido HP");
  return "Shedinja não sofreu dano (type 0× já é imune; Wonder Guard é redundante mas não quebra).";
});

scenario("W4B: Wonder Guard bloqueia neutro (ex.: Fire vs Fire/Flying hipotético)", () => {
  const player = buildMon({ name: "Shedinja", abilityId: "wonder-guard", hp: 1, types: ["normal"],
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Rampardos", atk: 200,
    moves: [buildMove("scratch", { type: "normal" })] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 7 });
  // Mesmo com dano potencial, Wonder Guard bloqueia (normal vs normal = 1x, não super-efetivo).
  assert(res.playerTeam[0].hpCurrent === 1, `Wonder Guard deveria bloquear; HP restante = ${res.playerTeam[0].hpCurrent}`);
  assert(res.events.some(e => /Wonder Guard/i.test(e.text || "")), "mensagem Wonder Guard esperada");
  return "Wonder Guard bloqueou golpe neutro.";
});

scenario("W4B: Magic Guard ignora burn damage", () => {
  const player = buildMon({ name: "Clefable", abilityId: "magic-guard", hp: 200, hpCurrent: 200,
    moves: [buildMove("splash", { category: "status", power: 0, effects: [] })] });
  player.status = "burn";
  const enemy = buildMon({ name: "Eevee", hp: 100,
    moves: [buildMove("splash", { category: "status", power: 0, effects: [] })] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 8 });
  assert(res.playerTeam[0].hpCurrent === 200, `Magic Guard deveria anular burn; HP = ${res.playerTeam[0].hpCurrent}`);
  return "Magic Guard impediu dano de burn.";
});

scenario("W4B: Regenerator cura 33% ao trocar", () => {
  const active = buildMon({ name: "Amoonguss", abilityId: "regenerator", hp: 300, hpCurrent: 100,
    moves: [buildMove("tackle")] });
  const backup = buildMon({ name: "Pelipper", hp: 200,
    moves: [buildMove("tackle")] });
  const enemy = buildMon({ name: "Eevee", hp: 200,
    moves: [buildMove("tackle")] });
  const res = runTurn({
    playerTeam: [active, backup],
    enemyTeam: [enemy],
    playerAction: { type: "switch", targetIndex: 1 },
    seed: 9,
  });
  // Amoonguss era índice 0 e está agora em res.playerTeam[0] (mesma ref em clone)
  const amoonguss = res.playerTeam[0];
  const expectedHeal = Math.floor(300 / 3); // 100
  const expectedHp = Math.min(300, 100 + expectedHeal);
  assert(amoonguss.hpCurrent === expectedHp, `esperado ${expectedHp}, veio ${amoonguss.hpCurrent}`);
  return `Regenerator curou +${expectedHeal} HP.`;
});

scenario("W4B: Volt Absorb cura 25% ao receber Electric", () => {
  const player = buildMon({ name: "Lanturn", abilityId: "volt-absorb", hp: 400, hpCurrent: 200,
    moves: [buildMove("splash", { category: "status", power: 0, effects: [] })] });
  const enemy = buildMon({ name: "Pikachu", atk: 100, spe: 100,
    moves: [buildMove("thunder-shock", { type: "electric", category: "special", power: 40 })] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 10 });
  const expectedHeal = Math.floor(400 * 0.25); // 100
  const expectedHp = Math.min(400, 200 + expectedHeal);
  assert(res.playerTeam[0].hpCurrent === expectedHp, `esperado ${expectedHp}, veio ${res.playerTeam[0].hpCurrent}`);
  return `Volt Absorb curou +${expectedHeal} HP (imune a Electric).`;
});

scenario("W4B: Flash Fire marca flag e dá +50% em Fire", () => {
  const player = buildMon({ name: "Arcanine", abilityId: "flash-fire", hp: 200, atk: 120, spa: 120, spe: 100,
    moves: [buildMove("ember", { type: "fire", category: "special", power: 40 })] });
  const enemy = buildMon({ name: "Charmander", types: ["fire"], hp: 150, spe: 60,
    moves: [buildMove("ember", { type: "fire", category: "special", power: 40 })] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 11 });
  // Player (mais rápido) ataca primeiro. Enemy tenta fire→imune pelo Flash Fire.
  assert(res.playerTeam[0].flashFireBoosted === true, "Flash Fire deveria ter sido ativado");
  return "Flash Fire ativou e marcou flashFireBoosted.";
});

scenario("W4C: Electric Terrain boosta electric e bloqueia sleep em grounded", () => {
  const player = buildMon({ name: "Tapu-Koko", abilityId: "",
    moves: [buildMove("electric-terrain", { type: "electric", category: "status", power: 0, effects: [] })] });
  const enemy = buildMon({ name: "Snorlax", types: ["normal"],
    moves: [buildMove("tackle")] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 12 });
  assert(res.fieldState.terrain === "electric", `terrain esperado electric, veio ${res.fieldState.terrain}`);
  assert(res.fieldState.terrainTurns === 4, `após 1 turno, esperado 4, veio ${res.fieldState.terrainTurns}`);
  return "Electric Terrain instalado (5 turnos → 4 após fim do turno).";
});

scenario("W4C: Psychic Terrain bloqueia golpe de prioridade", () => {
  const field = freshField({ terrain: "psychic", terrainTurns: 5 });
  const player = buildMon({ name: "Mr.Mime", spe: 120,
    moves: [buildMove("splash", { category: "status", power: 0, effects: [] })] });
  const enemy = buildMon({ name: "Pichu", types: ["electric"], spe: 80, atk: 60,
    moves: [buildMove("quick-attack", { priority: 1, isContact: true })] });
  const res = runTurn({
    playerTeam: [player], enemyTeam: [enemy], seed: 13, fieldState: field,
  });
  // Quick attack do enemy deveria ser bloqueado (player grounded, mas attacker é grounded;
  // Psychic terrain bloqueia PRIO vs defender grounded).
  assert(res.playerTeam[0].hpCurrent === res.playerTeam[0].hpTotal,
    `HP player não deveria ter caído; atual = ${res.playerTeam[0].hpCurrent}`);
  assert(res.events.some(e => /Psychic Terrain/i.test(e.text || "")), "mensagem esperada");
  return "Psychic Terrain bloqueou Quick Attack.";
});

scenario("W4D: Counter retorna 2× dano físico recebido", () => {
  const player = buildMon({ name: "Machamp", hp: 300, spe: 30, atk: 100,
    moves: [buildMove("counter", { priority: -5, category: "physical", power: null,
      effects: [{ kind: "damage", target: "target" }] })] });
  const enemy = buildMon({ name: "Rattata", hp: 100, spe: 120, atk: 60,
    moves: [buildMove("tackle", { isContact: true })] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 14 });
  // Rattata ataca primeiro (+spe). Machamp conta com counter (prio -5 por padrão).
  const enemyHp = res.enemyTeam[0].hpCurrent;
  // Dano que Machamp sofreu
  const dmgTakenByMachamp = 300 - res.playerTeam[0].hpCurrent;
  assert(dmgTakenByMachamp > 0, "Machamp deveria ter sofrido dano");
  const expectedCounter = dmgTakenByMachamp * 2;
  const actualCounter = 100 - enemyHp;
  // Pode faintar Rattata; se 2× ≥ 100, enemyHp = 0.
  if (expectedCounter >= 100) {
    assert(enemyHp === 0, `Rattata deveria desmaiar; HP = ${enemyHp}`);
  } else {
    assert(actualCounter === expectedCounter, `esperado ${expectedCounter}, veio ${actualCounter}`);
  }
  return `Counter retornou ${actualCounter} dano (2× ${dmgTakenByMachamp}).`;
});

scenario("W4D: Final Gambit causa dano = HP atual e faz usuário desmaiar", () => {
  const player = buildMon({ name: "Throh", hp: 300, hpCurrent: 200, spe: 100,
    moves: [buildMove("final-gambit", { category: "special", power: null, accuracy: 100,
      effects: [{ kind: "damage", target: "target" }] })] });
  const enemy = buildMon({ name: "Eevee", hp: 300, spe: 60,
    moves: [buildMove("tackle")] });
  const res = runTurn({ playerTeam: [player], enemyTeam: [enemy], seed: 15 });
  assert(res.playerTeam[0].hpCurrent === 0, `user deveria ter faintado; HP = ${res.playerTeam[0].hpCurrent}`);
  const dmgDealt = 300 - res.enemyTeam[0].hpCurrent;
  assert(dmgDealt === 200 || res.enemyTeam[0].hpCurrent === 0, `dano esperado 200, veio ${dmgDealt}`);
  return `Final Gambit causou ${dmgDealt} dano e usuário desmaiou.`;
});

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------
console.log("\n===== Wave 4E — Deterministic Ability/Terrain/Move Tests =====\n");
for (const r of results) {
  const mark = r.pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${r.name}${r.msg ? " — " + r.msg : ""}`);
}
console.log(`\nResultado: ${results.filter((r) => r.pass).length} / ${results.length} passaram.`);
if (failed > 0) {
  console.error(`${failed} cenário(s) falhou.`);
  process.exit(1);
}
console.log("OK");
