import type { DocumentReference, Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebaseAdmin";

export type RewardDeliveryScope = "account" | "character_backpack";

type VipIncludedItemRef = {
  id?: string | null;
  source?: string | null;
  refId?: string | null;
  refCode?: string | null;
  name?: string | null;
  quantity?: number | null;
  deliveryScope?: string | null;
};

type ProductLike = {
  id?: string | null;
  code?: string | null;
  type?: string | null;
  name?: string | null;
  benefits?: Record<string, unknown> | null;
  durationDays?: number | null;
  deliveryScope?: string | null;
};

function isGymCharacterSlotProduct(product: ProductLike | null | undefined) {
  const productType = toLower(product?.type);
  const benefits = product?.benefits && typeof product.benefits === "object" ? product.benefits : {};
  const metadata = benefits.metadata && typeof benefits.metadata === "object" ? (benefits.metadata as Record<string, unknown>) : {};
  const slotScope = toLower(metadata.slotScope);
  const productCode = toLower(product?.code);
  const productId = toLower(product?.id);
  const productName = toLower(product?.name);
  const gymMainTeamSlots = toNumber((benefits as Record<string, unknown>).gymMainTeamSlots, 0);
  const gymDefenseSlotsAdded = toNumber((benefits as Record<string, unknown>).gymDefenseSlotsAdded, 0);
  const storeCategory = toLower(metadata.storeCategory);
  return (
    productType === "gym_main_team_slot" ||
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
        productName.includes("slot do time principal")))
  );
}

