const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });

const auth = getAuth();
const db = getFirestore();
const mpAccessToken = defineSecret("MP_ACCESS_TOKEN");

function json(res, code, payload) {
  res.status(code).set("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(payload));
}

function readBearer(req) {
  const h = req.get("authorization") || req.get("Authorization") || "";
  const [kind, token] = h.split(" ");
  if (String(kind || "").toLowerCase() !== "bearer" || !token) return null;
  return String(token).trim();
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function mapStatus(mpStatus) {
  const s = String(mpStatus || "").toLowerCase();
  if (s === "approved") return "approved";
  if (["rejected", "cancelled", "cancelled_by_user"].includes(s)) return "canceled";
  if (["in_process", "pending", "authorized"].includes(s)) return "pending";
  return "failed";
}

function methodPaymentRules(method) {
  if (method === "PIX") {
    return {
      excluded_payment_types: [
        { id: "credit_card" },
        { id: "debit_card" },
        { id: "ticket" },
        { id: "atm" },
      ],
    };
  }
  if (method === "CREDIT") {
    return {
      excluded_payment_types: [
        { id: "debit_card" },
        { id: "ticket" },
        { id: "atm" },
        { id: "bank_transfer" },
      ],
    };
  }
  return {
    excluded_payment_types: [
      { id: "credit_card" },
      { id: "ticket" },
      { id: "atm" },
      { id: "bank_transfer" },
    ],
  };
}

async function fetchMpPayment(paymentId) {
  const token = mpAccessToken.value() || process.env.MP_ACCESS_TOKEN || "";
  if (!token) throw new Error("MP_ACCESS_TOKEN nao configurado.");

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Mercado Pago erro ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

exports.paymentsCreateCheckout = onRequest(
  { region: "southamerica-east1", cors: true, secrets: [mpAccessToken] },
  async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "Token ausente." });
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;
    if (!uid) return json(res, 401, { error: "Token invalido." });

    const body = req.body || {};
    const itemId = String(body.itemId || "").trim();
    const characterId = String(body.characterId || "").trim();
    const qty = Math.max(1, Math.floor(n(body.qty, 1)));
    const method = String(body.method || "").toUpperCase();

    if (!itemId || !characterId) return json(res, 400, { error: "itemId e characterId sao obrigatorios." });
    if (!["PIX", "CREDIT", "DEBIT"].includes(method)) return json(res, 400, { error: "Metodo invalido." });

    const mpToken = mpAccessToken.value() || process.env.MP_ACCESS_TOKEN || "";
    if (!mpToken) return json(res, 500, { error: "MP_ACCESS_TOKEN nao configurado." });

    const [charSnap, cfgSnap] = await Promise.all([
      db.doc(`players/${uid}/characters/${characterId}`).get(),
      db.doc(`itemsConfig/${itemId}`).get(),
    ]);

    if (!charSnap.exists) return json(res, 404, { error: "Personagem nao encontrado." });
    if (!cfgSnap.exists) return json(res, 404, { error: "Item nao configurado na loja." });

    const cfg = cfgSnap.data() || {};
    const saleEnabled = Boolean(cfg.saleEnabled);
    const sellMode = String(cfg.sellMode || "game");
    const rawReal = cfg.ecoinPrice ?? cfg.realPrice ?? null;
    const realPrice = rawReal == null ? 0 : Math.max(0, n(rawReal, 0));
    const itemName = String(cfg.itemName || itemId);
    const supportsReal = sellMode === "ecoin" || sellMode === "both" || sellMode === "real";
    if (!saleEnabled || !supportsReal || realPrice <= 0) {
      return json(res, 400, { error: "Item nao disponivel para pagamento online." });
    }

    const orderRef = db.collection(`players/${uid}/characters/${characterId}/paymentOrders`).doc();
    const total = Number((realPrice * qty).toFixed(2));
    await orderRef.set({
      itemId,
      itemName,
      itemKind: String(cfg.category || "") === "pokebola" ? "POKEBALL" : "ITEM",
      itemDescription: String(cfg.descriptionPtBr || cfg.effectPtBr || ""),
      qty,
      method,
      status: "pending",
      unitPrice: realPrice,
      total,
      provider: "mercadopago",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const host = req.get("host");
    const proto = req.get("x-forwarded-proto") || "https";
    const baseUrl = process.env.PAYMENTS_PUBLIC_BASE_URL || `https://${host}`;
    const webhookUrl = `${baseUrl}/api/payments/webhook/mercadopago`;
    const resultUrl = `${baseUrl}/api/payments/result`;

    const payload = {
      items: [
        {
          id: itemId,
          title: itemName,
          quantity: qty,
          currency_id: "BRL",
          unit_price: realPrice,
        },
      ],
      external_reference: orderRef.id,
      notification_url: webhookUrl,
      auto_return: "approved",
      back_urls: {
        success: `${resultUrl}?status=success&orderId=${orderRef.id}`,
        failure: `${resultUrl}?status=failure&orderId=${orderRef.id}`,
        pending: `${resultUrl}?status=pending&orderId=${orderRef.id}`,
      },
      payment_methods: methodPaymentRules(method),
      metadata: {
        orderId: orderRef.id,
        uid,
        characterId,
        itemId,
        qty,
        method,
        proto,
      },
    };

    const prefRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const prefData = await prefRes.json();
    if (!prefRes.ok) {
      await orderRef.set(
        {
          status: "failed",
          providerError: prefData,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      return json(res, 502, { error: "Falha ao criar checkout no Mercado Pago.", details: prefData });
    }

    const checkoutUrl = String(prefData.init_point || prefData.sandbox_init_point || "");
    if (!checkoutUrl) return json(res, 502, { error: "Checkout sem URL retornada." });

    await orderRef.set(
      {
        providerPreferenceId: prefData.id || null,
        checkoutUrl,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return json(res, 200, { ok: true, orderId: orderRef.id, checkoutUrl });
  } catch (e) {
    logger.error("paymentsCreateCheckout", e);
    return json(res, 500, { error: e?.message || "Erro inesperado." });
  }
  }
);

exports.paymentsWebhookMercadoPago = onRequest(
  { region: "southamerica-east1", cors: true, secrets: [mpAccessToken] },
  async (req, res) => {
    try {
      const fromQuery = req.query["data.id"] || req.query.id || req.query.resource;
      const body = req.body || {};
      const bodyId =
        body && body.data && typeof body.data === "object" && body.data.id ? body.data.id : null;
      const paymentId = String(fromQuery || bodyId || "").trim();
      if (!/^\d+$/.test(paymentId)) return json(res, 200, { ok: true, skipped: "no-payment-id" });

      const payment = await fetchMpPayment(paymentId);
      const externalReference = String(payment.external_reference || "");
      if (!externalReference) return json(res, 200, { ok: true, skipped: "no-external-reference" });

      const snap = await db
        .collectionGroup("paymentOrders")
        .where(FieldPath.documentId(), "==", externalReference)
        .limit(1)
        .get();

      if (snap.empty) return json(res, 200, { ok: true, skipped: "order-not-found" });

      const orderRef = snap.docs[0].ref;
      const status = mapStatus(String(payment.status || ""));
      const statusDetail = String(payment.status_detail || "");
      const total = Number(payment.transaction_amount || 0);

      await orderRef.set(
        {
          status,
          providerPaymentId: paymentId,
          providerRawStatus: payment.status || null,
          providerStatusDetail: statusDetail,
          totalPaid: total,
          approvedAt: status === "approved" ? new Date() : null,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return json(res, 200, { ok: true, status });
    } catch (e) {
      logger.error("paymentsWebhookMercadoPago", e);
      return json(res, 500, { ok: false, error: e?.message || "Erro no webhook." });
    }
  }
);

exports.paymentsResult = onRequest({ region: "southamerica-east1", cors: true }, async (req, res) => {
  const status = String(req.query.status || "pending").toLowerCase();
  const orderId = String(req.query.orderId || "");

  const title =
    status === "success"
      ? "Pagamento recebido"
      : status === "failure"
      ? "Pagamento nao concluido"
      : "Pagamento pendente";

  const message =
    status === "success"
      ? "Seu pagamento foi recebido. Volte ao app para atualizar a loja."
      : status === "failure"
      ? "O pagamento foi cancelado ou recusado. Tente novamente."
      : "O gateway ainda esta processando seu pagamento. Volte ao app e aguarde.";

  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; background:#0b1020; color:#fff; margin:0; padding:24px; }
        .card { max-width:560px; margin:40px auto; background:#121a32; border:1px solid rgba(255,255,255,.15); border-radius:14px; padding:18px; }
        h1 { margin:0 0 8px 0; font-size:22px; }
        p { margin:0 0 10px 0; line-height:1.45; color:rgba(255,255,255,.85); }
        code { background:rgba(255,255,255,.1); padding:2px 6px; border-radius:6px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
        ${orderId ? `<p>Pedido: <code>${orderId}</code></p>` : ""}
      </div>
    </body>
  </html>`;

  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
});

function chance(percent) {
  return Math.random() * 100 < Number(percent || 0);
}

function nowMs() {
  return Date.now();
}

exports.thiefResolvePvpLoot = onRequest({ region: "southamerica-east1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "Token ausente." });
    const decoded = await auth.verifyIdToken(token);
    const uid = String(decoded?.uid || "");
    if (!uid) return json(res, 401, { error: "Token invalido." });

    const body = req.body || {};
    const thiefUid = String(body.thiefUid || "").trim();
    const thiefCharacterId = String(body.thiefCharacterId || "").trim();
    const victimUid = String(body.victimUid || "").trim();
    const victimCharacterId = String(body.victimCharacterId || "").trim();

    if (!thiefUid || !thiefCharacterId || !victimUid || !victimCharacterId) {
      return json(res, 400, { error: "Parametros incompletos." });
    }
    if (uid !== thiefUid) return json(res, 403, { error: "Operacao nao autorizada para este usuario." });
    if (thiefUid === victimUid) return json(res, 400, { error: "Roubo contra si mesmo nao permitido." });

    const thiefCharRef = db.doc(`players/${thiefUid}/characters/${thiefCharacterId}`);
    const victimCharRef = db.doc(`players/${victimUid}/characters/${victimCharacterId}`);
    const thiefLogRef = db.collection(`players/${thiefUid}/characters/${thiefCharacterId}/theftLogs`).doc();

    const [thiefCharSnap, victimCharSnap, cooldownSnap] = await Promise.all([
      thiefCharRef.get(),
      victimCharRef.get(),
      db.doc(`players/${thiefUid}/characters/${thiefCharacterId}/thiefMeta/cooldown`).get(),
    ]);
    if (!thiefCharSnap.exists || !victimCharSnap.exists) {
      return json(res, 404, { error: "Personagem nao encontrado." });
    }

    const thiefClass = String(thiefCharSnap.data()?.classType || "TRAINER").toUpperCase();
    if (thiefClass !== "THIEF") return json(res, 403, { error: "Somente classe THIEF pode roubar." });

    const lastTheftAtMs = Number(cooldownSnap.data()?.lastTheftAtMs || 0);
    if (lastTheftAtMs > 0 && nowMs() - lastTheftAtMs < 15 * 60 * 1000) {
      return json(res, 200, { ok: false, message: "Cooldown ativo para novo roubo." });
    }

    const pairRecent = await db
      .collection(`players/${thiefUid}/characters/${thiefCharacterId}/theftLogs`)
      .where("victimUid", "==", victimUid)
      .where("createdAtMs", ">=", nowMs() - 12 * 60 * 60 * 1000)
      .limit(1)
      .get();
    if (!pairRecent.empty) {
      return json(res, 200, { ok: false, message: "Este alvo esta protegido temporariamente contra novo roubo." });
    }

    const lootRoll = Math.random();
    let lootType = "coins";
    if (lootRoll < 0.45) lootType = "item";
    else if (lootRoll < 0.60) lootType = "pokemon";

    if (lootType === "coins") {
      const victimCoins = Math.max(0, Number(victimCharSnap.data()?.pokeCoins || 0));
      const amount = Math.max(0, Math.min(500, Math.floor(victimCoins * 0.1)));
      if (amount <= 0) {
        return json(res, 200, { ok: false, message: "Alvo sem moedas para roubar." });
      }
      await db.runTransaction(async (tx) => {
        const [tSnap, vSnap] = await Promise.all([tx.get(thiefCharRef), tx.get(victimCharRef)]);
        const tCoins = Math.max(0, Number(tSnap.data()?.pokeCoins || 0));
        const vCoins = Math.max(0, Number(vSnap.data()?.pokeCoins || 0));
        const safeAmount = Math.max(0, Math.min(amount, vCoins));
        tx.set(thiefCharRef, { pokeCoins: tCoins + safeAmount, updatedAt: new Date() }, { merge: true });
        tx.set(victimCharRef, { pokeCoins: vCoins - safeAmount, updatedAt: new Date() }, { merge: true });
        tx.set(thiefLogRef, {
          type: "coins",
          amount: safeAmount,
          victimUid,
          victimCharacterId,
          thiefUid,
          thiefCharacterId,
          createdAt: new Date(),
          createdAtMs: nowMs(),
        });
        tx.set(db.doc(`players/${thiefUid}/characters/${thiefCharacterId}/thiefMeta/cooldown`), { lastTheftAtMs: nowMs() }, { merge: true });
      });
      return json(res, 200, { ok: true, lootType: "coins", stolenCoins: amount, message: `Roubo concluido: ${amount} moedas.` });
    }

    if (lootType === "item") {
      const itemsSnap = await db.collection(`players/${victimUid}/characters/${victimCharacterId}/itens`).limit(60).get();
      const candidates = itemsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => Number(row.quantity || 0) > 0 && String(row.id || "").toLowerCase() !== "master-ball");
      if (!candidates.length) {
        return json(res, 200, { ok: false, message: "Alvo sem itens válidos para roubo." });
      }
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      const qty = 1;
      const victimItemRef = db.doc(`players/${victimUid}/characters/${victimCharacterId}/itens/${selected.id}`);
      const thiefItemRef = db.doc(`players/${thiefUid}/characters/${thiefCharacterId}/itens/${selected.id}`);

      await db.runTransaction(async (tx) => {
        const [vItemSnap, tItemSnap] = await Promise.all([tx.get(victimItemRef), tx.get(thiefItemRef)]);
        const vQty = Math.max(0, Number(vItemSnap.data()?.quantity || 0));
        if (vQty <= 0) throw new Error("item-empty");
        const tQty = Math.max(0, Number(tItemSnap.data()?.quantity || 0));
        tx.set(victimItemRef, { ...vItemSnap.data(), quantity: Math.max(0, vQty - qty), updatedAt: new Date() }, { merge: true });
        tx.set(thiefItemRef, { ...vItemSnap.data(), quantity: tQty + qty, updatedAt: new Date() }, { merge: true });
        tx.set(thiefLogRef, {
          type: "item",
          itemId: selected.id,
          quantity: qty,
          victimUid,
          victimCharacterId,
          thiefUid,
          thiefCharacterId,
          createdAt: new Date(),
          createdAtMs: nowMs(),
        });
        tx.set(db.doc(`players/${thiefUid}/characters/${thiefCharacterId}/thiefMeta/cooldown`), { lastTheftAtMs: nowMs() }, { merge: true });
      });
      return json(res, 200, { ok: true, lootType: "item", stolenItemId: selected.id, message: `Roubo concluido: item ${selected.id}.` });
    }

    const [victimBoxSnap, victimTeamSnap] = await Promise.all([
      db.collection(`players/${victimUid}/characters/${victimCharacterId}/box`).limit(80).get(),
      db.collection(`players/${victimUid}/characters/${victimCharacterId}/time`).limit(6).get(),
    ]);
    const boxCandidates = victimBoxSnap.docs.map((d) => ({ id: d.id, ...d.data(), source: "box" }));
    const teamCandidates = victimTeamSnap.docs
      .map((d) => ({ id: d.id, ...d.data(), source: "team" }))
      .filter((m) => Number(m.speciesId || 0) > 0 && !Boolean(m.isStarter));
    const pool = [...boxCandidates, ...teamCandidates];
    if (!pool.length) return json(res, 200, { ok: false, message: "Alvo sem Pokemon elegiveis para roubo." });
    const selected = pool[Math.floor(Math.random() * pool.length)];
    const intercept = chance(40);
    const caseRef = db.collection("stolenPokemonCases").doc();

    await db.runTransaction(async (tx) => {
      const victimRef =
        selected.source === "box"
          ? db.doc(`players/${victimUid}/characters/${victimCharacterId}/box/${selected.id}`)
          : db.doc(`players/${victimUid}/characters/${victimCharacterId}/time/${selected.id}`);
      const thiefBoxRef = db.collection(`players/${thiefUid}/characters/${thiefCharacterId}/box`).doc();
      const vSnap = await tx.get(victimRef);
      if (!vSnap.exists) throw new Error("pokemon-not-found");
      const mon = vSnap.data() || {};
      tx.delete(victimRef);
      if (!intercept) {
        tx.set(thiefBoxRef, { ...mon, updatedAt: new Date(), stolenFromUid: victimUid, stolenFromCharacterId: victimCharacterId });
      }
      tx.set(caseRef, {
        status: intercept ? "pending_police_battle" : "stolen_direct",
        victimUid,
        victimCharacterId,
        thiefUid,
        thiefCharacterId,
        pokemonData: mon,
        createdAt: new Date(),
        createdAtMs: nowMs(),
      });
      tx.set(thiefLogRef, {
        type: "pokemon",
        speciesId: Number(mon.speciesId || 0),
        victimUid,
        victimCharacterId,
        thiefUid,
        thiefCharacterId,
        caseId: caseRef.id,
        intercept,
        createdAt: new Date(),
        createdAtMs: nowMs(),
      });
      tx.set(db.doc(`players/${thiefUid}/characters/${thiefCharacterId}/thiefMeta/cooldown`), { lastTheftAtMs: nowMs() }, { merge: true });
    });

    return json(res, 200, {
      ok: true,
      lootType: "pokemon",
      stolenPokemonSpeciesId: Number(selected.speciesId || 0),
      policeInterceptRequired: intercept,
      caseId: caseRef.id,
      message: intercept
        ? "Pokemon roubado! Interceptacao policial iniciada."
        : "Pokemon roubado com sucesso.",
    });
  } catch (e) {
    logger.error("thiefResolvePvpLoot", e);
    return json(res, 500, { error: e?.message || "Erro ao processar roubo PvP." });
  }
});

exports.thiefResolvePoliceOutcome = onRequest({ region: "southamerica-east1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "Token ausente." });
    const decoded = await auth.verifyIdToken(token);
    const uid = String(decoded?.uid || "");
    if (!uid) return json(res, 401, { error: "Token invalido." });

    const body = req.body || {};
    const caseId = String(body.caseId || "").trim();
    const thiefWon = Boolean(body.thiefWon);
    if (!caseId) return json(res, 400, { error: "caseId obrigatorio." });
    const caseRef = db.doc(`stolenPokemonCases/${caseId}`);
    const caseSnap = await caseRef.get();
    if (!caseSnap.exists) return json(res, 404, { error: "Caso nao encontrado." });
    const row = caseSnap.data() || {};
    if (String(row.thiefUid || "") !== uid) return json(res, 403, { error: "Somente o ladrao do caso pode resolver." });
    if (String(row.status || "") !== "pending_police_battle") return json(res, 400, { error: "Caso ja resolvido." });

    const targetCollection = thiefWon ? "thiefHQStorage" : "policeStationStorage";
    const targetRef = db.collection(targetCollection).doc();
    await db.runTransaction(async (tx) => {
      tx.set(targetRef, {
        caseId,
        ownerUid: row.victimUid,
        ownerCharacterId: row.victimCharacterId,
        thiefUid: row.thiefUid,
        thiefCharacterId: row.thiefCharacterId,
        pokemonData: row.pokemonData || {},
        status: thiefWon ? "at_hq" : "at_police",
        createdAt: new Date(),
      });
      tx.set(caseRef, { status: thiefWon ? "at_hq" : "at_police", resolvedAt: new Date() }, { merge: true });
    });
    return json(res, 200, { ok: true, destination: thiefWon ? "hq" : "police", message: thiefWon ? "Pokemon enviado para sede dos ladroes." : "Pokemon apreendido na delegacia." });
  } catch (e) {
    logger.error("thiefResolvePoliceOutcome", e);
    return json(res, 500, { error: e?.message || "Erro ao resolver desfecho policial." });
  }
});

exports.thiefRecoverFromPolice = onRequest({ region: "southamerica-east1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "Token ausente." });
    const decoded = await auth.verifyIdToken(token);
    const uid = String(decoded?.uid || "");
    if (!uid) return json(res, 401, { error: "Token invalido." });
    const characterId = String(req.body?.characterId || "").trim();
    if (!characterId) return json(res, 400, { error: "characterId obrigatorio." });

    const snap = await db
      .collection("policeStationStorage")
      .where("ownerUid", "==", uid)
      .where("ownerCharacterId", "==", characterId)
      .where("status", "==", "at_police")
      .limit(30)
      .get();
    if (snap.empty) return json(res, 200, { ok: true, recoveredCount: 0, message: "Nenhum Pokemon apreendido para resgate." });

    const batch = db.batch();
    let count = 0;
    snap.forEach((d) => {
      const row = d.data() || {};
      const boxRef = db.collection(`players/${uid}/characters/${characterId}/box`).doc();
      batch.set(boxRef, { ...(row.pokemonData || {}), recoveredFromPolice: true, updatedAt: new Date() }, { merge: true });
      batch.set(d.ref, { status: "recovered", recoveredAt: new Date() }, { merge: true });
      count += 1;
    });
    await batch.commit();
    return json(res, 200, { ok: true, recoveredCount: count, message: `${count} Pokemon recuperado(s) na delegacia.` });
  } catch (e) {
    logger.error("thiefRecoverFromPolice", e);
    return json(res, 500, { error: e?.message || "Erro ao recuperar Pokemon da delegacia." });
  }
});

exports.thiefTransferHqToPolice = onRequest({ region: "southamerica-east1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "Token ausente." });
    const decoded = await auth.verifyIdToken(token);
    const uid = String(decoded?.uid || "");
    if (!uid) return json(res, 401, { error: "Token invalido." });

    const characterId = String(req.body?.characterId || "").trim();
    if (!characterId) return json(res, 400, { error: "characterId obrigatorio." });

    const q = await db.collection("thiefHQStorage").where("status", "==", "at_hq").limit(30).get();
    if (q.empty) return json(res, 200, { ok: true, recoveredCount: 0, message: "Nenhum Pokemon roubado na sede dos ladroes." });
    const batch = db.batch();
    let moved = 0;
    q.forEach((d) => {
      const row = d.data() || {};
      const policeRef = db.collection("policeStationStorage").doc();
      batch.set(policeRef, { ...row, status: "at_police", transferredByUid: uid, transferredAt: new Date() }, { merge: true });
      batch.set(d.ref, { status: "transferred_to_police", transferredAt: new Date() }, { merge: true });
      moved += 1;
    });
    await batch.commit();
    return json(res, 200, { ok: true, recoveredCount: moved, message: `${moved} Pokemon transferido(s) da sede para a delegacia.` });
  } catch (e) {
    logger.error("thiefTransferHqToPolice", e);
    return json(res, 500, { error: e?.message || "Erro ao transferir HQ -> delegacia." });
  }
});

exports.registerBiomeCapture = onRequest({ region: "southamerica-east1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const token = readBearer(req);
    if (!token) return json(res, 401, { error: "Token ausente." });
    const decoded = await auth.verifyIdToken(token);
    const uid = String(decoded?.uid || "");
    if (!uid) return json(res, 401, { error: "Token invalido." });

    const biomeId = String(req.body?.biomeId || "").trim().toLowerCase();
    const speciesId = Math.max(1, Math.trunc(n(req.body?.speciesId, 0)));
    if (!biomeId) return json(res, 400, { error: "biomeId obrigatorio." });
    if (!speciesId) return json(res, 400, { error: "speciesId obrigatorio." });

    const configDocId = `elodex-base_${biomeId}`;
    const ref = db.doc(`biomeEncounterConfig/${configDocId}/individual/${speciesId}`);
    let exhausted = false;
    let remaining = null;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const row = snap.data() || {};
      const captureLimitRaw = row.captureLimit;
      const captureLimit = captureLimitRaw == null ? null : Math.max(0, Math.trunc(n(captureLimitRaw, 0)));
      const currentCaptured = Math.max(0, Math.trunc(n(row.capturedCount, 0)));
      if (captureLimit != null && currentCaptured >= captureLimit) {
        exhausted = true;
        remaining = 0;
        return;
      }
      const nextCaptured = currentCaptured + 1;
      remaining = captureLimit == null ? null : Math.max(0, captureLimit - nextCaptured);
      exhausted = remaining === 0;
      tx.set(
        ref,
        {
          capturedCount: nextCaptured,
          remainingCaptures: remaining,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    });

    return json(res, 200, { ok: true, exhausted, remaining });
  } catch (e) {
    logger.error("registerBiomeCapture", e);
    return json(res, 500, { error: e?.message || "Erro ao registrar captura por bioma." });
  }
});
