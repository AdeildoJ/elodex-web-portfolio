"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizeBadgeRecord, type BadgeRecord } from "@/lib/badgeCatalog";

type GymRow = {
  id: string;
  ownerUid: string;
  ownerCharacterId?: string;
  ownerCharacterName?: string | null;
  name: string;
  gymType: string;
  scenarioThemeId: string;
  primaryBadgeId?: string | null;
  primaryBadgeName?: string | null;
  primaryBadgeBonusType?: string | null;
  primaryBadgeBonusValue?: number | null;
  sourceType: string;
  status: string;
  approved?: boolean;
  active?: boolean;
  storageCount?: number;
  storageLimit?: number;
  mainTeamCount?: number;
  mainTeamSlotLimit?: number;
  badgeCount?: number;
  activeNpcs?: {
    nurse?: boolean;
    police?: boolean;
    additionalNpcCount?: number;
  };
  upgrades?: {
    policeUnlocked?: boolean;
    additionalNpcCount?: number;
    storageSlotsAdded?: number;
    mainTeamSlotsAdded?: number;
    badgeCountAdded?: number;
  };
};

export default function GymAdmin() {
  const [loading, setLoading] = useState(true);
  const [gyms, setGyms] = useState<GymRow[]>([]);
  const [badges, setBadges] = useState<BadgeRecord[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [gymSnap, badgeSnap] = await Promise.all([
          getDocs(collection(db, "gyms")),
          getDocs(collection(db, "badges")),
        ]);
        if (!mounted) return;
        setGyms(
          gymSnap.docs
            .map((row) => ({ id: row.id, ...(row.data() as Omit<GymRow, "id">) }))
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        );
        setBadges(
          badgeSnap.docs
            .map((row) => normalizeBadgeRecord(row.id, row.data()))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Falha ao carregar GYMs.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  function updateGym(id: string, updater: (current: GymRow) => GymRow) {
    setGyms((current) => current.map((gym) => (gym.id === id ? updater(gym) : gym)));
  }

  async function saveGym(gym: GymRow) {
    try {
      setSavingId(gym.id);
      setError(null);
      setSuccess(null);
      await setDoc(doc(db, "gyms", gym.id), { ...gym, updatedAt: serverTimestamp(), updatedAtMs: Date.now() }, { merge: true });
      setSuccess(`GYM ${gym.name} salvo.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao salvar GYM.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300">Carregando GYMs...</section>;
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-100">Gerenciamento de GYM</h2>
        <p className="text-sm text-slate-400">Painel simples para visualizar, aprovar, ajustar limites, badges, NPCs e tema do cenario.</p>
      </div>

      {error ? <div className="mb-3 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div> : null}
      {success ? <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{success}</div> : null}

      {gyms.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-8 text-center text-sm text-slate-400">Nenhum GYM registrado.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {gyms.map((gym) => (
            <article key={gym.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{gym.name}</div>
                  <div className="text-xs text-slate-500">{gym.id} • dono {gym.ownerUid}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${gym.active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
                  {gym.status || "active"}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Nome
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={gym.name} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, name: e.target.value }))} />
                </label>
                <label className="text-sm text-slate-300">
                  Tipo
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={gym.gymType} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, gymType: e.target.value.trim().toLowerCase() }))} />
                </label>
                <label className="text-sm text-slate-300">
                  Fonte
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={gym.sourceType} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, sourceType: e.target.value.trim().toLowerCase() }))} />
                </label>
                <label className="text-sm text-slate-300">
                  Tema
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={gym.scenarioThemeId} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, scenarioThemeId: e.target.value.trim().toLowerCase() }))} />
                </label>
                <label className="text-sm text-slate-300">
                  Insignia principal
                  <select
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={gym.primaryBadgeId || ""}
                    onChange={(e) => {
                      const badgeId = e.target.value;
                      const badge = badges.find((item) => item.id === badgeId) || null;
                      updateGym(gym.id, (current) => ({
                        ...current,
                        primaryBadgeId: badge?.id || null,
                        primaryBadgeName: badge?.name || null,
                        primaryBadgeBonusType: badge?.bonusType || null,
                        primaryBadgeBonusValue: badge?.bonusValue ?? null,
                      }));
                    }}
                  >
                    <option value="">Sem insignia</option>
                    {badges.map((badge) => (
                      <option key={badge.id} value={badge.id}>
                        {badge.name} {badge.isActive ? "" : "(inativa)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Storage limite
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={String(gym.storageLimit ?? 0)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, storageLimit: Math.max(1, Number(e.target.value || 0)) }))} />
                </label>
                <label className="text-sm text-slate-300">
                  Time principal limite
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={String(gym.mainTeamSlotLimit ?? 0)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, mainTeamSlotLimit: Math.max(1, Number(e.target.value || 0)) }))} />
                </label>
                <label className="text-sm text-slate-300">
                  Insignias
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={String(gym.badgeCount ?? 0)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, badgeCount: Math.max(0, Number(e.target.value || 0)) }))} />
                </label>
                <label className="text-sm text-slate-300">
                  NPC extra
                  <input className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm" value={String(gym.activeNpcs?.additionalNpcCount ?? 0)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, activeNpcs: { ...(current.activeNpcs || {}), additionalNpcCount: Math.max(0, Number(e.target.value || 0)) } }))} />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={Boolean(gym.active)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, active: e.target.checked, status: e.target.checked ? "active" : "inactive" }))} />
                  GYM ativo
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={Boolean(gym.approved)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, approved: e.target.checked }))} />
                  Aprovado
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={Boolean(gym.activeNpcs?.nurse)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, activeNpcs: { ...(current.activeNpcs || {}), nurse: e.target.checked } }))} />
                  Enfermeira ativa
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={Boolean(gym.activeNpcs?.police)} onChange={(e) => updateGym(gym.id, (current) => ({ ...current, activeNpcs: { ...(current.activeNpcs || {}), police: e.target.checked } }))} />
                  Policial ativo
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
                <div>Storage atual: <b>{gym.storageCount ?? 0}</b> / limite <b>{gym.storageLimit ?? 0}</b></div>
                <div>Time atual: <b>{gym.mainTeamCount ?? 0}</b> / limite <b>{gym.mainTeamSlotLimit ?? 0}</b></div>
                <div>Insignia principal: <b>{gym.primaryBadgeName || "Nao vinculada"}</b>{gym.primaryBadgeBonusType ? ` • ${gym.primaryBadgeBonusType} ${gym.primaryBadgeBonusValue ?? 0}%` : ""}</div>
                <div>Upgrades: storage +{gym.upgrades?.storageSlotsAdded ?? 0}, time +{gym.upgrades?.mainTeamSlotsAdded ?? 0}, badges +{gym.upgrades?.badgeCountAdded ?? 0}</div>
              </div>

              <div className="mt-4 flex justify-end">
                <button onClick={() => saveGym(gym)} disabled={savingId === gym.id} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  {savingId === gym.id ? "Salvando..." : "Salvar GYM"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
