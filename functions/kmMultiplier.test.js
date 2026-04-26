const test = require("node:test");
const assert = require("node:assert/strict");

/** Espelha `resolveKmGainMultiplier` (runtime.service.ts) para teste sem TS. */
function multFromEntitlements(active) {
  if (!active?.length) return 1;
  return active.reduce((max, entry) => {
    const direct = Number(entry.benefits?.kmGainMultiplier) || 0;
    const meta = Number(entry.benefits?.metadata?.kmGainMultiplier) || 0;
    const pct = Math.max(0, Number(entry.benefits?.kmBonusPercent) || 0);
    let m = 1;
    if (direct > 0) m = Math.max(m, direct);
    if (meta > 0) m = Math.max(m, meta);
    if (pct > 0) m = Math.max(m, 1 + pct / 100);
    return Math.max(max, m);
  }, 1);
}

test("100% boost => 2x", () => {
  const m = multFromEntitlements([{ benefits: { kmBonusPercent: 100 } }]);
  assert.equal(m, 2);
});

test("50% boost => 1.5x", () => {
  const m = multFromEntitlements([{ benefits: { kmBonusPercent: 50 } }]);
  assert.equal(m, 1.5);
});

test("kmGainMultiplier 2 explícito", () => {
  const m = multFromEntitlements([{ benefits: { kmGainMultiplier: 2 } }]);
  assert.equal(m, 2);
});

test("max entre percent e multiplier", () => {
  const m = multFromEntitlements([{ benefits: { kmBonusPercent: 50, kmGainMultiplier: 3 } }]);
  assert.equal(m, 3);
});

test("perfil activeStoreKmBoost 100% => 2x", () => {
  const now = Date.now();
  const raw = { kmBonusPercent: 100, validUntilMs: now + 60_000 };
  let mult = Math.max(0, Number(raw.kmGainMultiplier ?? 0));
  if (!Number.isFinite(mult) || mult < 1.0001) {
    mult = raw.kmBonusPercent > 0 ? 1 + raw.kmBonusPercent / 100 : 1;
  }
  assert.equal(Math.max(1, mult), 2);
});
