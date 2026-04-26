const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { logger } = require("firebase-functions");
const crypto = require("crypto");
const { resolveCallableUid } = require("./callableUid");

const REGION = { region: "southamerica-east1" };

const PUBLIC_ID_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PUBLIC_ID_LEN = 7;
const CHARACTER_ID_LEN = 6;

function randomPublicId() {
  const bytes = crypto.randomBytes(PUBLIC_ID_LEN);
  let out = "";
  for (let i = 0; i < PUBLIC_ID_LEN; i++) {
    out += PUBLIC_ID_CHARS[bytes[i] % PUBLIC_ID_CHARS.length];
  }
  return out;
}

function normalizePublicId(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function randomCharacterPublicId() {
  const bytes = crypto.randomBytes(CHARACTER_ID_LEN);
  let out = "";
  for (let i = 0; i < CHARACTER_ID_LEN; i++) {
    out += PUBLIC_ID_CHARS[bytes[i] % PUBLIC_ID_CHARS.length];
  }
  return out;
}

async function loadFriendEdge(db, a, b) {
  const snap = await db.doc(`players/${a}/friends/${b}`).get();
  return snap.exists ? snap.data() : null;
}

/**
 * ID público do personagem fica em `players/{uid}/characters/{cid}.publicId`.
 * Sem `characterPublicIds/{tag}`, resolvemos por collectionGroup.
 * @returns {{ peerUid: string, characterId: string } | null | "dup"}
 */
async function resolvePeerByCharacterDocPublicId(db, tag) {
  let snap = await db.collectionGroup("characters").where("publicId", "==", tag).limit(2).get();
  if (snap.empty && /^\d+$/.test(tag)) {
    snap = await db.collectionGroup("characters").where("publicId", "==", Number(tag)).limit(2).get();
  }
  if (snap.empty) return null;
  if (snap.size > 1) return "dup";
  const parts = snap.docs[0].ref.path.split("/");
  if (parts.length < 4 || parts[0] !== "players" || parts[2] !== "characters") {
    logger.warn("resolvePeerByCharacterDocPublicId_path_inesperado", { path: snap.docs[0].ref.path });
    return null;
  }
  return { peerUid: parts[1], characterId: parts[3] };
}

exports.searchPlayersPublic = onCall(REGION, async (request) => {
  await resolveCallableUid(request);
  throw new HttpsError("failed-precondition", "Busca por nome desativada. Use ID do jogador.");
});

exports.sendFriendRequest = onCall(REGION, async (request) => {
  await resolveCallableUid(request);
  throw new HttpsError("failed-precondition", "Fluxo por nome/pedido desativado. Use adicionar por ID.");
});

exports.respondFriendRequest = onCall(REGION, async (request) => handleRespondFriendRequestCore(request));

async function handleEnsurePlayerPublicIdCore(request) {
  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const hasIdToken = typeof payload.idToken === "string" && payload.idToken.trim().length > 0;
  let me = "";
  try {
    me = await resolveCallableUid(request);
    logger.info("[ensurePlayerPublicId] callable auth", {
      hasAuth: !!request.auth?.uid,
      hasIdToken,
      requestAuthUid: request.auth?.uid || null,
      resolvedUid: me,
    });
    const db = getFirestore();
    const pRef = db.doc(`players/${me}`);
    const snap = await pRef.get();
    const existing = normalizePublicId(snap.data()?.publicId || "");
    if (existing.length >= 6 && existing.length <= 8) {
      const existingMapRef = db.doc(`playerPublicIds/${existing}`);
      const existingMap = await existingMapRef.get();
      if (existingMap.exists && String(existingMap.data()?.uid || "") === me) {
        return { ok: true, publicId: existing };
      }
    }
  
    for (let attempt = 0; attempt < 24; attempt++) {
      const tag = randomPublicId();
      const mapRef = db.doc(`playerPublicIds/${tag}`);
      try {
        await db.runTransaction(async (tx) => {
          const mapSnap = await tx.get(mapRef);
          if (mapSnap.exists) throw new Error("collision");
          const fresh = await tx.get(pRef);
          const already = normalizePublicId(fresh.data()?.publicId || "");
          if (already.length >= 6) {
            return;
          }
          tx.set(mapRef, { uid: me, createdAt: FieldValue.serverTimestamp() }, { merge: true });
          tx.set(pRef, { publicId: tag, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        });
        const check = await pRef.get();
        const pid = normalizePublicId(check.data()?.publicId || "");
        if (pid) return { ok: true, publicId: pid };
      } catch (e) {
        if (String(e?.message || "") === "collision") continue;
        logger.warn("ensurePlayerPublicId_attempt", e?.message || e);
      }
    }

    throw new HttpsError("internal", "Nao foi possivel gerar ID publico. Tente novamente.");
  } catch (err) {
    logger.error("[ensurePlayerPublicId] falha", {
      hasAuth: !!request.auth?.uid,
      hasIdToken,
      requestAuthUid: request.auth?.uid || null,
      resolvedUid: me || null,
      code: err?.code || null,
      message: err?.message || String(err),
    });
    throw err;
  }
}

exports.ensurePlayerPublicId = onCall(REGION, async (request) => handleEnsurePlayerPublicIdCore(request));

exports.ensurePlayerPublicIdHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const authHeader = req.get("authorization") || req.get("Authorization") || "";
    const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
    const idToken = match ? String(match[1] || "").trim() : "";
    if (!idToken) {
      res.status(401).json({ error: "Token ausente." });
      return;
    }
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (err) {
      logger.warn("ensurePlayerPublicIdHttp verifyIdToken", { message: String(err?.message || err) });
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const uid = String(decoded?.uid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : {};
    delete body.idToken;
    const fakeRequest = { auth: { uid, token: decoded }, data: body, rawRequest: req };
    const result = await handleEnsurePlayerPublicIdCore(fakeRequest);
    res.status(200).json(result || { ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("ensurePlayerPublicIdHttp", e);
    res.status(500).json({ error: e?.message || "Erro em ensurePlayerPublicIdHttp." });
  }
});

async function resolvePeerUidFromPublicTag(db, tag) {
  let peerUid = "";
  let repairPlayerPublicIdMap = false;
  let repairCharacterPublicIdMap = null;
  const mapSnap = await db.doc(`playerPublicIds/${tag}`).get();
  if (mapSnap.exists) {
    peerUid = String(mapSnap.data()?.uid || "").trim();
  } else {
    const charMapSnap = await db.doc(`characterPublicIds/${tag}`).get();
    if (charMapSnap.exists) {
      peerUid = String(charMapSnap.data()?.uid || "").trim();
    } else {
      let byField = await db.collection("players").where("publicId", "==", tag).limit(2).get();
      if (byField.empty && /^\d+$/.test(tag)) {
        byField = await db.collection("players").where("publicId", "==", Number(tag)).limit(2).get();
      }
      if (!byField.empty) {
        if (byField.size > 1) {
          logger.warn("resolvePeer_dup_players", { tag });
          throw new HttpsError("failed-precondition", "ID duplicado no servidor. Contacte suporte.");
        }
        peerUid = byField.docs[0].id;
        repairPlayerPublicIdMap = true;
      } else {
        const viaChar = await resolvePeerByCharacterDocPublicId(db, tag);
        if (viaChar === "dup") {
          logger.warn("resolvePeer_dup_characters", { tag });
          throw new HttpsError("failed-precondition", "ID duplicado no servidor. Contacte suporte.");
        }
        if (!viaChar) {
          throw new HttpsError("not-found", "Nenhum jogador encontrado com esse ID.");
        }
        peerUid = viaChar.peerUid;
        repairCharacterPublicIdMap = { characterId: viaChar.characterId };
      }
    }
  }
  return { peerUid, repairPlayerPublicIdMap, repairCharacterPublicIdMap };
}

function officialArtUrl(speciesId) {
  const sid = Math.max(1, Math.floor(Number(speciesId || 0)));
  if (!sid) return null;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${sid}.png`;
}

async function loadOfficialArtUrlsForCharacterTeam(db, ownerUid, characterId) {
  const urls = [];
  for (let slot = 1; slot <= 6; slot += 1) {
    const snap = await db.doc(`players/${ownerUid}/characters/${characterId}/time/slot_${slot}`).get();
    if (!snap.exists) continue;
    const sid = Math.max(1, Math.floor(Number(snap.data()?.speciesId || 0)));
    if (!sid) continue;
    const u = officialArtUrl(sid);
    if (u) urls.push(u);
  }
  return urls.slice(0, 6);
}

async function loadFriendDisplayBundle(db, ownerUid, preferredCharacterId) {
  const pSnap = await db.doc(`players/${ownerUid}`).get();
  const pData = pSnap.exists ? pSnap.data() || {} : {};
  let characterId = String(preferredCharacterId || "").trim();
  if (!characterId) {
    characterId = String(pData.selectedCharacterId || "").trim();
  }
  if (!characterId && pSnap.exists) {
    const charsSnap = await pSnap.ref.collection("characters").limit(1).get();
    characterId = charsSnap.docs[0] ? charsSnap.docs[0].id : "";
  }
  if (!characterId) {
    return {
      characterName: String(pData.nomeJogador || "").trim() || ownerUid.slice(0, 8),
      region: "",
      avatarUrl: null,
      officialArtUrls: [],
    };
  }
  const cSnap = await db.doc(`players/${ownerUid}/characters/${characterId}`).get();
  const cd = cSnap.exists ? cSnap.data() || {} : {};
  const nm = String(cd.name || "").trim() || String(pData.nomeJogador || "").trim() || ownerUid.slice(0, 8);
  const officialArtUrls = await loadOfficialArtUrlsForCharacterTeam(db, ownerUid, characterId);
  return {
    characterName: nm,
    region: String(cd.region || "").trim(),
    avatarUrl: cd.avatarUrl ? String(cd.avatarUrl).trim() : null,
    officialArtUrls,
  };
}

function friendEdgePayload(peerUid, bundle) {
  return {
    peerUid,
    nomeJogador: bundle.characterName,
    peerRegion: bundle.region || null,
    peerAvatarUrl: bundle.avatarUrl || null,
    peerOfficialArtUrls: Array.isArray(bundle.officialArtUrls) ? bundle.officialArtUrls : [],
    since: FieldValue.serverTimestamp(),
    source: "friendRequest",
  };
}

/** Convite por ID público — o destinatário deve aceitar em `respondFriendRequest`. */
async function handleRequestFriendByPublicIdCore(request) {
  const me = await resolveCallableUid(request);
  const tag = normalizePublicId(request.data?.publicId || "");
  if (tag.length < 3 || tag.length > 8) {
    throw new HttpsError("invalid-argument", "ID invalido (use 3 a 8 caracteres).");
  }
  const characterId = String(request.data?.characterId || "").trim();
  if (!characterId) {
    throw new HttpsError("invalid-argument", "characterId obrigatorio (personagem atual).");
  }

  const db = getFirestore();
  const { peerUid, repairPlayerPublicIdMap, repairCharacterPublicIdMap } = await resolvePeerUidFromPublicTag(db, tag);
  if (!peerUid || peerUid === me) throw new HttpsError("invalid-argument", "ID invalido.");
  const peerSnap = await db.doc(`players/${peerUid}`).get();
  if (!peerSnap.exists) throw new HttpsError("not-found", "Jogador nao encontrado para esse ID.");

  if (await loadFriendEdge(db, me, peerUid)) {
    throw new HttpsError("failed-precondition", "Ja sao amigos.");
  }

  const myCharRef = db.doc(`players/${me}/characters/${characterId}`);
  const myCharSnap = await myCharRef.get();
  if (!myCharSnap.exists) {
    throw new HttpsError("not-found", "Personagem nao encontrado para este usuario.");
  }

  const dup = await db
    .collection("friendRequests")
    .where("fromUid", "==", me)
    .where("toUid", "==", peerUid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!dup.empty) {
    throw new HttpsError("failed-precondition", "Voce ja enviou um convite pendente para este jogador.");
  }

  const fromBundle = await loadFriendDisplayBundle(db, me, characterId);

  const requestRef = db.collection("friendRequests").doc();
  const requestId = requestRef.id;

  await db.runTransaction(async (tx) => {
    if (repairPlayerPublicIdMap) {
      tx.set(
        db.doc(`playerPublicIds/${tag}`),
        { uid: peerUid, createdAt: FieldValue.serverTimestamp(), source: "repairedFromPlayerDoc" },
        { merge: true }
      );
    }
    if (repairCharacterPublicIdMap) {
      tx.set(
        db.doc(`characterPublicIds/${tag}`),
        {
          uid: peerUid,
          characterId: repairCharacterPublicIdMap.characterId,
          createdAt: FieldValue.serverTimestamp(),
          source: "repairedFromCharacterDoc",
        },
        { merge: true }
      );
    }
    tx.set(requestRef, {
      fromUid: me,
      toUid: peerUid,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      fromCharacterId: characterId,
      fromCharacterName: fromBundle.characterName,
      fromCharacterAvatar: fromBundle.avatarUrl || null,
      fromRegion: fromBundle.region || null,
    });
  });

  return { ok: true, peerUid, requestId };
}

async function handleRespondFriendRequestCore(request) {
  const me = await resolveCallableUid(request);
  const requestId = String(request.data?.requestId || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId obrigatorio.");
  const accept = !!request.data?.accept;

  const db = getFirestore();
  const ref = db.doc(`friendRequests/${requestId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Pedido nao encontrado.");
  const d = snap.data() || {};
  if (String(d.toUid || "") !== me) {
    throw new HttpsError("permission-denied", "Apenas o destinatario pode responder.");
  }
  if (String(d.status || "") !== "pending") {
    throw new HttpsError("failed-precondition", "Este pedido ja foi respondido.");
  }

  if (!accept) {
    await ref.delete();
    return { ok: true };
  }

  const fromUid = String(d.fromUid || "").trim();
  const toUid = String(d.toUid || "").trim();
  const fromCharacterId = String(d.fromCharacterId || "").trim();

  const bundleFrom = await loadFriendDisplayBundle(db, fromUid, fromCharacterId || null);
  const bundleTo = await loadFriendDisplayBundle(db, toUid, null);

  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists || String(cur.data()?.status || "") !== "pending") {
      throw new HttpsError("failed-precondition", "Pedido invalido ou expirado.");
    }
    tx.delete(ref);
    const edgeFromTo = db.doc(`players/${fromUid}/friends/${toUid}`);
    const edgeToFrom = db.doc(`players/${toUid}/friends/${fromUid}`);
    tx.set(edgeFromTo, friendEdgePayload(toUid, bundleTo), { merge: true });
    tx.set(edgeToFrom, friendEdgePayload(fromUid, bundleFrom), { merge: true });
  });

  return { ok: true };
}

async function handleAddFriendByPublicIdCore(request) {
  return handleRequestFriendByPublicIdCore(request);
}

exports.addFriendByPublicId = onCall(REGION, async (request) => handleAddFriendByPublicIdCore(request));

/** HTTP: mesmo contrato que ensurePlayerPublicIdHttp — Gen2 callable em cloudfunctions.net costuma dar 404 no app. */
exports.addFriendByPublicIdHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const authHeader = req.get("authorization") || req.get("Authorization") || "";
    const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
    const idToken = match ? String(match[1] || "").trim() : "";
    if (!idToken) {
      res.status(401).json({ error: "Token ausente." });
      return;
    }
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (err) {
      logger.warn("addFriendByPublicIdHttp verifyIdToken", { message: String(err?.message || err) });
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const uid = String(decoded?.uid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : {};
    delete body.idToken;
    const fakeRequest = { auth: { uid, token: decoded }, data: body, rawRequest: req };
    const result = await handleAddFriendByPublicIdCore(fakeRequest);
    res.status(200).json(result || { ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("addFriendByPublicIdHttp", e);
    res.status(500).json({ error: e?.message || "Erro em addFriendByPublicIdHttp." });
  }
});

/**
 * Remove amizade (aresta bidirecional) e, opcionalmente, apaga o chat direto.
 * Exige autenticação. Remove `players/{me}/friends/{peer}`, `players/{peer}/friends/{me}`
 * e pedidos pendentes entre os dois (em qualquer direção). Se `clearChat` for true,
 * apaga `directChats/d_{a}_{b}` e suas mensagens/unread como `clearDirectChat`.
 */
async function handleRemoveFriendCore(request) {
  const me = await resolveCallableUid(request);
  const peerUid = String(request.data?.peerUid || "").trim();
  if (!peerUid) throw new HttpsError("invalid-argument", "peerUid obrigatorio.");
  if (peerUid === me) throw new HttpsError("invalid-argument", "peerUid invalido.");
  const clearChat = !!request.data?.clearChat;

  const db = getFirestore();
  const edgeA = db.doc(`players/${me}/friends/${peerUid}`);
  const edgeB = db.doc(`players/${peerUid}/friends/${me}`);

  const [snapA, snapB] = await Promise.all([edgeA.get(), edgeB.get()]);
  if (!snapA.exists && !snapB.exists) {
    throw new HttpsError("not-found", "Esta amizade nao existe.");
  }

  const sorted = [me, peerUid].sort();
  const chatId = `d_${sorted[0]}_${sorted[1]}`;

  const batch = db.batch();
  if (snapA.exists) batch.delete(edgeA);
  if (snapB.exists) batch.delete(edgeB);

  // Limpa pedidos pendentes em qualquer direção entre os dois.
  const [pendingAB, pendingBA] = await Promise.all([
    db
      .collection("friendRequests")
      .where("fromUid", "==", me)
      .where("toUid", "==", peerUid)
      .where("status", "==", "pending")
      .limit(10)
      .get(),
    db
      .collection("friendRequests")
      .where("fromUid", "==", peerUid)
      .where("toUid", "==", me)
      .where("status", "==", "pending")
      .limit(10)
      .get(),
  ]);
  pendingAB.docs.forEach((d) => batch.delete(d.ref));
  pendingBA.docs.forEach((d) => batch.delete(d.ref));

  if (clearChat) {
    const chatRef = db.doc(`directChats/${chatId}`);
    const chatSnap = await chatRef.get();
    if (chatSnap.exists) {
      const msgs = await db.collection(`directChats/${chatId}/messages`).get();
      msgs.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(chatRef);
      batch.delete(db.doc(`players/${me}/socialUnread/${chatId}`));
      batch.delete(db.doc(`players/${peerUid}/socialUnread/${chatId}`));
    }
  }

  await batch.commit();
  return { ok: true, peerUid, chatCleared: clearChat };
}

exports.removeFriend = onCall(REGION, async (request) => handleRemoveFriendCore(request));

exports.removeFriendHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const authHeader = req.get("authorization") || req.get("Authorization") || "";
    const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
    const idToken = match ? String(match[1] || "").trim() : "";
    if (!idToken) {
      res.status(401).json({ error: "Token ausente." });
      return;
    }
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (err) {
      logger.warn("removeFriendHttp verifyIdToken", { message: String(err?.message || err) });
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const uid = String(decoded?.uid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : {};
    delete body.idToken;
    const fakeRequest = { auth: { uid, token: decoded }, data: body, rawRequest: req };
    const result = await handleRemoveFriendCore(fakeRequest);
    res.status(200).json(result || { ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("removeFriendHttp", e);
    res.status(500).json({ error: e?.message || "Erro em removeFriendHttp." });
  }
});

exports.respondFriendRequestHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const authHeader = req.get("authorization") || req.get("Authorization") || "";
    const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
    const idToken = match ? String(match[1] || "").trim() : "";
    if (!idToken) {
      res.status(401).json({ error: "Token ausente." });
      return;
    }
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (err) {
      logger.warn("respondFriendRequestHttp verifyIdToken", { message: String(err?.message || err) });
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const uid = String(decoded?.uid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : {};
    delete body.idToken;
    const fakeRequest = { auth: { uid, token: decoded }, data: body, rawRequest: req };
    const result = await handleRespondFriendRequestCore(fakeRequest);
    res.status(200).json(result || { ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("respondFriendRequestHttp", e);
    res.status(500).json({ error: e?.message || "Erro em respondFriendRequestHttp." });
  }
});

exports.ensureCharacterPublicId = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const characterId = String(request.data?.characterId || "").trim();
  if (!characterId) throw new HttpsError("invalid-argument", "characterId obrigatorio.");
  const requested = normalizePublicId(request.data?.publicId || "");
  if (requested && (requested.length < 3 || requested.length > CHARACTER_ID_LEN)) {
    throw new HttpsError("invalid-argument", "ID do personagem invalido (3 a 6 caracteres).");
  }

  const db = getFirestore();
  const charRef = db.doc(`players/${me}/characters/${characterId}`);
  const charSnap = await charRef.get();
  if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
  const existing = normalizePublicId(charSnap.data()?.publicId || "");
  if (existing && existing.length <= CHARACTER_ID_LEN) {
    return { ok: true, publicId: existing };
  }

  const candidates = requested ? [requested] : [];
  for (let i = 0; i < 24; i++) candidates.push(randomCharacterPublicId());
  for (const candidate of candidates) {
    const mapRef = db.doc(`characterPublicIds/${candidate}`);
    try {
      await db.runTransaction(async (tx) => {
        const [mapDoc, freshChar] = await Promise.all([tx.get(mapRef), tx.get(charRef)]);
        if (mapDoc.exists) throw new Error("collision");
        if (!freshChar.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
        const already = normalizePublicId(freshChar.data()?.publicId || "");
        if (already && already.length <= CHARACTER_ID_LEN) return;
        tx.set(
          mapRef,
          { uid: me, characterId, createdAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        tx.set(
          charRef,
          { publicId: candidate, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      });
      const check = await charRef.get();
      const pid = normalizePublicId(check.data()?.publicId || "");
      if (pid) return { ok: true, publicId: pid };
    } catch (e) {
      if (String(e?.message || "") === "collision") continue;
      logger.warn("ensureCharacterPublicId_attempt", e?.message || e);
    }
  }

  throw new HttpsError("internal", "Nao foi possivel reservar o ID do personagem.");
});

exports.ensureDirectChat = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const peerUid = String(request.data?.peerUid || "").trim();
  if (!peerUid || peerUid === me) throw new HttpsError("invalid-argument", "Contato invalido.");

  const db = getFirestore();
  if (!(await loadFriendEdge(db, me, peerUid))) {
    throw new HttpsError("failed-precondition", "Somente amigos podem abrir conversa.");
  }

  const sorted = [me, peerUid].sort();
  const chatId = `d_${sorted[0]}_${sorted[1]}`;
  const ref = db.doc(`directChats/${chatId}`);
  const snap = await ref.get();
  if (snap.exists) return { ok: true, chatId };

  const [a, b] = await Promise.all([db.doc(`players/${me}`).get(), db.doc(`players/${peerUid}`).get()]);
  await ref.set({
    participantUids: sorted,
    displayNames: {
      [me]: String(a.data()?.nomeJogador || "").trim() || me,
      [peerUid]: String(b.data()?.nomeJogador || "").trim() || peerUid,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessageText: "",
    lastMessageAt: null,
  });
  return { ok: true, chatId };
});

exports.clearDirectChat = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const chatId = String(request.data?.chatId || "").trim();
  if (!chatId) throw new HttpsError("invalid-argument", "chatId obrigatorio.");
  const db = getFirestore();
  const chatRef = db.doc(`directChats/${chatId}`);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) return { ok: true };
  const participants = Array.isArray(chatSnap.data()?.participantUids) ? chatSnap.data().participantUids.map(String) : [];
  if (!participants.includes(me)) throw new HttpsError("permission-denied", "Sem permissao.");
  const msgs = await db.collection(`directChats/${chatId}/messages`).get();
  const batch = db.batch();
  msgs.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(chatRef);
  for (const uid of participants) {
    batch.delete(db.doc(`players/${uid}/socialUnread/${chatId}`));
  }
  await batch.commit();
  return { ok: true };
});

/** Zera badge de mensagens não lidas para este chat (documento removido). */
exports.markDirectChatRead = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const chatId = String(request.data?.chatId || "").trim();
  if (!chatId) throw new HttpsError("invalid-argument", "chatId obrigatorio.");
  const db = getFirestore();
  const ref = db.doc(`players/${me}/socialUnread/${chatId}`);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return { ok: true };
});

exports.__test__ = {
  normalizePublicId,
  randomPublicId,
};
