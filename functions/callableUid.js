const { HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");

/**
 * Callable no React Native às vezes chega com request.auth vazio mesmo com usuário logado.
 * Aceita idToken no payload (verificado no servidor) como fallback.
 */
async function resolveCallableUid(request) {
  if (request.auth?.uid) {
    logger.info("[callableUid] request.auth presente", { hasAuth: true, hasIdToken: false, resolvedUid: request.auth.uid });
    return request.auth.uid;
  }
  const data = request.data;
  const rawFromBody = data && typeof data === "object" && data !== null ? data.idToken : undefined;
  const rawFromNestedBody =
    data && typeof data === "object" && data !== null && typeof data.data === "object" && data.data !== null
      ? data.data.idToken
      : undefined;
  const authHeader = request.rawRequest?.headers?.authorization || request.rawRequest?.headers?.Authorization || "";
  const rawFromHeader = typeof authHeader === "string" ? authHeader.trim() : "";
  const rawCandidate = rawFromBody || rawFromNestedBody || rawFromHeader;
  const token = typeof rawCandidate === "string" ? rawCandidate.trim().replace(/^Bearer\s+/i, "") : "";
  logger.info("[callableUid] fallback por idToken", {
    hasAuth: false,
    hasIdToken: !!token,
    hasHeaderAuth: typeof rawFromHeader === "string" && rawFromHeader.length > 0,
  });
  if (!token) throw new HttpsError("unauthenticated", "Login necessario.");
  try {
    const decoded = await getAuth().verifyIdToken(token, false);
    logger.info("[callableUid] idToken validado", { hasAuth: false, hasIdToken: true, resolvedUid: decoded.uid });
    return decoded.uid;
  } catch (err) {
    logger.error("[callableUid] falha ao validar idToken", {
      hasAuth: false,
      hasIdToken: true,
      code: err?.code || null,
      message: err?.message || String(err),
    });
    throw new HttpsError("unauthenticated", "Login necessario.");
  }
}

module.exports = { resolveCallableUid };
