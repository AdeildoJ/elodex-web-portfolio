import { NextRequest, NextResponse } from "next/server";

import { grantProductReward, grantVipIncludedRewards } from "@/lib/accountRewardGrants";
import { adminDb } from "@/lib/firebaseAdmin";

function readPaymentId(req: NextRequest, body: Record<string, unknown>) {
  const fromQuery =
    req.nextUrl.searchParams.get("data.id") ||
    req.nextUrl.searchParams.get("id") ||
    req.nextUrl.searchParams.get("resource");

  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
  if (typeof body?.data === "object" && body.data && "id" in body.data) {
    const id = String((body.data as { id?: unknown }).id || "");
    if (/^\d+$/.test(id)) return id;
  }
  return null;
}

async function resolvePaymentFromMercadoPago(paymentId: string) {
  const mpAccessToken = process.env.MP_ACCESS_TOKEN || "";
  if (!mpAccessToken) throw new Error("MP_ACCESS_TOKEN nao configurado.");

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${mpAccessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Mercado Pago erro ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function findOrderRefById(orderId: string) {
  const snap = await adminDb
    .collectionGroup("paymentOrders")
    .where("orderId", "==", orderId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].ref;
}

function mapStatus(mpStatus: string) {
  const s = String(mpStatus || "").toLowerCase();
  if (s === "approved") return "approved";
  if (["rejected", "cancelled", "cancelled_by_user"].includes(s)) return "canceled";
  if (["in_process", "pending", "authorized"].includes(s)) return "pending";
  return "failed";
}

function parseMetadataList(value: unknown) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function processWebhook(req: NextRequest, body: Record<string, unknown>) {
  const paymentId = readPaymentId(req, body);
  if (!paymentId) return NextResponse.json({ ok: true, skipped: "no-payment-id" });

  const payment = await resolvePaymentFromMercadoPago(paymentId);
  const externalReference = String(payment.external_reference || "");
  if (!externalReference) return NextResponse.json({ ok: true, skipped: "no-external-reference" });

  const orderRef = await findOrderRefById(externalReference);
  if (!orderRef) return NextResponse.json({ ok: true, skipped: "order-not-found" });

  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return NextResponse.json({ ok: true, skipped: "order-missing" });

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

  const updatedOrderSnap = await orderRef.get();
  const orderData = updatedOrderSnap.data() || {};
  if (status === "approved" && !orderData.deliveredAt && orderData.grantType === "ecoin_purchase") {
    const playerUid = String(orderData.uid || "");
    const amount = Math.max(0, Number(orderData.ecoinAmount || 0));
    const playerRef = adminDb.doc(`players/${playerUid}`);
    const historyRef = adminDb.collection(`players/${playerUid}/monetizationHistory`).doc();

    await adminDb.runTransaction(async (tx) => {
      const [playerSnap, freshOrderSnap] = await Promise.all([tx.get(playerRef), tx.get(orderRef)]);
      const freshOrder = freshOrderSnap.data() || {};
      if (freshOrder.deliveredAt) return;
      const currentBalance = Math.max(0, Number(playerSnap.data()?.ecoinBalance || 0));
      tx.set(
        playerRef,
        {
          ecoinBalance: currentBalance + amount,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      tx.set(historyRef, {
        type: "purchase",
        source: "mercadopago",
        status: "active",
        itemId: String(freshOrder.ecoinPackageId || freshOrder.itemId || ""),
        itemType: "product",
        itemName: String(freshOrder.itemName || "ECoins"),
        amountPaid: Math.max(0, Number(freshOrder.totalPaid || freshOrder.total || 0)),
        currency: "BRL",
        ecoinAmount: amount,
        orderId: String(freshOrder.orderId || orderRef.id),
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
  } else if (status === "approved" && !orderData.deliveredAt && orderData.grantType === "vip_subscription") {
    const playerUid = String(orderData.uid || "");
    const vipDays = Math.max(1, Math.floor(Number(orderData.vipDays || 30)));
    const qty = Math.max(1, Math.floor(Number(orderData.qty || 1)));
    const playerRef = adminDb.doc(`players/${playerUid}`);
    const historyRef = adminDb.collection(`players/${playerUid}/monetizationHistory`).doc();
    const startedAtMs = Date.now();

    await adminDb.runTransaction(async (tx) => {
      const [playerSnap, freshOrderSnap] = await Promise.all([tx.get(playerRef), tx.get(orderRef)]);
      const freshOrder = freshOrderSnap.data() || {};
      if (freshOrder.deliveredAt) return;
      const prevExpires = Number(playerSnap.data()?.vipExpiresAtMs || 0);
      const baseMs = Math.max(startedAtMs, prevExpires);
      const vipExpiresAtMs = baseMs + vipDays * qty * 24 * 60 * 60 * 1000;
      const vipPlanId = String(freshOrder.vipPlanId || freshOrder.offerId || freshOrder.itemId || "");
      const vipPlanCode = String(freshOrder.vipPlanCode || freshOrder.offerId || vipPlanId || "");
      const vipPlanName = String(freshOrder.itemName || "VIP");
      const vipBenefits = (freshOrder.vipBenefits || null) as Record<string, unknown> | null;
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
        playerRef,
        uid: playerUid,
        includedItems: Array.isArray(freshOrder.vipIncludedItems) ? freshOrder.vipIncludedItems : [],
        sourceOrderId: String(freshOrder.orderId || orderRef.id),
        sourcePlanId: vipPlanId,
        sourcePlanCode: vipPlanCode,
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
  } else if (status === "approved" && !orderData.deliveredAt && orderData.grantType === "product_entitlement") {
    const playerUid = String(orderData.uid || "");
    const playerRef = adminDb.doc(`players/${playerUid}`);
    const entitlementId = String(orderData.productId || orderData.itemId || orderRef.id);
    const historyRef = adminDb.collection(`players/${playerUid}/monetizationHistory`).doc();
    const qty = Math.max(1, Math.floor(Number(orderData.qty || 1)));
    const durationDays = orderData.productDurationDays == null ? null : Math.max(1, Number(orderData.productDurationDays || 1));
    const baseMs = Date.now();
    const validUntilMs = durationDays ? baseMs + durationDays * qty * 24 * 60 * 60 * 1000 : null;

    await adminDb.runTransaction(async (tx) => {
      const freshOrderSnap = await tx.get(orderRef);
      const freshOrder = freshOrderSnap.data() || {};
      if (freshOrder.deliveredAt) return;

      tx.set(
        playerRef,
        {
          updatedAt: new Date(),
        },
        { merge: true }
      );
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
          benefits:
            freshOrder.productBenefits && typeof freshOrder.productBenefits === "object"
              ? (freshOrder.productBenefits as Record<string, unknown>)
              : null,
          durationDays,
        },
      });
      if (String(freshOrder.productType || "") === "trainer_license") {
        const benefits =
          freshOrder.productBenefits && typeof freshOrder.productBenefits === "object"
            ? (freshOrder.productBenefits as Record<string, unknown>)
            : {};
        const metadata =
          benefits.metadata && typeof benefits.metadata === "object"
            ? (benefits.metadata as Record<string, unknown>)
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

  return NextResponse.json({ ok: true, status });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return processWebhook(req, body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erro no webhook.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    return processWebhook(req, {});
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erro no webhook GET.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
