import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { MissionEventDoc } from "./missionsTypes";

const COL = "missionsEvents";

export async function listMissionsEvents() {
  const q = query(collection(db, COL), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);

  const list: MissionEventDoc[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  return list;
}

export async function createMissionEvent(payload: MissionEventDoc) {
  const docRef = await addDoc(collection(db, COL), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateMissionEvent(id: string, payload: Partial<MissionEventDoc>) {
  const ref = doc(db, COL, id);
  await updateDoc(ref, {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function removeMissionEvent(id: string) {
  await deleteDoc(doc(db, COL, id));
}
