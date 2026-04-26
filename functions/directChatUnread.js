const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");

const REGION = "southamerica-east1";

/**
 * Incrementa leitura pendente para cada participante do chat exceto o remetente.
 * O cliente usa `players/{uid}/socialUnread/{chatId}` para badge na lista de amigos.
 */
exports.onDirectChatMessageCreated = onDocumentCreated(
  {
    document: "directChats/{chatId}/messages/{messageId}",
    region: REGION,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const chatId = String(event.params.chatId || "").trim();
    const messageId = String(event.params.messageId || "").trim();
    if (!chatId || !messageId || messageId === "_meta") return;

    const msg = snap.data() || {};
    const senderUid = String(msg.senderUid || "").trim();
    if (!senderUid) return;

    const db = getFirestore();
    try {
      const chatSnap = await db.doc(`directChats/${chatId}`).get();
      if (!chatSnap.exists) return;
      const participants = Array.isArray(chatSnap.data()?.participantUids)
        ? chatSnap.data().participantUids.map(String).filter(Boolean)
        : [];
      if (participants.length < 2) return;

      const displayNames = chatSnap.data()?.displayNames && typeof chatSnap.data().displayNames === "object"
        ? chatSnap.data().displayNames
        : {};
      const fromName = String(displayNames[senderUid] || senderUid).slice(0, 48);
      const preview = String(msg.text || "").slice(0, 120);

      const batch = db.batch();
      for (const uid of participants) {
        if (uid === senderUid) continue;
        const ref = db.doc(`players/${uid}/socialUnread/${chatId}`);
        batch.set(
          ref,
          {
            chatId,
            fromUid: senderUid,
            fromName,
            lastPreview: preview,
            unreadCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    } catch (e) {
      logger.error("onDirectChatMessageCreated_failed", { chatId, err: e?.message || String(e) });
    }
  }
);
