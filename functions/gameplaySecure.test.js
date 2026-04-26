const test = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("./gameplaySecure");

test("randomHatchSpeciesId respeita pools permitidas", () => {
  const allowed = new Set([172, 447, 175, 147, 443, 246]);
  for (let i = 0; i < 500; i++) {
    const sid = __test__.randomHatchSpeciesId();
    assert.equal(allowed.has(sid), true);
  }
});

test("resolveActiveMoveset retorna no maximo 4 moves", () => {
  const moves = __test__.resolveActiveMoveset(172, 1);
  assert.equal(Array.isArray(moves), true);
  assert.equal(moves.length >= 1, true);
  assert.equal(moves.length <= 4, true);
});

test("buildMovePp retorna PP valido positivo", () => {
  const pp = __test__.buildMovePp(["tackle", "thunder-shock"]);
  assert.equal(Array.isArray(pp), true);
  assert.equal(pp.length, 2);
  assert.equal(pp.every((n) => Number.isFinite(n) && n >= 1), true);
});

