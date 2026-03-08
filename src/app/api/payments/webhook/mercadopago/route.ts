import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebaseAdmin";
import { FieldPath } from "firebase-admin/firestore";

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
    .where(FieldPath.documentId(), "==", orderId)
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
