/**
 * Verificação técnica reproduzível: fórmula de HP nas functions e módulos de auth.
 * Rodar: cd admin/functions && npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { fullHpForSpeciesAtLevel, calcHpStatAtLevel, starterFullHpFromSpeciesId } = require("./pokemonStatCalc");

test("HP gen3: Bulbasaur (base 45) nível 1 = 11 e nasce cheio", () => {
  const z = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const direct = calcHpStatAtLevel(1, 45, 0, 0);
  assert.equal(direct, 11);
  const h = fullHpForSpeciesAtLevel(1, 1, z, z);
  assert.equal(h.total, 11);
  assert.equal(h.current, h.total);
});

test("HP gen3: Lapras (131) nível 5 nasce cheio e > placeholder 22", () => {
  const z = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const h = starterFullHpFromSpeciesId(131, 5, z, z);
  assert.ok(h.total > 22, `esperado HP real > 22, obteve ${h.total}`);
  assert.equal(h.current, h.total);
});

test("Chocagem nível 1: espécie bebê usa fullHpForSpeciesAtLevel", () => {
  const z = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const h = fullHpForSpeciesAtLevel(172, 1, z, z);
  assert.ok(h.total >= 10);
  assert.equal(h.current, h.total);
});

test("Módulos callableUid e evolve carregam sem erro de sintaxe", () => {
  const { resolveCallableUid } = require("./callableUid");
  assert.equal(typeof resolveCallableUid, "function");
  const evolve = require("./evolvePokemon");
  assert.equal(typeof evolve.evolvePokemon, "function");
});
