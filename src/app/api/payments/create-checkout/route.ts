import { NextRequest, NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

type OnlineMethod = "PIX" | "CREDIT" | "DEBIT";
type SellMode = "game" | "ecoin" | "both" | "real";
type GrantType = "inventory" | "biome_access";

type RequestBody = {
  itemId?: string;
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

export async function POST(req: NextRequest) {
  try {
    const token = parseAuthToken(req);
    if (!token) return NextResponse.json({ error: "Token ausente." }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;
    if (!uid) return NextResponse.json({ error: "Token invalido." }, { status: 401 });

    const body = (await req.json()) as RequestBody;
    const itemId = String(body.itemId || "").trim();
    const characterId = String(body.characterId || "").trim();
    const qty = Math.max(1, Math.floor(toNumber(body.qty, 1)));
    const method = String(body.method || "").toUpperCase() as OnlineMethod;

    if (!itemId || !characterId) {
      return NextResponse.json({ error: "itemId e characterId sao obrigatorios." }, { status: 400 });
    }
    if (!["PIX", "CREDIT", "DEBIT"].includes(method)) {
      return NextResponse.json({ error: "Metodo invalido." }, { status: 400 });
    }

    const mpAccessToken = process.env.MP_ACCESS_TOKEN || "";
    if (!mpAccessToken) {
      return NextResponse.json({ error: "MP_ACCESS_TOKEN nao configurado." }, { status: 500 });
    }

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
    const itemName = String(cfg.itemName || itemId);
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

    const orderRef = adminDb.collection(`players/${uid}/characters/${characterId}/paymentOrders`).doc();
    const total = Number((realPrice * qty).toFixed(2));

    await orderRef.set({
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

    const baseUrl = resolveBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/payments/webhook/mercadopago`;
    const returnUrl = `${baseUrl}/api/payments/result`;

    const preferencePayload = {
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
        success: `${returnUrl}?status=success&orderId=${orderRef.id}`,
        failure: `${returnUrl}?status=failure&orderId=${orderRef.id}`,
        pending: `${returnUrl}?status=pending&orderId=${orderRef.id}`,
      },
      payment_methods: methodPaymentRules(method),
      metadata: {
        orderId: orderRef.id,
        uid,
        characterId,
        itemId,
        qty,
        method,
      },
    };

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
      orderId: orderRef.id,
      checkoutUrl,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erro inesperado.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
