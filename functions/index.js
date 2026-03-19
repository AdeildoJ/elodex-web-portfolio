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

function parseOrderPathCandidate(value) {
  const raw = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return null;
  const parts = raw.split("/");
  if (parts.length === 4 && parts[0] === "players" && parts[2] === "paymentOrders") return raw;
  if (
    parts.length === 6 &&
    parts[0] === "players" &&
    parts[2] === "characters" &&
    parts[4] === "paymentOrders"
  ) {
    return raw;
  }
  return null;
}

function resolvePaymentsBaseUrl(req) {
  const configured = String(process.env.PAYMENTS_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "").trim();
  if (projectId) return `https://${projectId}.web.app`;
  const host = req.get("host");
  return `https://${host}`;
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

function parseMetadataList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const DEFAULT_VIP_PLANS = [
  {
    id: "vip-basic",
    code: "vip-basic",
    name: "VIP Basic",
    description: "Plano de entrada com bonus leves e limites expandidos.",
    price: 6,
    currency: "BRL",
    durationDays: 30,
    status: "active",
    benefits: {
      maxCharacters: 3,
      maxCapturedPokemon: 50,
      maxStorageItems: 50,
      xpBonusPercent: 10,
      moneyBonusPercent: 10,
      weeklyIncubators: 1,
    },
    includedItems: [],
    sortOrder: 1,
  },
  {
    id: "vip-plus",
    code: "vip-plus",
    name: "VIP Plus",
    description: "Plano premium com bonus maiores e pacote configuravel de itens.",
    price: 15,
    currency: "BRL",
    durationDays: 30,
    status: "active",
    benefits: {
      maxCharacters: 3,
      maxCapturedPokemon: 50,
      maxStorageItems: 50,
      xpBonusPercent: 12,
      moneyBonusPercent: 12,
      weeklyIncubators: 1,
    },
    includedItems: [],
    sortOrder: 2,
  },
];

const DEFAULT_MONETIZATION_PRODUCTS = [
  {
    id: "expansion-pack",
    code: "expansion-pack",
    type: "expansion",
    name: "Expansao",
    description: "Produto avulso para expansoes futuras de capacidade.",
    durationDays: null,
    price: 12,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { expansionSlots: 10, metadata: { expansionLabel: "Expansao de storage" } },
    grantType: "entitlement",
    sortOrder: 1,
  },
  {
    id: "weekly-incubator",
    code: "weekly-incubator",
    type: "incubator",
    name: "Incubadora",
    description: "Entrega incubadoras extras para ovos.",
    durationDays: null,
    price: 5,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { incubators: 1 },
    grantType: "entitlement",
    sortOrder: 2,
  },
  {
    id: "biome-ticket",
    code: "biome-ticket",
    type: "biome_ticket",
    name: "Ticket de Bioma",
    description: "Ticket avulso para liberar bioma configuravel no futuro.",
    durationDays: 7,
    price: 8,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { biomeTicketCount: 1, metadata: { biomeId: "", biomeAccessDays: 7 } },
    grantType: "entitlement",
    sortOrder: 3,
  },
  {
    id: "mystery-egg",
    code: "mystery-egg",
    type: "mystery_egg",
    name: "Ovo Misterioso",
    description: "Produto avulso para gerar ovo especial futuramente.",
    durationDays: null,
    price: 10,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: {
      mysteryEggCount: 1,
      metadata: {
        babySpeciesIds: "172,173,174,175,236,238,239,240,298,360,406,433,438,439,440,446,447,458",
        pseudoLegendarySpeciesIds: "147,246,280,371,443,610,633,704,782,885",
        pseudoLegendaryChancePercent: 5,
      },
    },
    grantType: "entitlement",
    sortOrder: 4,
  },
  {
    id: "iv-reset",
    code: "iv-reset",
    type: "iv_reset",
    name: "Reset IV",
    description: "Consumivel para reset de IV em fluxo futuro.",
    durationDays: null,
    price: 9,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { ivResetCount: 1 },
    grantType: "entitlement",
    sortOrder: 5,
  },
  {
    id: "trainer-license",
    code: "trainer-license",
    type: "trainer_license",
    name: "Licenca de Treinador",
    description: "Licenca temporaria preparada para regras futuras.",
    durationDays: 7,
    price: 14,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: {
      trainerLicenseDays: 7,
      metadata: {
        xpBonusPercent: 5,
        shinyBonusPercent: 0.5,
        biomeAccessIds: "",
      },
    },
    grantType: "entitlement",
    sortOrder: 6,
  },
  {
    id: "battle-castle-ticket",
    code: "battle-castle-ticket",
    type: "battle_castle_ticket",
    name: "Ticket do Castelo da Batalha",
    description: "Base pronta para acesso ao castelo em etapa futura.",
    durationDays: null,
    price: 11,
    currency: "BRL",
    status: "inactive",
    storeVisible: false,
    benefits: { battleCastleTicketCount: 1 },
    grantType: "entitlement",
    sortOrder: 7,
  },
  {
    id: "gym-ticket",
    code: "gym-ticket",
    type: "gym_ticket",
    name: "Ticket de GYM",
    description: "Libera a criacao permanente de um GYM standalone via enfermeira.",
    durationDays: null,
    price: 20,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymTicketCount: 1, metadata: { sourceType: "standalone", storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 7,
  },
  {
    id: "gym-police-npc",
    code: "gym-police-npc",
    type: "gym_police_npc",
    name: "NPC Policial",
    description: "Ativa o policial do GYM standalone.",
    durationDays: null,
    price: 12,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymPoliceUnlock: true, metadata: { storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 8,
  },
  {
    id: "gym-extra-npc",
    code: "gym-extra-npc",
    type: "gym_extra_npc",
    name: "NPC Adicional",
    description: "Adiciona um NPC extra ao GYM.",
    durationDays: null,
    price: 8,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymAdditionalNpcCount: 1, metadata: { storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 9,
  },
  {
    id: "gym-extra-badges",
    code: "gym-extra-badges",
    type: "gym_badges",
    name: "Insignias Extras",
    description: "Entrega insignias extras para o seu GYM.",
    durationDays: null,
    price: 6,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymBadgeCount: 5, metadata: { storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 10,
  },
  {
    id: "gym-type-egg",
    code: "gym-type-egg",
    type: "gym_type_egg",
    name: "Ovo do Tipo do GYM",
    description: "Gera um ovo do tipo principal do seu GYM.",
    durationDays: null,
    price: 9,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymTypeEggCount: 1, metadata: { storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 11,
  },
  {
    id: "gym-storage-upgrade",
    code: "gym-storage-upgrade",
    type: "gym_storage_upgrade",
    name: "Storage do GYM",
    description: "Aumenta a capacidade do storage do GYM.",
    durationDays: null,
    price: 10,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymStorageSlots: 10, metadata: { storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 12,
  },
  {
    id: "gym-main-team-slot",
    code: "gym-main-team-slot",
    type: "gym_main_team_slot",
    name: "Slot do Time Principal",
    description: "Adiciona um slot ao time principal do GYM ate o maximo de 6.",
    durationDays: null,
    price: 11,
    currency: "BRL",
    status: "inactive",
    storeVisible: true,
    benefits: { gymMainTeamSlots: 1, metadata: { storeCategory: "gym" } },
    grantType: "entitlement",
    sortOrder: 13,
  },
  {
    id: "exclusive-event-ticket",
    code: "exclusive-event-ticket",
    type: "exclusive_event_ticket",
    name: "Ticket de Evento Exclusivo",
    description: "Ingresso base para eventos pagos futuros.",
    durationDays: null,
    price: 13,
    currency: "BRL",
    status: "inactive",
    storeVisible: false,
    benefits: { exclusiveEventTicketCount: 1 },
    grantType: "entitlement",
    sortOrder: 14,
  },
];

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
  return undefined;
}

function fallbackPayerEmail(uid, decodedEmail) {
  const email = String(decodedEmail || "").trim().toLowerCase();
  if (email && email.includes("@")) return email;
  return `${String(uid || "jogador").trim() || "jogador"}@elodex.app`;
}

async function resolveVipPlan(planIdOrCode, planName) {
  const rawName = String(planName || "").trim();
  const normalizedName = rawName.toLowerCase();
  const normalized = String(planIdOrCode || "").trim().toLowerCase();

  if (normalized) {
    const directSnap = await db.doc(`vipPlans/${normalized}`).get();
    if (directSnap.exists) return { id: directSnap.id, ...directSnap.data() };

    const byCode = await db.collection("vipPlans").where("code", "==", normalized).limit(1).get();
    if (!byCode.empty) return { id: byCode.docs[0].id, ...byCode.docs[0].data() };
  }

  if (rawName) {
    const byName = await db.collection("vipPlans").where("name", "==", rawName).limit(1).get();
    if (!byName.empty) return { id: byName.docs[0].id, ...byName.docs[0].data() };
  }

  return (
    DEFAULT_VIP_PLANS.find(
      (plan) =>
        plan.id === normalized ||
        plan.code === normalized ||
        (normalizedName && String(plan.name || "").trim().toLowerCase() === normalizedName)
    ) || null
  );
}

async function resolveMonetizationProduct(productIdOrCode) {
  const normalized = String(productIdOrCode || "").trim().toLowerCase();
  if (!normalized) return null;

  const directSnap = await db.doc(`monetizationProducts/${normalized}`).get();
  if (directSnap.exists) return { id: directSnap.id, ...directSnap.data() };

  const byCode = await db.collection("monetizationProducts").where("code", "==", normalized).limit(1).get();
  if (!byCode.empty) return { id: byCode.docs[0].id, ...byCode.docs[0].data() };

  return (
    DEFAULT_MONETIZATION_PRODUCTS.find(
      (product) => product.id === normalized || product.code === normalized
    ) || null
  );
}

function resolveProductDeliveryScope(productType, explicitScope) {
  const explicit = String(explicitScope || "").trim().toLowerCase();
  if (explicit === "account") return "account";
  if (explicit === "character_backpack" || explicit === "character") return "character_backpack";
  const normalized = String(productType || "").trim().toLowerCase();
  if (["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg"].includes(normalized)) {
    return "character_backpack";
  }
  return "account";
}

function isGymCharacterSlotProduct(product) {
  const productType = String(product?.type || "").trim().toLowerCase();
  const slotScope = String(product?.benefits?.metadata?.slotScope || "").trim().toLowerCase();
  const productCode = String(product?.code || "").trim().toLowerCase();
  const productId = String(product?.id || "").trim().toLowerCase();
  const productName = String(product?.name || "").trim().toLowerCase();
  const gymMainTeamSlots = Number(product?.benefits?.gymMainTeamSlots || 0);
  const gymDefenseSlotsAdded = Number(product?.benefits?.gymDefenseSlotsAdded || 0);
  const storeCategory = String(product?.benefits?.metadata?.storeCategory || "").trim().toLowerCase();
  return productType === "gym_main_team_slot" ||
    (productType === "slot" && slotScope === "gym") ||
    productCode === "gym-main-team-slot" ||
    productId === "gym-main-team-slot" ||
    productCode === "slot-de-defesa" ||
    productId === "slot-de-defesa" ||
    ((gymMainTeamSlots > 0 || gymDefenseSlotsAdded > 0) &&
      (storeCategory === "gym" ||
        productType.includes("gym") ||
        productCode.includes("gym-main-team-slot") ||
        productId.includes("gym-main-team-slot") ||
        productCode.includes("slot-de-defesa") ||
        productId.includes("slot-de-defesa") ||
        productName.includes("slot de defesa") ||
        productName.includes("slot do time principal")));
}

function isCharacterDeliveredMonetizedProduct(product) {
  if (isGymCharacterSlotProduct(product)) return true;
  const productType = String(product?.type || "").trim().toLowerCase();
  const ticketSubtype = String(
    product?.benefits?.metadata?.ticketSubtype || product?.benefits?.metadata?.ticketType || ""
  )
    .trim()
    .toLowerCase();
  return ["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg"].includes(productType) ||
    (productType === "ticket" && ticketSubtype === "biome");
}

function deterministicGrantId(parts) {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("__")
    .slice(0, 180);
}

async function grantVipIncludedRewards({ tx, uid, playerRef, includedItems, orderId, planId, planCode }) {
  const rows = Array.isArray(includedItems) ? includedItems : [];
  if (!rows.length) return;
  const playerSnap = await tx.get(playerRef);
  let nextEcoinBalance = Math.max(0, Number(playerSnap.data()?.ecoinBalance || 0));

  for (const item of rows) {
    const source = String(item?.source || "").trim().toLowerCase();
    const qty = Math.max(1, Math.floor(n(item?.quantity, 1)));
    if (source === "ecoin_package") {
      const pkg = await resolveEcoinPackage(String(item?.refId || item?.refCode || ""));
      if (!pkg) continue;
      nextEcoinBalance += Math.max(0, Number(pkg.amount || 0)) * qty;
      continue;
    }
    if (source === "item_config") {
      const rewardId = deterministicGrantId(["vip", orderId, String(item?.refId || item?.id || "item"), String(qty)]);
      tx.set(
        db.doc(`players/${uid}/accountBackpack/${rewardId}`),
        {
          name: String(item?.name || item?.refId || "Item VIP"),
          rewardType: "item_config",
          deliveryScope: "character_backpack",
          source: "vip_subscription",
          status: "pending",
          quantity: qty,
          itemConfigId: String(item?.refId || "").trim().toLowerCase(),
          sourceOrderId: orderId,
          sourcePlanId: planId,
          sourcePlanCode: planCode || null,
          idempotencyKey: rewardId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      continue;
    }
    if (source !== "monetization_product") continue;
    const product = await resolveMonetizationProduct(String(item?.refId || item?.refCode || ""));
    if (!product) continue;
    const deliveryScope =
      String(item?.deliveryScope || "").trim()
        ? resolveProductDeliveryScope(product.type, item.deliveryScope)
        : isCharacterDeliveredMonetizedProduct(product)
        ? "character_backpack"
        : resolveProductDeliveryScope(product.type);
    if (deliveryScope === "character_backpack") {
      const rewardId = deterministicGrantId(["vip", orderId, String(product.id || item?.refId || "product"), String(qty)]);
      tx.set(
        db.doc(`players/${uid}/accountBackpack/${rewardId}`),
        {
          name: String(product.name || item?.name || "Produto VIP"),
          rewardType: "monetization_product",
          deliveryScope,
          source: "vip_subscription",
          status: "pending",
          quantity: qty,
          productId: String(product.id || item?.refId || ""),
          productCode: String(product.code || item?.refCode || "") || null,
          productType: String(product.type || "product"),
          benefits: product.benefits || null,
          sourceOrderId: orderId,
          sourcePlanId: planId,
          sourcePlanCode: planCode || null,
          sourceProductId: String(product.id || "") || null,
          sourceProductCode: String(product.code || "") || null,
          idempotencyKey: rewardId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      continue;
    }
    const entitlementId = deterministicGrantId(["vip", orderId, String(product.id || item?.refId || "product")]);
    tx.set(
      db.doc(`players/${uid}/productEntitlements/${entitlementId}`),
      {
        entitlementId,
        productId: String(product.id || item?.refId || ""),
        productCode: String(product.code || item?.refCode || "") || null,
        productType: String(product.type || "product"),
        productName: String(product.name || item?.name || "Produto VIP"),
        benefits: product.benefits || null,
        quantity: qty,
        status: "active",
        source: "vip_subscription",
        orderId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  }

  tx.set(playerRef, { ecoinBalance: nextEcoinBalance, updatedAt: new Date() }, { merge: true });
}

function grantProductReward({ tx, uid, playerRef, source, orderId, product, qty, validUntilMs, characterId }) {
  const quantity = Math.max(1, Math.floor(n(qty, 1)));
  const deliveryScope = isGymCharacterSlotProduct(product)
    ? "character_backpack"
    : isCharacterDeliveredMonetizedProduct(product)
    ? "character_backpack"
    : resolveProductDeliveryScope(product?.type, product?.deliveryScope);
  if (deliveryScope === "character_backpack" && !characterId) {
    const rewardId = deterministicGrantId([source, orderId, String(product?.id || "product"), String(quantity)]);
    tx.set(
      db.doc(`players/${uid}/accountBackpack/${rewardId}`),
      {
        name: String(product?.name || "Produto"),
        rewardType: "monetization_product",
        deliveryScope,
        source,
        status: "pending",
        quantity,
        productId: String(product?.id || ""),
        productCode: String(product?.code || "") || null,
        productType: String(product?.type || "product"),
        benefits: product?.benefits || null,
        sourceOrderId: orderId,
        sourceProductId: String(product?.id || "") || null,
        sourceProductCode: String(product?.code || "") || null,
        idempotencyKey: rewardId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
    return;
  }
  const entitlementId = deterministicGrantId([source, orderId, String(product?.id || "product")]);
  tx.set(
    db.doc(`players/${uid}/productEntitlements/${entitlementId}`),
    {
      entitlementId,
      productId: String(product?.id || ""),
      productCode: String(product?.code || "") || null,
      productType: String(product?.type || "product"),
      productName: String(product?.name || "Produto"),
      benefits: product?.benefits || null,
      quantity,
      status: "active",
      source,
      orderId,
      deliveryScope,
      consumedByCharacterId: characterId || null,
      validUntil: validUntilMs ? new Date(validUntilMs) : null,
      validUntilMs: validUntilMs || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

// packages of ecoin can be defined in firestore under `ecoinPackages`
// each document should contain { price, currency, amount, status }
// this resolver mirrors the monetization/product resolver with a simple fallback list
async function resolveEcoinPackage(packageIdOrCode) {
  const normalized = String(packageIdOrCode || "").trim().toLowerCase();
  if (!normalized) return null;

  const directSnap = await db.doc(`ecoinPackages/${normalized}`).get();
  if (directSnap.exists) return { id: directSnap.id, ...directSnap.data() };

  const byCode = await db.collection("ecoinPackages").where("code", "==", normalized).limit(1).get();
  if (!byCode.empty) return { id: byCode.docs[0].id, ...byCode.docs[0].data() };

  // no default list defined for ecoin packages – return null if not found
  return null;
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

async function fetchMpPaymentByOrderId(orderId) {
  const token = mpAccessToken.value() || process.env.MP_ACCESS_TOKEN || "";
  if (!token) throw new Error("MP_ACCESS_TOKEN nao configurado.");

  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc&limit=1`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Mercado Pago search erro ${res.status}: ${JSON.stringify(data)}`);
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.length ? results[0] : null;
}

function extractNumericPaymentId(candidate) {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/payments\/(\d+)/i) || raw.match(/\/(\d+)(?:\?.*)?$/);
  return match?.[1] || null;
}

async function findOrderRefById(orderId) {
  const snap = await db
    .collectionGroup("paymentOrders")
    .where("orderId", "==", orderId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].ref;
}

async function resolveOrderRef({ orderId, orderPath }) {
  const parsedPath = parseOrderPathCandidate(orderPath);
  if (parsedPath) return db.doc(parsedPath);
  return findOrderRefById(orderId);
}

async function applyApprovedOrderSideEffects(orderRef) {
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return;
  const orderData = orderSnap.data() || {};
  if (orderData.deliveredAt) return;
  const grantType = String(orderData.grantType || "");

  // ecoin purchase needs to credit player balance and record history
  if (grantType === "ecoin_purchase") {
    const playerUid = String(orderData.uid || "");
    const amount = Math.max(0, Number(orderData.ecoinAmount || 0));
    const playerRef = db.doc(`players/${playerUid}`);
    const historyRef = db.collection(`players/${playerUid}/monetizationHistory`).doc();
    await db.runTransaction(async (tx) => {
      const playerSnap = await tx.get(playerRef);
      const prev = playerSnap.exists ? Math.max(0, Number(playerSnap.data()?.ecoinBalance || 0)) : 0;
      tx.set(playerRef, { ecoinBalance: prev + amount, updatedAt: new Date() }, { merge: true });
      tx.set(historyRef, {
        type: "ecoin_purchase",
        source: "mercadopago",
        status: "active",
        itemId: String(orderData.ecoinPackageId || ""),
        itemType: "ecoin",
        itemName: String(orderData.itemName || ""),
        amountPaid: Math.max(0, Number(orderData.totalPaid || orderData.total || 0)),
        currency: String(orderData.currency || "BRL"),
        orderId: String(orderData.orderId || orderRef.id),
        ecoinAmount: amount,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      tx.set(orderRef, { deliveredAt: new Date(), updatedAt: new Date() }, { merge: true });
    });
    return;
  }

  if (!["vip_subscription", "product_entitlement"].includes(grantType)) return;

  if (grantType === "vip_subscription") {
    const playerUid = String(orderData.uid || "");
    const vipDays = Math.max(1, Math.floor(n(orderData.vipDays, 30)));
    const qty = Math.max(1, Math.floor(n(orderData.qty, 1)));
    const playerRef = db.doc(`players/${playerUid}`);
    const historyRef = db.collection(`players/${playerUid}/monetizationHistory`).doc();
    const startedAtMs = Date.now();

    await db.runTransaction(async (tx) => {
      const [playerSnap, freshOrderSnap] = await Promise.all([tx.get(playerRef), tx.get(orderRef)]);
      const freshOrder = freshOrderSnap.data() || {};
      if (freshOrder.deliveredAt) return;
      const prevExpires = playerSnap.exists ? n(playerSnap.data()?.vipExpiresAtMs, 0) : 0;
      const baseMs = Math.max(startedAtMs, prevExpires);
      const vipExpiresAtMs = baseMs + vipDays * qty * 24 * 60 * 60 * 1000;
      const vipPlanId = String(freshOrder.vipPlanId || freshOrder.offerId || freshOrder.itemId || "");
      const vipPlanCode = String(freshOrder.vipPlanCode || freshOrder.offerId || vipPlanId || "");
      const vipPlanName = String(freshOrder.itemName || "VIP");
      const vipBenefits = freshOrder.vipBenefits || null;
      const vipIncludedItems = Array.isArray(freshOrder.vipIncludedItems) ? freshOrder.vipIncludedItems : [];

      tx.set(
        playerRef,
        {
          playerType: "VIP",
          vipStatus: "active",
          vipPlanId,
          vipPlanCode,
          vipPlanName,
          vipBenefits,
          vipExpiresAt: new Date(vipExpiresAtMs),
          vipExpiresAtMs,
          vipSubscription: {
            planId: vipPlanId,
            planCode: vipPlanCode,
            planName: vipPlanName,
            status: "active",
            startedAt: new Date(baseMs),
            expiresAt: new Date(vipExpiresAtMs),
            expiresAtMs: vipExpiresAtMs,
            benefits: vipBenefits,
            includedItems: vipIncludedItems,
            updatedAt: new Date(),
          },
          updatedAt: new Date(),
        },
        { merge: true }
      );
      tx.set(historyRef, {
        type: "vip_activation",
        source: "mercadopago",
        status: "active",
        itemId: vipPlanId,
        itemType: "vip_plan",
        itemName: vipPlanName,
        amountPaid: Math.max(0, Number(freshOrder.totalPaid || freshOrder.total || 0)),
        currency: String(freshOrder.currency || "BRL"),
        orderId: String(freshOrder.orderId || orderRef.id),
        validUntil: new Date(vipExpiresAtMs),
        validUntilMs: vipExpiresAtMs,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await grantVipIncludedRewards({
        tx,
        uid: playerUid,
        playerRef,
        includedItems: vipIncludedItems,
        orderId: String(freshOrder.orderId || orderRef.id),
        planId: vipPlanId,
        planCode: vipPlanCode,
      });
      tx.set(
        orderRef,
        {
          deliveredAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
    });
    return;
  }

  const playerUid = String(orderData.uid || "");
  const entitlementId = String(orderData.productId || orderData.itemId || orderRef.id);
  const playerRef = db.doc(`players/${playerUid}`);
  const entitlementRef = db.doc(`players/${playerUid}/productEntitlements/${entitlementId}`);
  const historyRef = db.collection(`players/${playerUid}/monetizationHistory`).doc();
  const qty = Math.max(1, Math.floor(n(orderData.qty, 1)));
  const durationDays = orderData.productDurationDays == null ? null : Math.max(1, n(orderData.productDurationDays, 1));
  const baseMs = Date.now();
  const validUntilMs = durationDays ? baseMs + durationDays * qty * 24 * 60 * 60 * 1000 : null;

  await db.runTransaction(async (tx) => {
    const freshOrderSnap = await tx.get(orderRef);
    const freshOrder = freshOrderSnap.data() || {};
    if (freshOrder.deliveredAt) return;

    tx.set(playerRef, { updatedAt: new Date() }, { merge: true });
    grantProductReward({
      tx,
      uid: playerUid,
      playerRef,
      source: "product_entitlement",
      orderId: String(freshOrder.orderId || orderRef.id),
      qty,
      characterId: String(freshOrder.characterId || "") || null,
      validUntilMs,
      product: {
        id: String(freshOrder.productId || freshOrder.itemId || entitlementId),
        code: String(freshOrder.productCode || freshOrder.productId || ""),
        type: String(freshOrder.productType || "product"),
        name: String(freshOrder.itemName || "Produto"),
        deliveryScope: String(freshOrder.deliveryScope || ""),
        benefits: freshOrder.productBenefits || null,
      },
    });
    if (String(freshOrder.productType || "") === "trainer_license") {
      const benefits =
        freshOrder.productBenefits && typeof freshOrder.productBenefits === "object"
          ? freshOrder.productBenefits
          : {};
      const metadata =
        benefits.metadata && typeof benefits.metadata === "object"
          ? benefits.metadata
          : {};
      const licenseDays = Math.min(7, Math.max(1, Number(benefits.trainerLicenseDays || durationDays || 1)));
      const licenseExpiresAtMs = baseMs + licenseDays * 24 * 60 * 60 * 1000;
      tx.set(
        playerRef,
        {
          trainerLicense: {
            status: "active",
            productId: String(freshOrder.productId || freshOrder.itemId || entitlementId),
            productCode: String(freshOrder.productCode || freshOrder.productId || ""),
            productName: String(freshOrder.itemName || "Licenca de Treinador"),
            startedAt: new Date(baseMs),
            startedAtMs: baseMs,
            expiresAt: new Date(licenseExpiresAtMs),
            expiresAtMs: licenseExpiresAtMs,
            benefits: {
              xpBonusPercent: Number(metadata.xpBonusPercent || 0),
              shinyBonusPercent: Number(metadata.shinyBonusPercent || 0),
              biomeAccessIds: parseMetadataList(metadata.biomeAccessIds),
            },
            updatedAt: new Date(),
          },
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }
    tx.set(historyRef, {
      type: "product_activation",
      source: "mercadopago",
      status: "active",
      itemId: String(freshOrder.productId || freshOrder.itemId || entitlementId),
      itemType: "product",
      itemName: String(freshOrder.itemName || "Produto"),
      amountPaid: Math.max(0, Number(freshOrder.totalPaid || freshOrder.total || 0)),
      currency: String(freshOrder.currency || "BRL"),
      orderId: String(freshOrder.orderId || orderRef.id),
      validUntil: validUntilMs ? new Date(validUntilMs) : null,
      validUntilMs,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tx.set(
      orderRef,
      {
        deliveredAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  });
}

async function syncOrderStatusById(orderId, orderPath) {
  const orderRef = await resolveOrderRef({ orderId, orderPath });
  if (!orderRef) return { ok: true, skipped: "order-not-found" };

  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { ok: true, skipped: "order-missing" };
  const orderData = orderSnap.data() || {};

  const providerPaymentId = extractNumericPaymentId(orderData.providerPaymentId);
  const payment =
    providerPaymentId != null ? await fetchMpPayment(providerPaymentId) : await fetchMpPaymentByOrderId(orderId);

  if (!payment) return { ok: true, status: String(orderData.status || "pending"), skipped: "payment-not-found" };

  const paymentId = String(payment.id || providerPaymentId || "");
  const status = mapStatus(String(payment.status || ""));
  const statusDetail = String(payment.status_detail || "");
  const total = Number(payment.transaction_amount || 0);

  await orderRef.set(
    {
      status,
      providerPaymentId: paymentId || null,
      providerRawStatus: payment.status || null,
      providerStatusDetail: statusDetail,
      totalPaid: total,
      approvedAt: status === "approved" ? new Date() : null,
      updatedAt: new Date(),
    },
    { merge: true }
  );

  if (status === "approved") {
    await applyApprovedOrderSideEffects(orderRef);
  }

  return { ok: true, status, providerPaymentId: paymentId || null };
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
    const payerEmail = fallbackPayerEmail(uid, decoded.email);

    const body = req.body || {};
    const itemId = String(body.itemId || "").trim();
    const offerId = String(body.offerId || "").trim().toLowerCase();
    const offerCode = String(body.offerCode || "").trim().toLowerCase();
    const offerName = String(body.offerName || "").trim();
    const productId = String(body.productId || "").trim().toLowerCase();
    const characterId = String(body.characterId || "").trim();
    const rawEcoinPackageId = String(body.ecoinPackageId || "").trim().toLowerCase();
    const inferredEcoinPackageId =
      !rawEcoinPackageId && !offerId && !productId && !characterId
        ? String(body.itemId || "").trim().toLowerCase()
        : "";
    const ecoinPackageId = rawEcoinPackageId || inferredEcoinPackageId;
    const qty = Math.max(1, Math.floor(n(body.qty, 1)));
    const method = String(body.method || "").toUpperCase();

    if (!itemId && !offerId && !productId && !ecoinPackageId) {
      return json(res, 400, { error: "itemId, offerId, productId ou ecoinPackageId sao obrigatorios." });
    }
    if (!["PIX", "CREDIT", "DEBIT"].includes(method)) return json(res, 400, { error: "Metodo invalido." });

    const mpToken = mpAccessToken.value() || process.env.MP_ACCESS_TOKEN || "";
    if (!mpToken) return json(res, 500, { error: "MP_ACCESS_TOKEN nao configurado." });

    let orderRef = null;
    let total = 0;
    let itemName = "";
    let orderPayload = null;

    if (ecoinPackageId) {
      const pkg = await resolveEcoinPackage(ecoinPackageId);
      if (!pkg) return json(res, 404, { error: "Pacote de Ecoin nao configurado." });
      if (String(pkg.status || "inactive") !== "active") {
        return json(res, 400, { error: "Pacote de Ecoin indisponivel." });
      }
      orderRef = db.collection(`players/${uid}/paymentOrders`).doc();
      total = Number((Number(pkg.price || 0) * qty).toFixed(2));
      itemName = `${pkg.amount} Ecoins`;
      orderPayload = {
        orderId: orderRef.id,
        uid,
        ecoinPackageId: pkg.id,
        itemId: pkg.id,
        itemName,
        itemKind: "ECOIN_PACKAGE",
        qty,
        method,
        scope: "player",
        grantType: "ecoin_purchase",
        ecoinAmount: Math.max(0, Number(pkg.amount || 0)) * qty,
        status: "pending",
        unitPrice: Number(pkg.price || 0),
        currency: pkg.currency || "BRL",
        total,
        provider: "mercadopago",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else if (offerId) {
      const planLookup = offerCode || offerId || itemId;
      const plan = await resolveVipPlan(planLookup, offerName);
      if (!plan) return json(res, 404, { error: "Plano VIP nao configurado." });
      if (String(plan.status || "inactive") !== "active") {
        return json(res, 400, { error: "Plano VIP indisponivel." });
      }
      orderRef = db.collection(`players/${uid}/paymentOrders`).doc();
      total = Number((Number(plan.price || 0) * qty).toFixed(2));
      itemName = plan.name;
      orderPayload = {
        orderId: orderRef.id,
        uid,
        offerId: offerId || offerCode || String(plan.code || plan.id || "").trim().toLowerCase(),
        vipPlanId: plan.id,
        vipPlanCode: plan.code,
        itemId: plan.id,
        itemName: plan.name,
        itemKind: "VIP_PLAN",
        qty,
        method,
        scope: "player",
        grantType: "vip_subscription",
        vipDays: Math.max(1, Math.floor(n(plan.durationDays, 30))),
        vipBenefits: plan.benefits || null,
        vipIncludedItems: Array.isArray(plan.includedItems) ? plan.includedItems : [],
        status: "pending",
        unitPrice: Number(plan.price || 0),
        currency: plan.currency || "BRL",
        total,
        provider: "mercadopago",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else if (productId) {
      const product = await resolveMonetizationProduct(productId);
      if (!product) return json(res, 404, { error: "Produto monetizavel nao configurado." });
      if (String(product.status || "inactive") !== "active") {
        return json(res, 400, { error: "Produto monetizavel indisponivel." });
      }
      const productDurationDays =
        product.type === "trainer_license"
          ? Math.min(7, Math.max(1, Number(product.durationDays ?? product.benefits?.trainerLicenseDays ?? 1)))
          : product.durationDays ?? null;
      const directCharacterDelivery =
        !!characterId &&
        (["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg", "gym_main_team_slot"].includes(
          String(product.type || "").trim().toLowerCase()
        ) ||
          isGymCharacterSlotProduct(product));
      orderRef = db.collection(`players/${uid}/paymentOrders`).doc();
      total = Number((Number(product.price || 0) * qty).toFixed(2));
      itemName = product.name;
      orderPayload = {
        orderId: orderRef.id,
        uid,
        productId: product.id,
        productCode: product.code,
        itemId: product.id,
        itemName: product.name,
        itemKind: "MONETIZATION_PRODUCT",
        qty,
        method,
        scope: "player",
        grantType: "product_entitlement",
        productType: product.type,
        characterId: characterId || null,
        deliveryScope: directCharacterDelivery ? "character_backpack" : "account",
        productDurationDays,
        productBenefits: product.benefits || null,
        status: "pending",
        unitPrice: Number(product.price || 0),
        currency: product.currency || "BRL",
        total,
        provider: "mercadopago",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      if (!characterId) return json(res, 400, { error: "characterId e obrigatorio para compra de item." });
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
      itemName = String(cfg.itemName || itemId);
      const supportsReal = sellMode === "ecoin" || sellMode === "both" || sellMode === "real";
      if (!saleEnabled || !supportsReal || realPrice <= 0) {
        return json(res, 400, { error: "Item nao disponivel para pagamento online." });
      }

      orderRef = db.collection(`players/${uid}/characters/${characterId}/paymentOrders`).doc();
      total = Number((realPrice * qty).toFixed(2));
      orderPayload = {
        orderId: orderRef.id,
        uid,
        characterId,
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
      };
    }
    await orderRef.set(orderPayload);

    const proto = req.get("x-forwarded-proto") || "https";
    const baseUrl = resolvePaymentsBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/payments/webhook/mercadopago`;
    const resultUrl = `${baseUrl}/api/payments/result`;

    if (method === "PIX") {
      const paymentRes = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mpToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `elodex-pix-${orderRef.id}`,
        },
        body: JSON.stringify({
          transaction_amount: Number(orderPayload.unitPrice || 0) * qty,
          description: itemName,
          payment_method_id: "pix",
          external_reference: orderRef.id,
          notification_url: webhookUrl,
          payer: {
            email: payerEmail,
            first_name: "Treinador",
          },
          metadata: {
            orderId: orderRef.id,
            uid,
            characterId,
            itemId,
            offerId,
            productId,
            qty,
            method,
            proto,
          },
        }),
      });
      const paymentData = await paymentRes.json();
      if (!paymentRes.ok) {
        await orderRef.set(
          {
            status: "failed",
            providerError: paymentData,
            providerErrorMessage:
              paymentData?.message ||
              paymentData?.error ||
              (Array.isArray(paymentData?.cause) && paymentData.cause.length
                ? String(paymentData.cause[0]?.description || paymentData.cause[0]?.code || "")
                : ""),
            updatedAt: new Date(),
          },
          { merge: true }
        );
        return json(res, 502, { error: "Falha ao criar PIX no Mercado Pago.", details: paymentData });
      }

      const tx = paymentData?.point_of_interaction?.transaction_data || {};
      await orderRef.set(
        {
          providerPaymentId: paymentData?.id ? String(paymentData.id) : null,
          providerRawStatus: paymentData?.status || "pending",
          providerStatusDetail: paymentData?.status_detail || null,
          qrCodeBase64: tx?.qr_code_base64 || null,
          copiaECola: tx?.qr_code || null,
          expiresAt: tx?.expiration_date || tx?.expires_at || null,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return json(res, 200, {
        ok: true,
        mode: "pix",
        orderId: orderRef.id,
        qrCode_base64: tx?.qr_code_base64 || null,
        qrCode: tx?.qr_code_base64 || null,
        copiaECola: tx?.qr_code || null,
        expiresAt: tx?.expiration_date || tx?.expires_at || null,
      });
    }

    const payload = {
      items: [
        {
          id: offerId || productId || itemId,
          title: itemName,
          quantity: qty,
          currency_id: "BRL",
          unit_price: Number(orderPayload.unitPrice || 0),
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
        offerId,
        productId,
        qty,
        method,
        proto,
      },
      statement_descriptor: "ELODEX",
    };
    const paymentRules = methodPaymentRules(method);
    if (paymentRules) payload.payment_methods = paymentRules;

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
          providerErrorMessage:
            prefData?.message ||
            prefData?.error ||
            (Array.isArray(prefData?.cause) && prefData.cause.length
              ? String(prefData.cause[0]?.description || prefData.cause[0]?.code || "")
              : ""),
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

    return json(res, 200, { ok: true, mode: "checkout", orderId: orderRef.id, checkoutUrl });
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
      const fromQuery = req.query["data.id"] || req.query.id || req.query.resource || req.query["data.resource"];
      const body = req.body || {};
      const bodyId =
        body && body.data && typeof body.data === "object" && body.data.id ? body.data.id : null;
      const paymentId = extractNumericPaymentId(fromQuery || bodyId || body.id || body.resource);
      if (!paymentId) return json(res, 200, { ok: true, skipped: "no-payment-id" });

      const payment = await fetchMpPayment(paymentId);
      const externalReference = String(payment.external_reference || "");
      if (!externalReference) return json(res, 200, { ok: true, skipped: "no-external-reference" });

      const result = await syncOrderStatusById(externalReference, null);
      return json(res, 200, result);
    } catch (e) {
      logger.error("paymentsWebhookMercadoPago", e);
      return json(res, 500, { ok: false, error: e?.message || "Erro no webhook." });
    }
  }
);

exports.paymentsSyncOrderStatus = onRequest(
  { region: "southamerica-east1", cors: true, secrets: [mpAccessToken] },
  async (req, res) => {
    try {
      const token = readBearer(req);
      if (!token) return json(res, 401, { error: "Token ausente." });
      await auth.verifyIdToken(token);

      const orderId = String(req.query.orderId || req.body?.orderId || "").trim();
      const orderPath = parseOrderPathCandidate(req.query.orderPath || req.body?.orderPath || "");
      if (!orderId) return json(res, 400, { error: "orderId obrigatorio." });
      const result = await syncOrderStatusById(orderId, orderPath);
      return json(res, 200, result);
    } catch (e) {
      logger.error("paymentsSyncOrderStatus", e);
      return json(res, 500, { ok: false, error: e?.message || "Erro ao sincronizar pedido." });
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

async function resolveGymPoliceConfig(gymOwnerUid) {
  const gymId = String(gymOwnerUid || "").trim();
  if (!gymId) return { enabled: false, chancePercent: 0, npcName: null };
  const gymSnap = await db.doc(`gyms/${gymId}`).get();
  if (!gymSnap.exists) return { enabled: false, chancePercent: 0, npcName: null };
  const gym = gymSnap.data() || {};
  const activePolice = Boolean(gym?.activeNpcs?.police) || Boolean(gym?.policeInterceptPrepared);
  if (!activePolice) return { enabled: false, chancePercent: 0, npcName: null };
  const assignedSnap = await db.collection(`gyms/${gymId}/assignedNpcs`).limit(20).get();
  const policeNpc = assignedSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .find((npc) => String(npc.role || "").trim().toLowerCase() === "policial");
  const chancePercent = Math.max(
    0,
    Math.min(
      100,
      Number(
        gym.policeInterceptChancePercent ||
          policeNpc?.interceptChancePercent ||
          policeNpc?.appearanceRate ||
          40
      )
    )
  );
  return {
    enabled: chancePercent > 0,
    chancePercent,
    npcName: policeNpc ? String(policeNpc.name || policeNpc.npcId || "Policial do GYM") : "Policial do GYM",
  };
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
    const targetScope = String(body.targetScope || "character").trim().toLowerCase();
    const gymOwnerUid = String(body.gymOwnerUid || victimUid || "").trim();
    const gymPokemonEntryId = String(body.gymPokemonEntryId || "").trim();

    if (!thiefUid || !thiefCharacterId || !victimUid || (!victimCharacterId && targetScope !== "gym")) {
      return json(res, 400, { error: "Parametros incompletos." });
    }
    if (uid !== thiefUid) return json(res, 403, { error: "Operacao nao autorizada para este usuario." });
    if (thiefUid === victimUid) return json(res, 400, { error: "Roubo contra si mesmo nao permitido." });

    const thiefCharRef = db.doc(`players/${thiefUid}/characters/${thiefCharacterId}`);
    const victimCharRef = targetScope === "gym" ? null : db.doc(`players/${victimUid}/characters/${victimCharacterId}`);
    const thiefLogRef = db.collection(`players/${thiefUid}/characters/${thiefCharacterId}/theftLogs`).doc();

    const [thiefCharSnap, victimCharSnap, cooldownSnap] = await Promise.all([
      thiefCharRef.get(),
      victimCharRef ? victimCharRef.get() : Promise.resolve(null),
      db.doc(`players/${thiefUid}/characters/${thiefCharacterId}/thiefMeta/cooldown`).get(),
    ]);
    if (!thiefCharSnap.exists || (victimCharRef && !victimCharSnap.exists)) {
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

    let pool = [];
    let policeConfig = { enabled: false, chancePercent: 0, npcName: null };
    if (targetScope === "gym") {
      const [gymStorageSnap, gymMainTeamSnap, resolvedPolice] = await Promise.all([
        gymPokemonEntryId
          ? Promise.resolve(null)
          : db.collection(`gyms/${gymOwnerUid}/storage`).limit(80).get(),
        gymPokemonEntryId
          ? Promise.resolve(null)
          : db.collection(`gyms/${gymOwnerUid}/mainTeam`).limit(6).get(),
        resolveGymPoliceConfig(gymOwnerUid),
      ]);
      policeConfig = resolvedPolice;
      if (gymPokemonEntryId) {
        const [storageDoc, teamDoc] = await Promise.all([
          db.doc(`gyms/${gymOwnerUid}/storage/${gymPokemonEntryId}`).get(),
          db.doc(`gyms/${gymOwnerUid}/mainTeam/${gymPokemonEntryId}`).get(),
        ]);
        if (storageDoc.exists) pool.push({ id: storageDoc.id, ...storageDoc.data(), source: "gym_storage" });
        if (teamDoc.exists) pool.push({ id: teamDoc.id, ...teamDoc.data(), source: "gym_mainTeam" });
      } else {
        const storageCandidates = (gymStorageSnap?.docs || []).map((d) => ({ id: d.id, ...d.data(), source: "gym_storage" }));
        const teamCandidates = (gymMainTeamSnap?.docs || []).map((d) => ({ id: d.id, ...d.data(), source: "gym_mainTeam" }));
        pool = [...storageCandidates, ...teamCandidates];
      }
    } else {
      const [victimBoxSnap, victimTeamSnap] = await Promise.all([
        db.collection(`players/${victimUid}/characters/${victimCharacterId}/box`).limit(80).get(),
        db.collection(`players/${victimUid}/characters/${victimCharacterId}/time`).limit(6).get(),
      ]);
      const boxCandidates = victimBoxSnap.docs.map((d) => ({ id: d.id, ...d.data(), source: "box" }));
      const teamCandidates = victimTeamSnap.docs
        .map((d) => ({ id: d.id, ...d.data(), source: "team" }))
        .filter((m) => Number(m.speciesId || 0) > 0 && !Boolean(m.isStarter));
      pool = [...boxCandidates, ...teamCandidates];
    }
    if (!pool.length) return json(res, 200, { ok: false, message: "Alvo sem Pokemon elegiveis para roubo." });
    const selected = pool[Math.floor(Math.random() * pool.length)];
    const intercept = targetScope === "gym" ? policeConfig.enabled && chance(policeConfig.chancePercent) : chance(40);
    const caseRef = db.collection("stolenPokemonCases").doc();

    await db.runTransaction(async (tx) => {
      const victimRef =
        selected.source === "box"
          ? db.doc(`players/${victimUid}/characters/${victimCharacterId}/box/${selected.id}`)
          : selected.source === "team"
          ? db.doc(`players/${victimUid}/characters/${victimCharacterId}/time/${selected.id}`)
          : selected.source === "gym_mainTeam"
          ? db.doc(`gyms/${gymOwnerUid}/mainTeam/${selected.id}`)
          : db.doc(`gyms/${gymOwnerUid}/storage/${selected.id}`);
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
        targetScope,
        gymOwnerUid: targetScope === "gym" ? gymOwnerUid : null,
        thiefUid,
        thiefCharacterId,
        pokemonData: mon,
        policeNpcName: intercept ? policeConfig.npcName : null,
        policeInterceptChancePercent: targetScope === "gym" ? policeConfig.chancePercent : 40,
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
        targetScope,
        gymOwnerUid: targetScope === "gym" ? gymOwnerUid : null,
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
      policeNpcName: intercept ? policeConfig.npcName : null,
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