function toLower(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveExplicitScope(value: unknown) {
  const normalized = toLower(value);
  if (normalized === "account") return "account" as const;
  if (normalized === "character_backpack" || normalized === "character") {
    return "character_backpack" as const;
  }
  return null;
}

function deterministicId(parts: string[]) {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("__")
    .slice(0, 180);
}

async function resolveEcoinPackage(refIdOrCode: string) {
  const normalized = toLower(refIdOrCode);
  if (!normalized) return null;
  const storeSnap = await adminDb.doc(`storePackages/${normalized}`).get();
  if (storeSnap.exists) {
    return { id: storeSnap.id, ...(storeSnap.data() as Record<string, unknown>) } as Record<string, unknown> & {
      id: string;
    };
  }
  const storeByCode = await adminDb.collection("storePackages").where("code", "==", normalized).limit(1).get();
  if (!storeByCode.empty) {
    const d = storeByCode.docs[0];
    return { id: d.id, ...(d.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string };
  }
  const directSnap = await adminDb.doc(`ecoinPackages/${normalized}`).get();
  if (directSnap.exists) return { id: directSnap.id, ...(directSnap.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string };
  const byCode = await adminDb.collection("ecoinPackages").where("code", "==", normalized).limit(1).get();
  if (!byCode.empty) return { id: byCode.docs[0].id, ...(byCode.docs[0].data() as Record<string, unknown>) } as Record<string, unknown> & { id: string };
  return null;
}

async function resolveMonetizationProduct(refIdOrCode: string) {
  const normalized = toLower(refIdOrCode);
  if (!normalized) return null;
  const directSnap = await adminDb.doc(`monetizationProducts/${normalized}`).get();
  if (directSnap.exists) return { id: directSnap.id, ...(directSnap.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string };
  const byCode = await adminDb.collection("monetizationProducts").where("code", "==", normalized).limit(1).get();
  if (!byCode.empty) return { id: byCode.docs[0].id, ...(byCode.docs[0].data() as Record<string, unknown>) } as Record<string, unknown> & { id: string };
  return null;
}

function buildTrainerLicenseState(product: ProductLike, qty: number) {
  const benefits = product.benefits && typeof product.benefits === "object" ? product.benefits : {};
  const metadata = benefits.metadata && typeof benefits.metadata === "object" ? (benefits.metadata as Record<string, unknown>) : {};
  const nowMs = Date.now();
  const licenseDays =
    Math.min(7, Math.max(1, Number(benefits.trainerLicenseDays || product.durationDays || 1))) * Math.max(1, qty);
  const expiresAtMs = nowMs + licenseDays * 24 * 60 * 60 * 1000;
  return {
    status: "active",
    productId: String(product.id || ""),
    productCode: String(product.code || ""),
    productName: String(product.name || "Licenca de Treinador"),
    startedAt: new Date(nowMs),
    startedAtMs: nowMs,
    expiresAt: new Date(expiresAtMs),
    expiresAtMs,
    benefits: {
      xpBonusPercent: Number(metadata.xpBonusPercent || 0),
      shinyBonusPercent: Number(metadata.shinyBonusPercent || 0),
      biomeAccessIds: String(metadata.biomeAccessIds || "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    },
    updatedAt: new Date(),
  };
}

function isCharacterDeliveredMonetizedProduct(product: ProductLike | null | undefined) {
  if (isGymCharacterSlotProduct(product)) return true;
  const normalized = toLower(product?.type);
  const benefits = product?.benefits && typeof product.benefits === "object" ? product.benefits : {};
  const metadata = benefits.metadata && typeof benefits.metadata === "object" ? (benefits.metadata as Record<string, unknown>) : {};
  const ticketSubtype = toLower(metadata.ticketSubtype || metadata.ticketType);
  return (
    ["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg", "fishing_bait"].includes(normalized) ||
    (normalized === "ticket" && ticketSubtype === "biome")
  );
}

export function resolveProductDeliveryScope(productType: unknown, explicitScope?: unknown, product?: ProductLike | null): RewardDeliveryScope {
  const explicit = resolveExplicitScope(explicitScope);
  if (explicit) return explicit;
  if (product && isCharacterDeliveredMonetizedProduct(product)) return "character_backpack";
  const normalized = toLower(productType);
  if (["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg", "fishing_bait"].includes(normalized)) {
    return "character_backpack";
  }
  return "account";
}

export function resolveVipIncludedItemDeliveryScope(
  item: VipIncludedItemRef,
  productType?: unknown,
  product?: ProductLike | null
): RewardDeliveryScope {
  const explicit = resolveExplicitScope(item.deliveryScope);
  if (explicit) return explicit;
  if (toLower(item.source) === "ecoin_package" || toLower(item.source) === "store_package") return "account";
  if (toLower(item.source) === "item_config") return "character_backpack";
  return resolveProductDeliveryScope(productType, undefined, product);
}

export async function grantVipIncludedRewards(args: {
  tx: Transaction;
  playerRef: DocumentReference;
  uid: string;
  includedItems: VipIncludedItemRef[];
  sourceOrderId: string;
  sourcePlanId: string;
  sourcePlanCode?: string | null;
}) {
  const includedItems = Array.isArray(args.includedItems) ? args.includedItems : [];
  if (!includedItems.length) return;

  const [playerSnap, products, packages] = await Promise.all([
    args.tx.get(args.playerRef),
    Promise.all(
      includedItems
        .filter((item) => toLower(item.source) === "monetization_product")
        .map((item) => resolveMonetizationProduct(String(item.refId || item.refCode || "")))
    ),
    Promise.all(
      includedItems
        .filter((item) => ["ecoin_package", "store_package"].includes(toLower(item.source)))
        .map((item) => resolveEcoinPackage(String(item.refId || item.refCode || "")))
    ),
  ]);

  const playerData = playerSnap.data() || {};
  const currentBalance = Math.max(0, Number(playerData.ecoinBalance || 0));
  const currentKmBalance = Math.max(0, Number(playerData.kmsDisponiveis || 0));
  let nextEcoinBalance = currentBalance;
  let nextKmBalance = currentKmBalance;
  let productIndex = 0;
  let packageIndex = 0;

  for (const item of includedItems) {
    const qty = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
    const source = toLower(item.source);

    if (source === "ecoin_package" || source === "store_package") {
      const pkg = packages[packageIndex++];
      if (!pkg) continue;
      const items = pkg.items && typeof pkg.items === "object" ? (pkg.items as Record<string, unknown>) : {};
      const fromItemsEcoin = Number(items.ecoin);
      const fromItemsKm = Number(items.km);
      const ecoinUnit = Number.isFinite(fromItemsEcoin)
        ? fromItemsEcoin
        : Number(pkg.ecoinAmount ?? pkg.amount ?? 0);
      const kmUnit = Number.isFinite(fromItemsKm) ? fromItemsKm : Number(pkg.kmAmount || 0);
      nextEcoinBalance += Math.max(0, ecoinUnit) * qty;
      nextKmBalance += Math.max(0, kmUnit) * qty;
      const boostRaw = items.boost && typeof items.boost === "object" ? (items.boost as Record<string, unknown>) : {};
      const bp = Math.max(0, Math.floor(toNumber(boostRaw.bonusPercent, 0)));
      let bh = Math.max(0, Math.floor(toNumber(boostRaw.durationHours, 0)));
      if (bh <= 0) {
        const legacyDays = Math.max(0, Math.floor(toNumber(boostRaw.durationDays, 0)));
        if (legacyDays > 0) bh = legacyDays * 24;
      }
      if (bp > 0 && bh > 0) {
        const mult = 1 + bp / 100;
        const validUntilMs = Date.now() + bh * qty * 60 * 60 * 1000;
        const entId = deterministicId(["vip_pkg_boost", args.sourceOrderId, String(pkg.id || item.refId), String(qty)]);
        args.tx.set(
          adminDb.doc(`players/${args.uid}/productEntitlements/${entId}`),
          {
            entitlementId: entId,
            productId: String(pkg.id || item.refId || ""),
            productCode: "vip-included-boost",
            productType: "km_boost",
            productName: String(pkg.name || item.name || "Boost KM"),
            benefits: {
              kmGainMultiplier: mult,
              kmBonusPercent: bp,
              metadata: { source: "vip_subscription", packageId: String(pkg.id || "") },
            },
            quantity: qty,
            status: "active",
            source: "vip_subscription",
            orderId: args.sourceOrderId,
            validUntil: new Date(validUntilMs),
            validUntilMs,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }
      continue;
    }

    if (source === "item_config") {
      const rewardId = deterministicId(["vip", args.sourceOrderId, String(item.refId || item.id || "item"), String(qty)]);
      args.tx.set(
        adminDb.doc(`players/${args.uid}/accountBackpack/${rewardId}`),
        {
          name: String(item.name || item.refId || "Item VIP"),
          rewardType: "item_config",
          deliveryScope: "character_backpack",
          source: "vip_subscription",
          status: "pending",
          quantity: qty,
          itemConfigId: String(item.refId || "").trim().toLowerCase(),
          metadata: { source: "item_config" },
          sourceOrderId: args.sourceOrderId,
          sourcePlanId: args.sourcePlanId,
          sourcePlanCode: args.sourcePlanCode || null,
          idempotencyKey: rewardId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      continue;
    }

    if (source !== "monetization_product") continue;
    const product = products[productIndex++];
    if (!product) continue;
    const deliveryScope = resolveVipIncludedItemDeliveryScope(item, product.type, product);
    if (deliveryScope === "character_backpack") {
      const rewardId = deterministicId(["vip", args.sourceOrderId, String(product.id || item.refId || "product"), String(qty)]);
      args.tx.set(
        adminDb.doc(`players/${args.uid}/accountBackpack/${rewardId}`),
        {
          name: String(product.name || item.name || "Produto VIP"),
          rewardType: "monetization_product",
          deliveryScope,
          source: "vip_subscription",
          status: "pending",
          quantity: qty,
          productId: String(product.id || item.refId || ""),
          productCode: String(product.code || item.refCode || "") || null,
          productType: String(product.type || "product"),
          benefits: (product.benefits as Record<string, unknown> | null) || null,
          metadata: { source: "monetization_product" },
          sourceOrderId: args.sourceOrderId,
          sourcePlanId: args.sourcePlanId,
          sourcePlanCode: args.sourcePlanCode || null,
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

    const entryId = deterministicId(["vip", args.sourceOrderId, String(product.id || item.refId || "product")]);
    args.tx.set(
      adminDb.doc(`players/${args.uid}/productEntitlements/${entryId}`),
      {
        entitlementId: entryId,
        productId: String(product.id || item.refId || ""),
        productCode: String(product.code || item.refCode || "") || null,
        productType: String(product.type || "product"),
        productName: String(product.name || item.name || "Produto VIP"),
        benefits: (product.benefits as Record<string, unknown> | null) || null,
        quantity: qty,
        status: "active",
        source: "vip_subscription",
        orderId: args.sourceOrderId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
    if (toLower(product.type) === "trainer_license") {
      args.tx.set(args.playerRef, { trainerLicense: buildTrainerLicenseState(product, qty) }, { merge: true });
    }
  }

  if (nextEcoinBalance !== currentBalance || nextKmBalance !== currentKmBalance) {
    args.tx.set(
      args.playerRef,
      { ecoinBalance: nextEcoinBalance, kmsDisponiveis: nextKmBalance, updatedAt: new Date() },
      { merge: true }
    );
  }
}

export function grantProductReward(args: {
  tx: Transaction;
  uid: string;
  playerRef: DocumentReference;
  source: "product_entitlement" | "system";
  orderId: string;
  product: ProductLike;
  qty: number;
  validUntilMs?: number | null;
  characterId?: string | null;
}) {
  const qty = Math.max(1, Math.floor(toNumber(args.qty, 1)));
  const deliveryScope = isGymCharacterSlotProduct(args.product)
    ? "character_backpack"
    : resolveProductDeliveryScope(args.product.type, args.product.deliveryScope, args.product);
  if (deliveryScope === "character_backpack" && !args.characterId) {
    const rewardId = deterministicId([args.source, args.orderId, String(args.product.id || "product"), String(qty)]);
    args.tx.set(
      adminDb.doc(`players/${args.uid}/accountBackpack/${rewardId}`),
      {
        name: String(args.product.name || "Produto"),
        rewardType: "monetization_product",
        deliveryScope,
        source: args.source,
        status: "pending",
        quantity: qty,
        productId: String(args.product.id || ""),
        productCode: String(args.product.code || "") || null,
        productType: String(args.product.type || "product"),
        benefits: (args.product.benefits as Record<string, unknown> | null) || null,
        metadata: { source: args.source },
        sourceOrderId: args.orderId,
        sourceProductId: String(args.product.id || "") || null,
        sourceProductCode: String(args.product.code || "") || null,
        idempotencyKey: rewardId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
    return;
  }

  const entryId = deterministicId([args.source, args.orderId, String(args.product.id || "product")]);
  args.tx.set(
    adminDb.doc(`players/${args.uid}/productEntitlements/${entryId}`),
    {
      entitlementId: entryId,
      productId: String(args.product.id || ""),
      productCode: String(args.product.code || "") || null,
      productType: String(args.product.type || "product"),
      productName: String(args.product.name || "Produto"),
      benefits: (args.product.benefits as Record<string, unknown> | null) || null,
      quantity: qty,
      status: "active",
      source: args.source,
      orderId: args.orderId,
      deliveryScope,
      consumedByCharacterId: args.characterId || null,
      validUntil: args.validUntilMs ? new Date(args.validUntilMs) : null,
      validUntilMs: args.validUntilMs || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
  if (toLower(args.product.type) === "trainer_license") {
    args.tx.set(args.playerRef, { trainerLicense: buildTrainerLicenseState(args.product, qty) }, { merge: true });
  }
}
