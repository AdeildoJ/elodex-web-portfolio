import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const status = String(req.nextUrl.searchParams.get("status") || "pending").toLowerCase();
  const orderId = String(req.nextUrl.searchParams.get("orderId") || "");

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

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

