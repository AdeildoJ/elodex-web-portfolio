const test = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("./friendSocial");

test("normalizePublicId normaliza e remove caracteres invalidos", () => {
  assert.equal(__test__.normalizePublicId(" a-b_c 1*2 "), "ABC12");
});

test("randomPublicId gera 7 chars sem ambiguos", () => {
  const value = __test__.randomPublicId();
  assert.equal(value.length, 7);
  assert.match(value, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/);
});

