/**
 * Migração segura: corrige apenas nível / EXP dos Pokémon (time + box), alinhado ao app
 * (curvas por espécie, normalização de barra).
 *
 * NÃO altera: speciesId, shiny, IVs, EVs, moves, friendship, inventário do jogador, etc.
 * Quando o NÍVEL muda: recalcula stats + hp (como no jogo) e remove pendingEvolution.
 *
 * Modos:
 *   --mode=full      Redefine nível e EXP (padrão: --reset-level=5, barra zerada).
 *   --mode=cap       Todo Pokémon com level > --cap-level vira o teto, EXP zerada no nível novo.
 *   --mode=clamp     Nível final em [--clamp-min,--clamp-max] (padrão 20–30): abaixo sobe, acima desce, no meio não altera.
 *   --mode=affected  Só documentos com anomalia de EXP (toNext errado, overflow, falta de exp, raw não normaliza).
 *
 * Segurança: sem --execute = dry-run (só relatório JSON, nenhum write).
 *
 * Uso (credenciais: admin/serviceAccountKey.json):
 *   node admin/scripts/migrate-reset-pokemon-exp-progress.mjs --mode=affected
 *   node admin/scripts/migrate-reset-pokemon-exp-progress.mjs --mode=cap --cap-level=30
 *   node admin/scripts/migrate-reset-pokemon-exp-progress.mjs --mode=clamp --clamp-min=20 --clamp-max=30
 *   node admin/scripts/migrate-reset-pokemon-exp-progress.mjs --mode=full --reset-level=5
 *   node admin/scripts/migrate-reset-pokemon-exp-progress.mjs --mode=affected --execute
 *
 * Escopo opcional:
 *   --uid=XXX --character-id=YYY
 *   --out=report.json
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  asInt,
  detectExpAnomaly,
  expToNextForSpeciesAtLevel,
  normalizeExpBarCurrentForSpeciesLevel,
  readExpRawFromDoc,
} from "./lib/expCanonicalSpecies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

function normPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function shouldSkipPath(path) {
  return path.includes("/_meta");
}

function parseArg(name, argv, def = null) {
  const pref = `${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  if (!hit) return def;
  return hit.slice(pref.length);
}

async function fetchCollectionGroupPaged(db, admin, name, pageSize = 300) {
  const out = [];
  let lastDoc = null;
  const cg = db.collectionGroup(name);
  for (;;) {
    let q = cg.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) out.push(d);
    if (snap.size < pageSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return out;
}

function parsePlayerCharacterFromPath(path) {
  const m = path.match(/^players\/([^/]+)\/characters\/([^/]+)\/(box|time)\//);
  if (!m) return null;
  return { uid: m[1], characterId: m[2], sub: m[3] };
}

function pathMatchesScope(path, uidFilter, charFilter) {
  const loc = parsePlayerCharacterFromPath(path);
  if (!loc) return false;
  if (uidFilter && loc.uid !== uidFilter) return false;
  if (charFilter && loc.characterId !== charFilter) return false;
  return true;
}

function buildStatsHpPatch(data, newLevel, pe) {
  const speciesId = Math.max(1, asInt(data.speciesId, 0));
  if (speciesId <= 0) return null;
  const ivs = data.ivs && typeof data.ivs === "object" ? data.ivs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const evs = data.evs && typeof data.evs === "object" ? data.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const base = pe.resolveBaseStats(speciesId);
  const real = base
    ? pe.calcRealStats({
        level: newLevel,
        nature: data.nature || "Docile",
        base,
        ivs,
        evs,
      })
    : null;
  const hpTotal = Math.max(1, Number(real?.hp ?? data.hp?.total ?? 1));
  const patch = {
    hp: { current: hpTotal, total: hpTotal },
  };
  if (real) {
    patch.stats = {
      atk: real.atk,
      def: real.def,
      spa: real.spa,
      spd: real.spd,
      spe: real.spe,
    };
  }
  return patch;
}

function buildExpFields(speciesId, level, current) {
  const sid = Math.max(1, asInt(speciesId, 0));
  const lv = Math.max(1, Math.min(100, asInt(level, 1)));
  const toNext = expToNextForSpeciesAtLevel(sid, lv);
  const cur = Math.max(0, Math.min(toNext - 1, Math.trunc(Number(current) || 0)));
  return {
    exp: { current: cur, toNext },
    expCurrent: cur,
    expToNext: toNext,
  };
}

function planPatchForMode(mode, data, opts, pe) {
  const speciesId = asInt(data.speciesId, 0);
  if (speciesId <= 0) return null;
  const oldLevel = Math.max(1, Math.min(100, asInt(data.level, 1)));

  if (mode === "clamp") {
    const minL = Math.max(1, Math.min(100, asInt(opts.clampMin, 20)));
    const maxL = Math.max(1, Math.min(100, asInt(opts.clampMax, 30)));
    const lo = Math.min(minL, maxL);
    const hi = Math.max(minL, maxL);
    const newLevel = Math.max(lo, Math.min(hi, oldLevel));
    if (newLevel === oldLevel) return null;
    const expFields = buildExpFields(speciesId, newLevel, 0);
    const statsPatch = buildStatsHpPatch(data, newLevel, pe);
    if (!statsPatch) return null;
    return {
      patch: {
        level: newLevel,
        ...expFields,
        ...statsPatch,
        pendingEvolution: null,
      },
      newLevel,
      oldLevel,
      levelChanged: true,
      reasons: ["mode_clamp", `clamped_from_${oldLevel}_to_${newLevel}`, `band_${lo}_${hi}`],
    };
  }

  if (mode === "affected") {
    const det = detectExpAnomaly(data);
    if (!det.affected) return null;
    const { current: rawCur } = readExpRawFromDoc(data);
    const raw = rawCur != null ? rawCur : 0;
    const normalized = normalizeExpBarCurrentForSpeciesLevel(speciesId, oldLevel, raw);
    const expFields = buildExpFields(speciesId, oldLevel, normalized);
    return {
      patch: { ...expFields },
      newLevel: oldLevel,
      oldLevel,
      levelChanged: false,
      reasons: det.reasons,
    };
  }

  if (mode === "full") {
    const newLevel = Math.max(1, Math.min(100, asInt(opts.resetLevel, 5)));
    const expFields = buildExpFields(speciesId, newLevel, 0);
    const statsPatch = buildStatsHpPatch(data, newLevel, pe);
    if (!statsPatch) return null;
    return {
      patch: {
        level: newLevel,
        ...expFields,
        ...statsPatch,
        pendingEvolution: null,
      },
      newLevel,
      oldLevel,
      levelChanged: newLevel !== oldLevel,
      reasons: ["mode_full_reset"],
    };
  }

  if (mode === "cap") {
    const cap = Math.max(1, Math.min(100, asInt(opts.capLevel, 30)));
    if (oldLevel <= cap) return null;
    const newLevel = cap;
    const expFields = buildExpFields(speciesId, newLevel, 0);
    const statsPatch = buildStatsHpPatch(data, newLevel, pe);
    if (!statsPatch) return null;
    return {
      patch: {
        level: newLevel,
        ...expFields,
        ...statsPatch,
        pendingEvolution: null,
      },
      newLevel,
      oldLevel,
      levelChanged: true,
      reasons: ["mode_cap", `capped_from_${oldLevel}_to_${newLevel}`],
    };
  }

  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute");
  const dryRun = !execute;
  const outFile = parseArg("--out", argv, "");
  const mode = parseArg("--mode", argv, "affected");
  const resetLevel = Number(parseArg("--reset-level", argv, "5"));
  const capLevel = Number(parseArg("--cap-level", argv, "30"));
  const clampMin = Number(parseArg("--clamp-min", argv, "20"));
  const clampMax = Number(parseArg("--clamp-max", argv, "30"));
  const uidFilter = parseArg("--uid", argv, "") || null;
  const characterIdFilter = parseArg("--character-id", argv, "") || null;

  if (!["full", "cap", "clamp", "affected"].includes(mode)) {
    console.error(
      JSON.stringify({ ok: false, error: "invalid_mode", mode, allowed: ["full", "cap", "clamp", "affected"] })
    );
    process.exit(2);
  }

  if (!existsSync(keyPath)) {
    console.error(JSON.stringify({ ok: false, error: "missing_service_account", path: keyPath }));
    process.exit(2);
  }

  const pe = require(join(adminRoot, "functions/lib/pokemonEvolution.cjs"));

  const admin = require("firebase-admin");
  const { FieldValue } = require("firebase-admin/firestore");
  if (!admin.apps.length) {
    const sa = JSON.parse(readFileSync(keyPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  const db = admin.firestore();

  const playerMonDocs = [];
  for (const sub of ["box", "time"]) {
    const docs = await fetchCollectionGroupPaged(db, admin, sub);
    for (const d of docs) {
      const path = normPath(d.ref.path);
      if (shouldSkipPath(path)) continue;
      if (!/^players\/[^/]+\/characters\/[^/]+\/(box|time)\//.test(path)) continue;
      if (!pathMatchesScope(path, uidFilter, characterIdFilter)) continue;
      playerMonDocs.push(d);
    }
  }

  const planned = [];
  for (const d of playerMonDocs) {
    const data = d.data() || {};
    const path = normPath(d.ref.path);
    const loc = parsePlayerCharacterFromPath(path);
    if (!loc) continue;

    const plan = planPatchForMode(mode, data, { resetLevel, capLevel, clampMin, clampMax }, pe);
    if (!plan) continue;

    planned.push({
      ref: d.ref,
      path,
      uid: loc.uid,
      characterId: loc.characterId,
      speciesId: asInt(data.speciesId, 0),
      speciesName: String(data.speciesName || data.nickname || `#${data.speciesId}`),
      isShiny: data.isShiny === true,
      isStarter: data.isStarter === true,
      ...plan,
    });
  }

  const report = {
    ok: true,
    dryRun,
    execute,
    mode,
    options: {
      resetLevel: mode === "full" ? Math.max(1, Math.min(100, Math.trunc(resetLevel))) : null,
      capLevel: mode === "cap" ? Math.max(1, Math.min(100, Math.trunc(capLevel))) : null,
      clampMin: mode === "clamp" ? Math.max(1, Math.min(100, Math.trunc(clampMin))) : null,
      clampMax: mode === "clamp" ? Math.max(1, Math.min(100, Math.trunc(clampMax))) : null,
      uidFilter,
      characterIdFilter,
    },
    firestorePaths: "players/{uid}/characters/{characterId}/time/slot_* | .../box/*",
    docsScanned: playerMonDocs.length,
    docsToUpdate: planned.length,
    details: planned.map((p) => ({
      path: p.path,
      uid: p.uid,
      characterId: p.characterId,
      speciesId: p.speciesId,
      speciesName: p.speciesName,
      isShiny: p.isShiny,
      isStarter: p.isStarter,
      oldLevel: p.oldLevel,
      newLevel: p.newLevel,
      levelChanged: p.levelChanged,
      reasons: p.reasons,
      patchKeys: Object.keys(p.patch),
    })),
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    console.error(`Wrote: ${outFile}`);
  }

  if (execute && planned.length) {
    let batch = db.batch();
    let n = 0;
    let batches = 0;
    for (const p of planned) {
      const updatePayload = { ...p.patch, updatedAt: FieldValue.serverTimestamp() };
      batch.update(p.ref, updatePayload);
      n += 1;
      if (n >= 400) {
        await batch.commit();
        batches += 1;
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) {
      await batch.commit();
      batches += 1;
    }
    console.error(JSON.stringify({ ok: true, batchesCommitted: batches, updated: planned.length }, null, 2));
  } else if (!execute) {
    console.error(
      JSON.stringify(
        {
          hint: "Dry-run: nenhum documento foi alterado. Confira docsToUpdate e details. Para aplicar: adicione --execute",
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
