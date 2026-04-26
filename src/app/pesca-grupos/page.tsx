"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import { db } from "@/lib/firebase";
import Link from "next/link";

type SpeciesOption = { id: number; label: string };

type FishingRow = {
  key: string;
  speciesId: string;
  minSlowpokeLevel: string;
  weight: string;
  successRatePercent: string;
  fishingOnly: boolean;
  baitTag: string;
};

type GroupListItem = { id: string; name: string; speciesCount: number };

const emptyRow = (): FishingRow => ({
  key: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  speciesId: "",
  minSlowpokeLevel: "1",
  weight: "10",
  successRatePercent: "50",
  fishingOnly: false,
  baitTag: "",
});

function parseRows(raw: unknown): FishingRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FishingRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const speciesId = Math.max(0, Math.trunc(Number(o.speciesId ?? o.id ?? 0)));
    out.push({
      key: `r-${Date.now()}-${out.length}`,
      speciesId: speciesId ? String(speciesId) : "",
      minSlowpokeLevel: String(Math.max(0, Math.trunc(Number(o.minSlowpokeLevel ?? o.minSlowpoke ?? 1)))),
      weight: String(Math.max(1, Math.trunc(Number(o.weight ?? 0)) || 10)),
      successRatePercent: String(
        Math.max(0, Math.min(100, Number(o.successRatePercent ?? o.successRate ?? 50))),
      ),
      fishingOnly: o.fishingOnly === true || o.fishingOnly === "true",
      baitTag:
        typeof o.baitTag === "string"
          ? o.baitTag
          : typeof o.baitGroupId === "string"
            ? String(o.baitGroupId)
            : "",
    });
  }
  return out;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

