import { NextRequest, NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import {
  DEFAULT_MONETIZATION_PRODUCTS,
  DEFAULT_VIP_PLANS,
  type MonetizationProductDoc,
  type VipPlanDoc,
} from "@/lib/monetizationCatalog";

type OnlineMethod = "PIX" | "CREDIT" | "DEBIT";
type SellMode = "game" | "ecoin" | "both" | "real";
type GrantType = "inventory" | "biome_access";
type MonetizationGrantType = "vip_subscription" | "product_entitlement";

type RequestBody = {
  itemId?: string;
  offerId?: string;
  offerCode?: string;
  offerName?: string;
  productId?: string;
  ecoinPackageId?: string;
  qty?: number;
  method?: OnlineMethod;
  characterId?: string;
};

function parseAuthToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const [kind, token] = authHeader.split(" ");
  if (kind?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function resolveBaseUrl(req: NextRequest) {
  return (
    process.env.PAYMENTS_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`
  );
}

function toNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function methodPaymentRules(method: OnlineMethod) {
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

function fallbackPayerEmail(uid: string, decodedEmail?: string | null) {
  const email = String(decodedEmail || "").trim().toLowerCase();
  if (email && email.includes("@")) return email;
  return `${String(uid || "jogador").trim() || "jogador"}@elodex.app`;
}

async function resolveVipPlan(planIdOrCode: string, planName?: string) {
  const normalized = String(planIdOrCode || "").trim().toLowerCase();
  const rawName = String(planName || "").trim();
  const normalizedName = rawName.toLowerCase();

  if (normalized) {
    const directRef = adminDb.doc(`vipPlans/${normalized}`);
    const directSnap = await directRef.get();
    if (directSnap.exists) {
      return { id: directSnap.id, ...(directSnap.data() as Omit<VipPlanDoc, "id">) };
    }

    const byCode = await adminDb.collection("vipPlans").where("code", "==", normalized).limit(1).get();
    if (!byCode.empty) {
      return { id: byCode.docs[0].id, ...(byCode.docs[0].data() as Omit<VipPlanDoc, "id">) };
    }
  }

  if (rawName) {
    const byName = await adminDb.collection("vipPlans").where("name", "==", rawName).limit(1).get();
    if (!byName.empty) {
      return { id: byName.docs[0].id, ...(byName.docs[0].data() as Omit<VipPlanDoc, "id">) };
    }
  }

  const fallback = DEFAULT_VIP_PLANS.find(
    (plan) =>
      plan.id === normalized ||
      plan.code === normalized ||
      (normalizedName && String(plan.name || "").trim().toLowerCase() === normalizedName)
  );
  return fallback ?? null;
}

async function resolveMonetizationProduct(productIdOrCode: string) {
  const normalized = String(productIdOrCode || "").trim().toLowerCase();
  if (!normalized) return null;

  const directRef = adminDb.doc(`monetizationProducts/${normalized}`);
  const directSnap = await directRef.get();
  if (directSnap.exists) {
    return { id: directSnap.id, ...(directSnap.data() as Omit<MonetizationProductDoc, "id">) };
  }

  const byCode = await adminDb
    .collection("monetizationProducts")
    .where("code", "==", normalized)
    .limit(1)
    .get();
  if (!byCode.empty) {
    return { id: byCode.docs[0].id, ...(byCode.docs[0].data() as Omit<MonetizationProductDoc, "id">) };
  }

  const fallback = DEFAULT_MONETIZATION_PRODUCTS.find(
    (product) => product.id === normalized || product.code === normalized
  );
  return fallback ?? null;
}

async function resolveEcoinPackage(packageIdOrCode: string) {
  const normalized = String(packageIdOrCode || "").trim().toLowerCase();
  if (!normalized) return null;

  const directRef = adminDb.doc(`ecoinPackages/${normalized}`);
  const directSnap = await directRef.get();
  if (directSnap.exists) {
    return { id: directSnap.id, ...(directSnap.data() as any) };
  }

  const byCode = await adminDb.collection("ecoinPackages").where("code", "==", normalized).limit(1).get();
  if (!byCode.empty) {
    return { id: byCode.docs[0].id, ...(byCode.docs[0].data() as any) };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const token = parseAuthToken(req);
    if (!token) return NextResponse.json({ error: "Token ausente." }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;
    if (!uid) return NextResponse.json({ error: "Token invalido." }, { status: 401 });
    const payerEmail = fallbackPayerEmail(uid, decoded.email);

    const body = (await req.json()) as RequestBody;
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
    const qty = Math.max(1, Math.floor(toNumber(body.qty, 1)));
    const method = String(body.method || "").toUpperCase() as OnlineMethod;

    if (!itemId && !offerId && !productId && !ecoinPackageId) {
      return NextResponse.json({ error: "itemId, offerId, productId ou ecoinPackageId sao obrigatorios." }, { status: 400 });
    }
    if (!["PIX", "CREDIT", "DEBIT"].includes(method)) {
      return NextResponse.json({ error: "Metodo invalido." }, { status: 400 });
    }

    const mpAccessToken = process.env.MP_ACCESS_TOKEN || "";
    if (!mpAccessToken) {
      return NextResponse.json({ error: "MP_ACCESS_TOKEN nao configurado." }, { status: 500 });
    }

    let orderRef;
    let total = 0;
    let itemName = "";
    let unitPrice = 0;
    let orderItemId = itemId;

    if (ecoinPackageId) {
      const pkg = await resolveEcoinPackage(ecoinPackageId);
      if (!pkg) return NextResponse.json({ error: "Pacote de Ecoin nao configurado." }, { status: 404 });
      if (String(pkg.status || "inactive") !== "active") {
        return NextResponse.json({ error: "Pacote de Ecoin indisponivel." }, { status: 400 });
      }
      orderRef = adminDb.collection(`players/${uid}/paymentOrders`).doc();
      total = Number((Number(pkg.price || 0) * qty).toFixed(2));
      itemName = `${pkg.amount} Ecoins`;
      unitPrice = Number(pkg.price || 0);
      orderItemId = pkg.id;
      await orderRef.set({
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
      });
    } else if (offerId) {
      const planLookup = offerCode || offerId || itemId;
      const plan = await resolveVipPlan(planLookup, offerName);
      if (!plan) return NextResponse.json({ error: "Plano VIP nao configurado." }, { status: 404 });
      if (String(plan.status || "inactive") !== "active") {
        return NextResponse.json({ error: "Plano VIP indisponivel." }, { status: 400 });
      }
      orderRef = adminDb.collection(`players/${uid}/paymentOrders`).doc();
      total = Number((Number(plan.price || 0) * qty).toFixed(2));
      itemName = plan.name;
      unitPrice = Number(plan.price || 0);
      orderItemId = plan.id;
      await orderRef.set({
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
        grantType: "vip_subscription" as MonetizationGrantType,
        vipDays: Math.max(1, Math.floor(Number(plan.durationDays || 30))),
        vipBenefits: plan.benefits,
        vipIncludedItems: Array.isArray(plan.includedItems) ? plan.includedItems : [],
        status: "pending",
        unitPrice: Number(plan.price || 0),
        currency: plan.currency || "BRL",
        total,
        provider: "mercadopago",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else if (productId) {
      const product = await resolveMonetizationProduct(productId);
      if (!product) return NextResponse.json({ error: "Produto monetizavel nao configurado." }, { status: 404 });
      if (String(product.status || "inactive") !== "active") {
        return NextResponse.json({ error: "Produto monetizavel indisponivel." }, { status: 400 });
      }
      const productDurationDays =
        product.type === "trainer_license"
          ? Math.min(7, Math.max(1, Number(product.durationDays ?? product.benefits?.trainerLicenseDays ?? 1)))
          : product.durationDays ?? null;
      const isGymCharacterSlot =
        String(product.type || "").trim().toLowerCase() === "gym_main_team_slot" ||
        (String(product.type || "").trim().toLowerCase() === "slot" &&
          String(product.benefits?.metadata?.slotScope || "").trim().toLowerCase() === "gym") ||
        String(product.code || "").trim().toLowerCase() === "gym-main-team-slot" ||
        String(product.id || "").trim().toLowerCase() === "gym-main-team-slot" ||
        String(product.code || "").trim().toLowerCase() === "slot-de-defesa" ||
        String(product.id || "").trim().toLowerCase() === "slot-de-defesa" ||
        ((Number(product.benefits?.gymMainTeamSlots || 0) > 0 || Number(product.benefits?.gymDefenseSlotsAdded || 0) > 0) &&
          (String(product.benefits?.metadata?.storeCategory || "").trim().toLowerCase() === "gym" ||
            String(product.type || "").trim().toLowerCase().includes("gym") ||
            String(product.code || "").trim().toLowerCase().includes("gym-main-team-slot") ||
            String(product.id || "").trim().toLowerCase().includes("gym-main-team-slot") ||
            String(product.code || "").trim().toLowerCase().includes("slot-de-defesa") ||
            String(product.id || "").trim().toLowerCase().includes("slot-de-defesa") ||
            String(product.name || "").trim().toLowerCase().includes("slot de defesa") ||
            String(product.name || "").trim().toLowerCase().includes("slot do time principal")));
      const isCharacterScopedProduct =
        isGymCharacterSlot ||
        ["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg"].includes(
          String(product.type || "").trim().toLowerCase()
        ) ||
        (String(product.type || "").trim().toLowerCase() === "ticket" &&
          ["biome"].includes(String(product.benefits?.metadata?.ticketSubtype || product.benefits?.metadata?.ticketType || "").trim().toLowerCase()));
      const directCharacterDelivery =
        !!characterId && isCharacterScopedProduct;
      orderRef = adminDb.collection(`players/${uid}/paymentOrders`).doc();
      total = Number((Number(product.price || 0) * qty).toFixed(2));
      itemName = product.name;
      unitPrice = Number(product.price || 0);
      orderItemId = product.id;
      await orderRef.set({
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
        grantType: "product_entitlement" as MonetizationGrantType,
        productType: product.type,
        characterId: characterId || null,
        deliveryScope: directCharacterDelivery ? "character_backpack" : "account",
        productDurationDays,
        productBenefits: product.benefits,
        status: "pending",
        unitPrice: Number(product.price || 0),
        currency: product.currency || "BRL",
        total,
        provider: "mercadopago",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      const [charSnap, itemCfgSnap] = await Promise.all([
        adminDb.doc(`players/${uid}/characters/${characterId}`).get(),
        adminDb.doc(`itemsConfig/${itemId}`).get(),
      ]);

      if (!charSnap.exists) {
        return NextResponse.json({ error: "Personagem nao encontrado." }, { status: 404 });
      }
      if (!itemCfgSnap.exists) {
        return NextResponse.json({ error: "Item nao configurado para loja." }, { status: 404 });
      }

      const cfg = itemCfgSnap.data() as Record<string, unknown>;
      const saleEnabled = Boolean(cfg.saleEnabled);
      const sellMode = String(cfg.sellMode || "game") as SellMode;
      const rawRealPrice = cfg.ecoinPrice ?? cfg.realPrice ?? null;
      const realPrice = rawRealPrice == null ? 0 : Math.max(0, toNumber(rawRealPrice, 0));
      itemName = String(cfg.itemName || itemId);
      unitPrice = realPrice;
      const grantType = (String(cfg.grantType || "inventory") === "biome_access"
        ? "biome_access"
        : "inventory") as GrantType;
      const biomeAccessBiomeId = String(cfg.biomeAccessBiomeId || "").trim().toLowerCase() || null;
      const biomeAccessDurationHours =
        cfg.biomeAccessDurationHours == null ? null : Math.max(1, toNumber(cfg.biomeAccessDurationHours, 24));

      const supportsReal = sellMode === "ecoin" || sellMode === "both" || sellMode === "real";
      if (!saleEnabled || !supportsReal || realPrice <= 0) {
        return NextResponse.json({ error: "Item nao disponivel para pagamento online." }, { status: 400 });
      }
      if (grantType === "biome_access" && !biomeAccessBiomeId) {
        return NextResponse.json({ error: "Item de acesso a bioma sem biomeAccessBiomeId." }, { status: 400 });
      }

      orderRef = adminDb.collection(`players/${uid}/characters/${characterId}/paymentOrders`).doc();
      total = Number((realPrice * qty).toFixed(2));

      await orderRef.set({
        orderId: orderRef.id,
        uid,
        characterId,
        itemId,
        itemName,
        itemKind: String(cfg.category || "") === "pokebola" ? "POKEBALL" : "ITEM",
        itemDescription: String(cfg.descriptionPtBr || cfg.effectPtBr || ""),
        qty,
        method,
        grantType,
        biomeAccessBiomeId,
        biomeAccessDurationHours,
        status: "pending",
        unitPrice: realPrice,
        total,
        provider: "mercadopago",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const baseUrl = resolveBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/payments/webhook/mercadopago`;
    const returnUrl = `${baseUrl}/api/payments/result`;

    if (method === "PIX") {
      const paymentRes = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpAccessToken}`,
          "X-Idempotency-Key": `elodex-pix-${orderRef.id}`,
        },
        body: JSON.stringify({
          transaction_amount: unitPrice * qty,
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
            itemId: orderItemId,
            offerId,
            productId,
            ecoinPackageId,
            qty,
            method,
          },
        }),
        cache: "no-store",
      });

      const paymentData = (await paymentRes.json()) as Record<string, unknown>;
      if (!paymentRes.ok) {
        await orderRef.set(
          {
            status: "failed",
            providerError: paymentData,
            providerErrorMessage:
              String(paymentData.message || paymentData.error || "") ||
              (Array.isArray(paymentData.cause) && paymentData.cause.length
                ? String(
                    ((paymentData.cause[0] as Record<string, unknown>)?.description as string) ||
                      ((paymentData.cause[0] as Record<string, unknown>)?.code as string) ||
                      ""
                  )
                : ""),
            updatedAt: new Date(),
          },
          { merge: true }
        );
        return NextResponse.json(
          { error: "Falha ao criar PIX no Mercado Pago.", details: paymentData },
          { status: 502 }
        );
      }

      const poi = (paymentData.point_of_interaction as Record<string, unknown> | undefined) || {};
      const tx = (poi.transaction_data as Record<string, unknown> | undefined) || {};
      await orderRef.set(
        {
          providerPaymentId: paymentData.id ? String(paymentData.id) : null,
          providerRawStatus: paymentData.status || "pending",
          providerStatusDetail: paymentData.status_detail || null,
          qrCodeBase64: tx.qr_code_base64 || null,
          copiaECola: tx.qr_code || null,
          expiresAt: tx.expiration_date || tx.expires_at || null,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return NextResponse.json({
        ok: true,
        mode: "pix",
        orderId: orderRef.id,
        qrCode_base64: tx.qr_code_base64 || null,
        qrCode: tx.qr_code_base64 || null,
        copiaECola: tx.qr_code || null,
        expiresAt: tx.expiration_date || tx.expires_at || null,
      });
    }

    const preferencePayload: Record<string, unknown> = {
      items: [
        {
          id: orderItemId,
          title: itemName,
          quantity: qty,
          currency_id: "BRL",
          unit_price: unitPrice,
        },
      ],
      external_reference: orderRef.id,
      notification_url: webhookUrl,
      auto_return: "approved",
      back_urls: {
        success: `${returnUrl}?status=success&orderId=${orderRef.id}`,
        failure: `${returnUrl}?status=failure&orderId=${orderRef.id}`,
        pending: `${returnUrl}?status=pending&orderId=${orderRef.id}`,
      },
      payment_methods: methodPaymentRules(method),
      metadata: {
        orderId: orderRef.id,
        uid,
        characterId,
        itemId: orderItemId,
        offerId,
        productId,
        ecoinPackageId,
        qty,
        method,
      },
      statement_descriptor: "ELODEX",
    };
    const paymentRules = methodPaymentRules(method);
    if (paymentRules) {
      preferencePayload.payment_methods = paymentRules;
    }

    const prefRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpAccessToken}`,
      },
      body: JSON.stringify(preferencePayload),
      cache: "no-store",
    });

    const prefData = (await prefRes.json()) as Record<string, unknown>;
    if (!prefRes.ok) {
      await orderRef.set(
        {
          status: "failed",
          providerError: prefData,
          providerErrorMessage:
            String(prefData.message || prefData.error || "") ||
            (Array.isArray(prefData.cause) && prefData.cause.length
              ? String(
                  ((prefData.cause[0] as Record<string, unknown>)?.description as string) ||
                    ((prefData.cause[0] as Record<string, unknown>)?.code as string) ||
                    ""
                )
              : ""),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      return NextResponse.json(
        { error: "Falha ao criar checkout no Mercado Pago.", details: prefData },
        { status: 502 }
      );
    }

    const checkoutUrl = String(prefData.init_point || prefData.sandbox_init_point || "");
    if (!checkoutUrl) {
      return NextResponse.json({ error: "Checkout sem URL retornada pelo gateway." }, { status: 502 });
    }

    await orderRef.set(
      {
        providerPreferenceId: prefData.id || null,
        checkoutUrl,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      mode: "checkout",
      orderId: orderRef.id,
      checkoutUrl,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erro inesperado.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
