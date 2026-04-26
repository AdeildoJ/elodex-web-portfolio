import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  query,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  DEFAULT_MONETIZATION_PRODUCTS,
  MONETIZATION_PRODUCT_SEED_IDS,
  DEFAULT_VIP_PLANS,
  type MonetizationProductDoc,
  type VipPlanDoc,
  normalizeMonetizationProduct,
  normalizeVipPlan,
  serializeMonetizationProduct,
} from "@/lib/monetizationCatalog";

export async function ensureDefaultMonetizationCatalog() {
  const [vipSnap, productSnap] = await Promise.all([
    getDocs(query(collection(db, "vipPlans"))),
    getDocs(query(collection(db, "monetizationProducts"))),
  ]);

  const vipIds = new Set(vipSnap.docs.map((row) => row.id));
  const productIds = new Set(productSnap.docs.map((row) => row.id));

  await Promise.all(
    DEFAULT_VIP_PLANS.filter((plan) => !vipIds.has(plan.id)).map((plan) =>
      setDoc(
        doc(db, "vipPlans", plan.id),
        {
          ...plan,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );

  try {
    await Promise.all(
      DEFAULT_MONETIZATION_PRODUCTS.filter((p) => !productIds.has(p.id)).map((p) =>
        setDoc(
          doc(db, "monetizationProducts", p.id),
          {
            ...serializeMonetizationProduct(p),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      )
    );
  } catch (e) {
    console.error("ensureDefaultMonetizationCatalog products seed", e);
  }
}

export async function loadVipPlans(includeInactive = true) {
  const snap = await getDocs(query(collection(db, "vipPlans")));
  return snap.docs
    .map((docSnap) => normalizeVipPlan(docSnap.data() as Omit<VipPlanDoc, "id">, docSnap.id))
    .filter((plan) => includeInactive || plan.status === "active")
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

export async function loadMonetizationProducts(includeInactive = true) {
  const snap = await getDocs(query(collection(db, "monetizationProducts")));
  return snap.docs
    .map((docSnap) => normalizeMonetizationProduct(docSnap.data() as Omit<MonetizationProductDoc, "id">, docSnap.id))
    .filter((product) => includeInactive || product.status === "active")
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

export async function purgeSeededMonetizationProducts() {
  await Promise.all(
    MONETIZATION_PRODUCT_SEED_IDS.map((id) => deleteDoc(doc(db, "monetizationProducts", id)))
  );
}