export default function PescaGruposPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<GroupListItem[]>([]);
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [rows, setRows] = useState<FishingRow[]>([emptyRow()]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const snap = await getDocs(collection(db, "fishingGroups"));
      const list: GroupListItem[] = snap.docs
        .map((d) => {
          const data = d.data() as { name?: string; fishingSpecies?: unknown[] };
          const arr = Array.isArray(data.fishingSpecies) ? data.fishingSpecies : [];
          return {
            id: d.id,
            name: String(data.name || d.id).trim() || d.id,
            speciesCount: arr.length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setItems(list);
    } catch (e) {
      console.error(e);
      setErrorMsg("Nao foi possivel carregar os grupos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/catalog/options.json", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { species?: SpeciesOption[] };
        setSpeciesOptions(Array.isArray(data.species) ? data.species : []);
      } catch {
        setSpeciesOptions([]);
      }
    })();
  }, []);

  function openNew() {
    setEditingId(null);
    setFormId("");
    setFormName("");
    setRows([emptyRow()]);
    setErrorMsg(null);
    setFeedbackMsg(null);
    setModalOpen(true);
  }

  function openEdit(item: GroupListItem) {
    setErrorMsg(null);
    setFeedbackMsg(null);
    setEditingId(item.id);
    setFormId(item.id);
    setFormName(item.name);
    setModalOpen(true);
    void (async () => {
      try {
        const snap = await getDoc(doc(db, "fishingGroups", item.id));
        if (!snap.exists()) {
          setRows([emptyRow()]);
          return;
        }
        const data = snap.data() as { name?: string; fishingSpecies?: unknown };
        setFormName(String(data.name || item.name));
        const parsed = parseRows(data.fishingSpecies);
        setRows(parsed.length ? parsed : [emptyRow()]);
      } catch {
        setRows([emptyRow()]);
      }
    })();
  }

  function patchRow(key: string, patch: Partial<FishingRow>) {
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((p) => [...p, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((p) => (p.length <= 1 ? p : p.filter((r) => r.key !== key)));
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
  }

  async function handleSave() {
    setErrorMsg(null);
    const name = formName.trim();
    if (name.length < 2) {
      setErrorMsg("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    const id = editingId || slugify(formId || name);
    if (!id || id.length < 2) {
      setErrorMsg("ID invalido. Use letras, numeros e hifens (ex: lago-azul-1).");
      return;
    }
    const fishingSpecies = rows
      .map((r) => {
        const speciesId = Math.max(0, Math.trunc(Number(r.speciesId)));
        if (!speciesId) return null;
        const tag = String(r.baitTag || "").trim().toLowerCase();
        return {
          speciesId,
          minSlowpokeLevel: Math.max(0, Math.trunc(Number(r.minSlowpokeLevel) || 1)),
          weight: Math.max(1, Math.trunc(Number(r.weight) || 10)),
          successRatePercent: Math.max(0, Math.min(100, Number(r.successRatePercent) || 50)),
          fishingOnly: !!r.fishingOnly,
          ...(tag ? { baitTag: tag } : {}),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
    if (!fishingSpecies.length) {
      setErrorMsg("Adicione ao menos uma especie com ID valido.");
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, "fishingGroups", id),
        {
          id,
          name,
          fishingSpecies,
          updatedAt: serverTimestamp(),
          ...(editingId ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
      setFeedbackMsg("Grupo salvo.");
      setModalOpen(false);
      setEditingId(null);
      await loadGroups();
    } catch (e) {
      console.error(e);
      setErrorMsg("Falha ao salvar. Verifique permissoes e conexao.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir o grupo "${name}"? NPCs pescadores que usam este ID precisarao ser atualizados.`)) return;
    try {
      await deleteDoc(doc(db, "fishingGroups", id));
      setFeedbackMsg("Grupo removido.");
      await loadGroups();
    } catch (e) {
      console.error(e);
      setErrorMsg("Nao foi possivel excluir.");
    }
  }

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6 md:px-6">
          <header className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-300">Cadastros</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Grupos de pesca</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Registro central dos <b>grupos de pesca</b> (tabela por grupo). Vincule estes IDs em{" "}
              <Link className="text-cyan-300 underline" href="/npc">
                NPC (Pescador)
              </Link>{" "}
              e/ou no{" "}
              <Link className="text-cyan-300 underline" href="/biomas">
                bioma
              </Link>{" "}
              com &quot;Permite pesca&quot;. A pesca natural (Slowpoke) usa o bioma; o modo pelo Pescador usa a união
              dos grupos marcados no NPC.
            </p>
            <button
              type="button"
              onClick={openNew}
              className="mt-4 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-black uppercase tracking-[0.15em] text-slate-950 hover:bg-cyan-300"
            >
              Novo grupo
            </button>
          </header>

          {feedbackMsg ? (
            <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {feedbackMsg}
            </div>
          ) : null}
          {errorMsg && !modalOpen ? (
            <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{errorMsg}</div>
          ) : null}

          <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-4">
            {loading ? (
              <p className="text-sm text-slate-400">Carregando…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum grupo. Clique em Novo grupo.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3"
                  >
                    <div>
                      <p className="font-bold text-white">{g.name}</p>
                      <p className="text-xs text-slate-400">
                        <code className="rounded bg-black/30 px-1">{g.id}</code> · {g.speciesCount} especies
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(g)}
                        className="rounded-xl border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(g.id, g.name)}
                        className="rounded-xl border border-red-500/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
                      >
                        Excluir
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div
              className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
              role="dialog"
            >
              <h2 className="text-lg font-bold text-white">{editingId ? "Editar grupo" : "Novo grupo"}</h2>
              {errorMsg ? <p className="mt-2 text-sm text-red-300">{errorMsg}</p> : null}

              <div className="mt-4 space-y-3">
                {editingId ? (
                  <p className="text-xs text-slate-400">
                    ID: <code className="text-cyan-200">{editingId}</code> (fixo)
                  </p>
                ) : (
                  <label className="block text-xs font-semibold uppercase text-slate-400">
                    ID (slug, ex: rio-cristalino)
                    <input
                      value={formId}
                      onChange={(e) => setFormId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      placeholder="rio-cristalino"
                    />
                  </label>
                )}
                <label className="block text-xs font-semibold uppercase text-slate-400">
                  Nome exibido
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    placeholder="Rio Cristalino"
                  />
                </label>
              </div>

              <div className="mt-4 space-y-2 rounded-2xl border border-sky-900/50 bg-slate-950/70 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Especies (Firestore: fishingSpecies)</span>
                  <button
                    type="button"
                    onClick={addRow}
                    className="rounded-md bg-sky-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-600"
                  >
                    Adicionar linha
                  </button>
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {rows.map((row) => (
                    <div
                      key={row.key}
                      className="grid gap-2 rounded border border-slate-800 bg-slate-900/80 p-2 text-[11px] text-slate-200 sm:grid-cols-2 lg:grid-cols-3"
                    >
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-slate-500">Pokemon</span>
                        <select
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          value={row.speciesId}
                          onChange={(e) => patchRow(row.key, { speciesId: e.target.value })}
                        >
                          <option value="">Especie</option>
                          {speciesOptions.map((s) => (
                            <option key={s.id} value={String(s.id)}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-slate-500">Nv. min. Slowpoke</span>
                        <input
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          value={row.minSlowpokeLevel}
                          onChange={(e) => patchRow(row.key, { minSlowpokeLevel: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-slate-500">Peso</span>
                        <input
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          value={row.weight}
                          onChange={(e) => patchRow(row.key, { weight: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-slate-500">Taxa sucesso %</span>
                        <input
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          value={row.successRatePercent}
                          onChange={(e) => patchRow(row.key, { successRatePercent: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-slate-500">Tag isca (opcional)</span>
                        <input
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          value={row.baitTag}
                          onChange={(e) => patchRow(row.key, { baitTag: e.target.value })}
                        />
                      </label>
                      <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-end">
                        <label className="flex items-center gap-2 text-[11px] text-slate-300">
                          <input
                            type="checkbox"
                            checked={row.fishingOnly}
                            onChange={(e) => patchRow(row.key, { fishingOnly: e.target.checked })}
                          />
                          So por pesca
                        </label>
                        <button
                          type="button"
                          className="text-red-300 hover:text-red-200"
                          onClick={() => removeRow(row.key)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </RequireAuth>
  );
}
