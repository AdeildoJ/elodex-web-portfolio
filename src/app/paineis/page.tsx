"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import { db, app, auth } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import GymAdmin from "@/components/gym/GymAdmin";

type PanelKey = "capturas" | "compras" | "gym";

// ================================
// CAPTURAS
// ================================
interface PokedexCaptureConfig {
  id: string;
  speciesId: string;
  speciesName?: string | null;
  captureLimit: number | null;
  specialCount: number | null;
}

interface CaptureInstance {
  id: string;
  speciesId: string;
  trainerId: string;
  capturedAt?: Date;
  isSpecialCapture: boolean;
}

interface PanelRow {
  config: PokedexCaptureConfig;
  captures: CaptureInstance[];
}

// ================================
// COMPRAS
// ================================
type SellMode = "game" | "ecoin" | "both";

interface ItemSaleConfig {
  id: string;
  saleEnabled: boolean;
  sellMode: SellMode;
  gamePrice: number | null;
  ecoinPrice: number | null;
  realPrice?: number | null;
  saleStartedAt?: Date | null;
  updatedAt?: Date | null;
}

interface PurchaseRow {
  txId: string;
  buyerUid: string;
  itemId: string;
  quantity: number;
  createdAt?: Date;
}

interface ItemSalesSummary {
  itemId: string;
  config: ItemSaleConfig;
  totalSold: number;
  buyersCount: number;
  purchases: PurchaseRow[];
}

// ================================
// Helpers
// ================================
function parseBuyerUidFromPath(path: string) {
  // path: "users/{uid}/transactions/{txId}"
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return "desconhecido";
}

function parseTrainerUidFromPath(path: string) {
  const parts = path.split("/");
  const usersIdx = parts.indexOf("users");
  if (usersIdx >= 0 && parts[usersIdx + 1]) return parts[usersIdx + 1];
  const playersIdx = parts.indexOf("players");
  if (playersIdx >= 0 && parts[playersIdx + 1]) return parts[playersIdx + 1];
  return "desconhecido";
}

function toDateMaybe(ts: any): Date | undefined {
  if (!ts) return undefined;
  if (typeof ts.toDate === "function") return ts.toDate();
  return undefined;
}

function isPermissionError(e: any) {
  const msg = String(e?.message || "");
  const code = String(e?.code || "");
  return (
    msg.includes("Missing or insufficient permissions") ||
    code.includes("permission-denied")
  );
}

function getSellModeLabel(mode: SellMode) {
  if (mode === "game") return "Moedas do jogo";
  if (mode === "ecoin") return "Dinheiro real";
  return "Ambos";
}

/**
 * ✅ GARANTE TOKEN ATUAL + RETORNA CLAIMS
 * - força refresh do token
 * - lê getIdTokenResult(true) para pegar claims atuais
 */
async function ensureFreshTokenWithClaims() {
  const user = auth.currentUser;
  if (!user) return null;

  await user.getIdToken(true);
  const token = await user.getIdTokenResult(true);

  return {
    uid: user.uid,
    email: user.email,
    claims: token.claims as any,
  };
}

export default function PaineisPage() {
  const [activePanel, setActivePanel] = useState<PanelKey>("capturas");
  const [authUid, setAuthUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [authReady, setAuthReady] = useState(false);
  const [authIsAdmin, setAuthIsAdmin] = useState(false);
  const [speciesNameMap, setSpeciesNameMap] = useState<Record<string, string>>({});

  // capturas
  const [rows, setRows] = useState<PanelRow[]>([]);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  // compras
  const [sales, setSales] = useState<ItemSalesSummary[]>([]);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // DEBUG
  const [debug, setDebug] = useState<{
    projectId?: string;
    uid?: string;
    email?: string | null;
    isAdmin?: boolean;
    step?: string;
    lastError?: string;
  }>({ projectId: app?.options?.projectId });

  const effectiveHeaderTitle =
    activePanel === "capturas" ? "Painel de Capturas" : activePanel === "compras" ? "Painel de Compras" : "Painel de GYM";
  const effectiveHeaderSubtitle =
    activePanel === "capturas"
      ? "Visão geral das configurações de captura e das instâncias já registradas."
      : activePanel === "compras"
      ? "Visão geral dos itens à venda e do histórico de compras."
      : "Listagem e ajustes simples dos GYMs cadastrados.";

  const adminLabel = useMemo(() => {
    if (debug.isAdmin === true) return "SIM";
    if (debug.isAdmin === false) return "NÃO";
    return "—";
  }, [debug.isAdmin]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUid(user?.uid ?? null);
      if (!user) {
        setAuthIsAdmin(false);
        setAuthReady(true);
        return;
      }
      try {
        const token = await user.getIdTokenResult(true);
        setAuthIsAdmin(token?.claims?.admin === true);
      } catch {
        setAuthIsAdmin(false);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/catalog/options.json", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          species?: Array<{ id: number; label: string }>;
        };
        const map: Record<string, string> = {};
        for (const row of data.species || []) {
          const key = String(row.id);
          const label = String(row.label || "").trim();
          map[key] = label.replace(/^#\d+\s+/, "").trim() || `#${key}`;
        }
        if (alive) setSpeciesNameMap(map);
      } catch {
        if (alive) setSpeciesNameMap({});
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ================================
  // Load Capturas
  // ================================
  useEffect(() => {
    if (activePanel !== "capturas") return;
    if (!authReady || !authIsAdmin) return;
    if (!authUid) return;

    let alive = true;

    (async () => {
      try {
        setLoadingError(null);
        setDebug((d) => ({ ...d, step: "token_capturas", lastError: "" }));

        const t = await ensureFreshTokenWithClaims();
        if (!t) {
          if (!alive) return;
          setDebug((d) => ({ ...d, step: "aguardando_auth" }));
          return;
        }
        if (!alive) return;

        setDebug((d) => ({
          ...d,
          uid: t.uid,
          email: t.email,
          isAdmin: t.claims?.admin === true,
        }));

        setDebug((d) => ({ ...d, step: "lendo_pokedexConfig" }));

        // 1) Ler configs de captura
        const cfgSnap = await getDocs(collection(db, "pokedexConfig"));
        const configs: PokedexCaptureConfig[] = [];

        cfgSnap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const speciesId = (data.speciesId ?? docSnap.id).toString();

          configs.push({
            id: docSnap.id,
            speciesId,
            speciesName: data.speciesName ?? null,
            captureLimit:
              typeof data.captureLimit === "number"
                ? data.captureLimit
                : data.captureLimit != null
                ? Number(data.captureLimit)
                : null,
            specialCount:
              typeof data.specialCount === "number"
                ? data.specialCount
                : data.specialCount != null
                ? Number(data.specialCount)
                : null,
          });
        });

        if (!alive) return;

        if (configs.length === 0) {
          setRows([]);
          setDebug((d) => ({ ...d, step: "ok_sem_configs" }));
          return;
        }

        // 2) Para cada config, buscar instâncias em pokemonInstances
        setDebug((d) => ({ ...d, step: "lendo_capturas_multifonte" }));

        const rowsFinal: PanelRow[] = [];
        let canReadLegacy = true;
        let canReadTimeGroup = true;
        let canReadBoxGroup = true;
        let warnedLegacy = false;
        let warnedTime = false;
        let warnedBox = false;

        async function readDocsSafely(
          source: "legacy" | "time" | "box",
          fieldName: "speciesId" | "capturedSpeciesId",
          speciesValue: number | string
        ) {
          try {
            if (source === "legacy") {
              if (!canReadLegacy) return [];
              const snap = await getDocs(
                query(
                  collection(db, "pokemonInstances"),
                  where(fieldName, "==", speciesValue)
                )
              );
              return snap.docs;
            }
            if (source === "time") {
              if (!canReadTimeGroup) return [];
              const snap = await getDocs(
                query(
                  collectionGroup(db, "time"),
                  where(fieldName, "==", speciesValue)
                )
              );
              return snap.docs;
            }
            if (!canReadBoxGroup) return [];
            const snap = await getDocs(
              query(
                collectionGroup(db, "box"),
                where(fieldName, "==", speciesValue)
              )
            );
            return snap.docs;
          } catch (e: any) {
            if (!isPermissionError(e)) throw e;
            if (source === "legacy") {
              canReadLegacy = false;
              if (!warnedLegacy) {
                warnedLegacy = true;
                console.warn("[Painéis] Sem permissão para ler pokemonInstances. Continuando sem essa fonte.");
              }
            } else if (source === "time") {
              canReadTimeGroup = false;
              if (!warnedTime) {
                warnedTime = true;
                console.warn("[Painéis] Sem permissão para collectionGroup(time). Continuando sem essa fonte.");
              }
            } else {
              canReadBoxGroup = false;
              if (!warnedBox) {
                warnedBox = true;
                console.warn("[Painéis] Sem permissão para collectionGroup(box). Continuando sem essa fonte.");
              }
            }
            return [];
          }
        }

        for (const cfg of configs) {
          try {
            const speciesNum = Number(cfg.speciesId);
            const queryValues: Array<number | string> = [];
            if (!Number.isNaN(speciesNum)) queryValues.push(speciesNum);
            queryValues.push(String(cfg.speciesId));

            const capturesByPath = new Map<string, CaptureInstance>();
            for (const speciesValue of queryValues) {
              const [
                legacyBySpecies,
                legacyByCapturedSpecies,
                timeBySpecies,
                timeByCapturedSpecies,
                boxBySpecies,
                boxByCapturedSpecies,
              ] = await Promise.all([
                readDocsSafely("legacy", "speciesId", speciesValue),
                readDocsSafely("legacy", "capturedSpeciesId", speciesValue),
                readDocsSafely("time", "speciesId", speciesValue),
                readDocsSafely("time", "capturedSpeciesId", speciesValue),
                readDocsSafely("box", "speciesId", speciesValue),
                readDocsSafely("box", "capturedSpeciesId", speciesValue),
              ]);

              const allDocs = [
                ...legacyBySpecies,
                ...legacyByCapturedSpecies,
                ...timeBySpecies,
                ...timeByCapturedSpecies,
                ...boxBySpecies,
                ...boxByCapturedSpecies,
              ];
              for (const docSnap of allDocs) {
                const pathId = docSnap.ref.path;
                if (capturesByPath.has(pathId)) continue;

                const data = docSnap.data() as any;
                if (data?.isStarter === true) continue;
                capturesByPath.set(pathId, {
                  id: pathId,
                  speciesId: cfg.speciesId,
                  trainerId:
                    data.ownerId ??
                    data.uid ??
                    parseTrainerUidFromPath(pathId),
                  capturedAt:
                    toDateMaybe(data.capturedAt) ??
                    toDateMaybe(data.createdAt) ??
                    toDateMaybe(data.updatedAt),
                  isSpecialCapture: Boolean(data.isSpecialCapture),
                });
              }
            }

            const captures = Array.from(capturesByPath.values()).sort((a, b) => {
              const ta = a.capturedAt?.getTime() ?? 0;
              const tb = b.capturedAt?.getTime() ?? 0;
              return tb - ta;
            });

            rowsFinal.push({ config: cfg, captures });
          } catch (err) {
            console.error(
              "[Painéis] Erro ao buscar instâncias para speciesId",
              cfg.speciesId,
              err
            );
            rowsFinal.push({ config: cfg, captures: [] });
          }
        }

        if (!alive) return;
        setRows(rowsFinal);
        setDebug((d) => ({ ...d, step: "ok_capturas" }));
      } catch (err: any) {
        console.error("Erro ao carregar painel de capturas:", err);
        if (!alive) return;

        setDebug((d) => ({
          ...d,
          step: "erro_capturas",
          lastError: String(err?.message || err),
        }));

        setLoadingError(
          "Não foi possível carregar os dados do painel (verifique sessão admin/claims)."
        );
        setRows([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activePanel, authUid, authIsAdmin, authReady]);

  // ================================
  // Load Compras
  // ================================
  useEffect(() => {
    if (activePanel !== "compras") return;
    if (!authReady || !authIsAdmin) return;
    if (!authUid) return;

    let alive = true;

    (async () => {
      try {
        setSalesError(null);
        setSales([]);
        setDebug((d) => ({ ...d, step: "token_compras", lastError: "" }));

        const t = await ensureFreshTokenWithClaims();
        if (!t) {
          if (!alive) return;
          setDebug((d) => ({ ...d, step: "aguardando_auth" }));
          return;
        }
        if (!alive) return;

        setDebug((d) => ({
          ...d,
          uid: t.uid,
          email: t.email,
          isAdmin: t.claims?.admin === true,
        }));

        // 1) Itens à venda (config mutável)
        setDebug((d) => ({ ...d, step: "lendo_itemsConfig" }));

        const cfgQ = query(
          collection(db, "itemsConfig"),
          where("saleEnabled", "==", true)
        );

        let cfgSnap;
        try {
          cfgSnap = await getDocs(cfgQ);
        } catch (e: any) {
          if (isPermissionError(e)) {
            throw new Error(
              "Permissão negada em itemsConfig. Regra deve permitir read para usuários logados (isSignedIn)."
            );
          }
          throw e;
        }

        const configs: ItemSaleConfig[] = [];
        cfgSnap.forEach((docSnap) => {
          const data = docSnap.data() as any;

          configs.push({
            id: docSnap.id,
            saleEnabled: Boolean(data.saleEnabled),
            sellMode:
              data.sellMode === "real"
                ? "ecoin"
                : ((data.sellMode as SellMode) ?? "game"),
            gamePrice:
              typeof data.gamePrice === "number"
                ? data.gamePrice
                : data.gamePrice != null
                ? Number(data.gamePrice)
                : null,
            ecoinPrice:
              typeof data.ecoinPrice === "number"
                ? data.ecoinPrice
                : typeof data.realPrice === "number"
                ? data.realPrice
                : data.ecoinPrice != null
                ? Number(data.ecoinPrice)
                : null,
            realPrice:
              typeof data.realPrice === "number"
                ? data.realPrice
                : data.realPrice != null
                ? Number(data.realPrice)
                : null,
            saleStartedAt: toDateMaybe(data.saleStartedAt) ?? null,
            updatedAt: toDateMaybe(data.updatedAt) ?? null,
          });
        });

        if (!alive) return;

        if (configs.length === 0) {
          setSales([]);
          setDebug((d) => ({ ...d, step: "ok_sem_itens_venda" }));
          return;
        }

        // 2) Buscar compras (transactions) via collectionGroup
        setDebug((d) => ({ ...d, step: "lendo_collectionGroup_transactions" }));

        const txQ = query(
          collectionGroup(db, "transactions"),
          where("type", "==", "item_purchase")
        );

        let txSnap;
        try {
          txSnap = await getDocs(txQ);
        } catch (e: any) {
          if (isPermissionError(e)) {
            throw new Error(
              "Permissão negada em collectionGroup(transactions). Ajuste rules: match /{path=**}/transactions/{txId} { allow read: if isAdmin(); }"
            );
          }
          throw e;
        }

        const purchases: PurchaseRow[] = [];
        txSnap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const itemId = (data.itemId ?? "").toString();
          if (!itemId) return;

          purchases.push({
            txId: docSnap.id,
            buyerUid: parseBuyerUidFromPath(docSnap.ref.path),
            itemId,
            quantity:
              typeof data.quantity === "number"
                ? data.quantity
                : data.quantity != null
                ? Number(data.quantity)
                : 1,
            createdAt: toDateMaybe(data.createdAt),
          });
        });

        // 3) Agregar por itemId (somente itens que estão à venda)
        setDebug((d) => ({ ...d, step: "agregando" }));

        const purchasesByItem = new Map<string, PurchaseRow[]>();
        for (const p of purchases) {
          if (!purchasesByItem.has(p.itemId)) purchasesByItem.set(p.itemId, []);
          purchasesByItem.get(p.itemId)!.push(p);
        }

        const summaries: ItemSalesSummary[] = configs.map((cfg) => {
          const list = purchasesByItem.get(cfg.id) ?? [];
          const totalSold = list.reduce((acc, x) => acc + (x.quantity || 0), 0);
          const buyers = new Set(list.map((x) => x.buyerUid));

          return {
            itemId: cfg.id,
            config: cfg,
            totalSold,
            buyersCount: buyers.size,
            purchases: list.sort((a, b) => {
              const ta = a.createdAt?.getTime() ?? 0;
              const tb = b.createdAt?.getTime() ?? 0;
              return tb - ta;
            }),
          };
        });

        summaries.sort((a, b) => b.totalSold - a.totalSold);

        if (!alive) return;
        setSales(summaries);
        setDebug((d) => ({ ...d, step: "ok_compras" }));
      } catch (err: any) {
        console.error("Erro ao carregar painel de compras:", err);
        if (!alive) return;

        setDebug((d) => ({
          ...d,
          step: "erro_compras",
          lastError: String(err?.message || err),
        }));

        setSalesError(
          err?.message ||
            "Não foi possível carregar o painel de compras (permissão/claims/token)."
        );
        setSales([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activePanel, authUid, authIsAdmin, authReady]);

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-900 text-slate-100">
        <Sidebar />

        {/* ✅ AQUI está a correção: removido ml-16 md:ml-64 */}
        <main className="flex-1 px-4 py-6">
          <div className="w-full">
            <header className="flex flex-col gap-1 mb-4">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                {effectiveHeaderTitle}
              </h1>
              <p className="text-xs md:text-sm text-slate-300">
                {effectiveHeaderSubtitle}
              </p>
            </header>

            {/* DEBUG BOX */}
            <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <b>Projeto:</b> {debug.projectId ?? "—"}
                </div>
                <div>
                  <b>Admin claim:</b> {adminLabel}
                </div>
                <div>
                  <b>UID:</b> {debug.uid ?? "—"}
                </div>
                <div>
                  <b>Email:</b> {debug.email ?? "—"}
                </div>
                <div className="md:col-span-2">
                  <b>Etapa:</b> {debug.step ?? "—"}
                </div>
                {debug.lastError ? (
                  <div className="md:col-span-2 text-red-200">
                    <b>Último erro:</b> {debug.lastError}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
              {/* Menu */}
              <aside className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 h-fit sticky top-4">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                  Selecione um painel
                </p>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setActivePanel("capturas")}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm border transition ${
                      activePanel === "capturas"
                        ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-200"
                        : "bg-slate-900/40 border-slate-800 hover:bg-slate-900"
                    }`}
                  >
                    Painel de Capturas
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Limites, especiais e capturas por treinador.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActivePanel("compras")}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm border transition ${
                      activePanel === "compras"
                        ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-200"
                        : "bg-slate-900/40 border-slate-800 hover:bg-slate-900"
                    }`}
                  >
                    Painel de Compras
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Itens à venda, total vendido e compradores.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel("gym")}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm border transition ${
                      activePanel === "gym"
                        ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-200"
                        : "bg-slate-900/40 border-slate-800 hover:bg-slate-900"
                    }`}
                  >
                    Painel de GYM
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Dono, tipo, limites, badges, NPCs e upgrades.
                    </div>
                  </button>
                </div>
              </aside>

              {/* Conteúdo */}
              <section className="space-y-4">
                {/* ================================
                    CAPTURAS
                ================================ */}
                {activePanel === "capturas" && (
                  <>
                    {loadingError && (
                      <div className="rounded-md border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-100">
                        {loadingError}
                      </div>
                    )}

                    {!loadingError && rows.length === 0 && (
                      <p className="text-sm text-slate-300">
                        Nenhuma configuração de captura encontrada em{" "}
                        <span className="font-mono">pokedexConfig</span>.
                        <br />
                        Configure capturas na Pokédex e salve para que apareçam
                        aqui.
                      </p>
                    )}

                    {!loadingError && rows.length > 0 && (
                      <div className="space-y-4">
                        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {rows.map((row) => {
                            const totalCaptures = row.captures.length;
                            const specialCaptures = row.captures.filter(
                              (c) => c.isSpecialCapture
                            ).length;
                            const specialPlanned = row.config.specialCount;
                            const specialRemaining =
                              specialPlanned == null
                                ? null
                                : Math.max(specialPlanned - specialCaptures, 0);
                            const limit = row.config.captureLimit;
                            const remaining =
                              limit == null
                                ? null
                                : Math.max(limit - totalCaptures, 0);

                            const isExpanded =
                              expandedConfigId === row.config.id;
                            const resolvedSpeciesName =
                              row.config.speciesName ||
                              speciesNameMap[String(row.config.speciesId)] ||
                              null;
                            const nameLabel = resolvedSpeciesName
                              ? ` ${resolvedSpeciesName}`
                              : "";

                            return (
                              <button
                                key={row.config.id}
                                type="button"
                                onClick={() =>
                                  setExpandedConfigId(
                                    isExpanded ? null : row.config.id
                                  )
                                }
                                className="group relative rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-900 transition p-3 text-left"
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div>
                                      <p className="text-[11px] text-slate-400">
                                        Espécie configurada
                                      </p>
                                      <h2 className="text-sm font-semibold text-white">
                                        #{row.config.speciesId}
                                        {nameLabel}
                                      </h2>
                                    </div>

                                    <div className="text-[10px] rounded-full bg-slate-800/80 px-2 py-1 flex flex-col items-end">
                                      <span className="text-slate-400">
                                        Capturados
                                      </span>
                                      <span className="font-semibold text-emerald-300">
                                        {totalCaptures}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                    <div>
                                      <span className="block text-slate-400">
                                        Limite
                                      </span>
                                      <span className="font-semibold">
                                        {limit == null ? "Ilimitado" : limit}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="block text-slate-400">
                                        Faltam
                                      </span>
                                      <span className="font-semibold">
                                        {limit == null ? "—" : remaining ?? 0}
                                      </span>
                                    </div>
                                  </div>

                                  {row.config.specialCount != null && (
                                    <p className="mt-1 text-[10px] text-amber-200">
                                      Especiais: planejados{" "}
                                      <span className="font-semibold">
                                        {specialPlanned}
                                      </span>
                                      {" · "}capturados{" "}
                                      <span className="font-semibold">
                                        {specialCaptures}
                                      </span>
                                      {" · "}restantes{" "}
                                      <span className="font-semibold">
                                        {specialRemaining == null
                                          ? "—"
                                          : specialRemaining}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </section>

                        {expandedConfigId && (
                          <section className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                            {rows
                              .filter((r) => r.config.id === expandedConfigId)
                              .map((row) => {
                                const specialCaptured = row.captures.filter(
                                  (c) => c.isSpecialCapture
                                ).length;

                                const resolvedSpeciesName =
                                  row.config.speciesName ||
                                  speciesNameMap[String(row.config.speciesId)] ||
                                  null;
                                const nameLabel = resolvedSpeciesName
                                  ? ` ${resolvedSpeciesName}`
                                  : "";

                                return (
                                  <div key={row.config.id} className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-[11px] text-slate-400">
                                          Espécie configurada
                                        </p>
                                        <h2 className="text-sm font-semibold text-white">
                                          #{row.config.speciesId}
                                          {nameLabel}
                                        </h2>
                                        <p className="text-[11px] text-slate-400 mt-1">
                                          Limite:{" "}
                                          <span className="font-semibold text-slate-200">
                                            {row.config.captureLimit == null
                                              ? "Ilimitado"
                                              : row.config.captureLimit}
                                          </span>
                                          {" · "}Capturados:{" "}
                                          <span className="font-semibold text-slate-200">
                                            {row.captures.length}
                                          </span>
                                          {" · "}Especiais capturados:{" "}
                                          <span className="font-semibold text-amber-200">
                                            {specialCaptured}
                                          </span>
                                        </p>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setExpandedConfigId(null)}
                                        className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2"
                                      >
                                        Fechar detalhes
                                      </button>
                                    </div>

                                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800">
                                      <table className="min-w-full text-xs">
                                        <thead className="bg-slate-900/80">
                                          <tr>
                                            <th className="px-2 py-2 text-left text-[11px] font-semibold text-slate-300">
                                              Treinador (uid)
                                            </th>
                                            <th className="px-2 py-2 text-left text-[11px] font-semibold text-slate-300">
                                              Quando
                                            </th>
                                            <th className="px-2 py-2 text-left text-[11px] font-semibold text-slate-300">
                                              Especial?
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {row.captures.length === 0 && (
                                            <tr>
                                              <td
                                                colSpan={3}
                                                className="px-2 py-3 text-center text-[11px] text-slate-400"
                                              >
                                                Nenhuma captura registrada ainda.
                                              </td>
                                            </tr>
                                          )}

                                          {row.captures.map((cap) => {
                                            const dateLabel = cap.capturedAt
                                              ? cap.capturedAt.toLocaleString(
                                                  "pt-BR",
                                                  {
                                                    dateStyle: "short",
                                                    timeStyle: "short",
                                                  }
                                                )
                                              : "—";

                                            return (
                                              <tr
                                                key={cap.id}
                                                className="odd:bg-slate-950 even:bg-slate-900/70"
                                              >
                                                <td className="px-2 py-1.5 text-[11px] text-slate-200">
                                                  {cap.trainerId}
                                                </td>
                                                <td className="px-2 py-1.5 text-[11px] text-slate-300">
                                                  {dateLabel}
                                                </td>
                                                <td className="px-2 py-1.5">
                                                  {cap.isSpecialCapture ? (
                                                    <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/40">
                                                      Sim (especial)
                                                    </span>
                                                  ) : (
                                                    <span className="inline-flex items-center rounded-full bg-slate-700/40 px-2 py-0.5 text-[10px] font-medium text-slate-200 border border-slate-500/40">
                                                      Comum
                                                    </span>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })}
                          </section>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ================================
                    GYM
                ================================ */}
                {activePanel === "gym" && <GymAdmin />}

                {/* ================================
                    COMPRAS
                ================================ */}
                {activePanel === "compras" && (
                  <>
                    {salesError && (
                      <div className="rounded-md border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-100">
                        {salesError}
                      </div>
                    )}

                    {!salesError && sales.length === 0 && (
                      <p className="text-sm text-slate-300">
                        Nenhum item está marcado como <b>saleEnabled</b> em{" "}
                        <span className="font-mono">itemsConfig</span>.
                        <br />
                        Abra um item em <b>Itens</b> e marque para venda.
                      </p>
                    )}

                    {!salesError && sales.length > 0 && (
                      <div className="space-y-4">
                        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {sales.map((s) => {
                            const isExpanded = expandedItemId === s.itemId;
                            const startedAt =
                              s.config.saleStartedAt ??
                              s.config.updatedAt ??
                              null;

                            const startedLabel = startedAt
                              ? startedAt.toLocaleString("pt-BR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "—";

                            return (
                              <button
                                key={s.itemId}
                                type="button"
                                onClick={() =>
                                  setExpandedItemId(
                                    isExpanded ? null : s.itemId
                                  )
                                }
                                className="group relative rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-900 transition p-3 text-left"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <p className="text-[11px] text-slate-400">
                                      Item à venda
                                    </p>
                                    <h2 className="text-sm font-semibold text-white">
                                      {s.itemId}
                                    </h2>
                                    <p className="text-[10px] text-slate-400 mt-1">
                                      Início:{" "}
                                      <span className="text-slate-200 font-semibold">
                                        {startedLabel}
                                      </span>
                                    </p>
                                  </div>

                                  <div className="text-[10px] rounded-full bg-slate-800/80 px-2 py-1 flex flex-col items-end">
                                    <span className="text-slate-400">
                                      Vendidos
                                    </span>
                                    <span className="font-semibold text-emerald-300">
                                      {s.totalSold}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                  <div>
                                    <span className="block text-slate-400">
                                      Compradores
                                    </span>
                                    <span className="font-semibold">
                                      {s.buyersCount}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="block text-slate-400">
                                      Venda
                                    </span>
                                    <span className="font-semibold">
                                      {getSellModeLabel(s.config.sellMode)}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-2 text-[10px] text-slate-300">
                                  {s.config.sellMode === "game" && (
                                    <>
                                      Preco moedas: <b>{s.config.gamePrice ?? "—"}</b>
                                    </>
                                  )}
                                  {s.config.sellMode === "ecoin" && (
                                    <>
                                      Preco dinheiro real: <b>{s.config.ecoinPrice ?? "—"}</b>
                                    </>
                                  )}
                                  {s.config.sellMode === "both" && (
                                    <>
                                      Moedas: <b>{s.config.gamePrice ?? "—"}</b> · Dinheiro real:{" "}
                                      <b>{s.config.ecoinPrice ?? "—"}</b>
                                    </>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </section>

                        {expandedItemId && (
                          <section className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                            {sales
                              .filter((x) => x.itemId === expandedItemId)
                              .map((s) => (
                                <div key={s.itemId} className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-[11px] text-slate-400">
                                        Item
                                      </p>
                                      <h2 className="text-sm font-semibold text-white">
                                        {s.itemId}
                                      </h2>
                                      <p className="text-[11px] text-slate-400 mt-1">
                                        Total vendido:{" "}
                                        <span className="font-semibold text-emerald-300">
                                          {s.totalSold}
                                        </span>
                                        {" · "}Compradores únicos:{" "}
                                        <span className="font-semibold text-slate-200">
                                          {s.buyersCount}
                                        </span>
                                      </p>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => setExpandedItemId(null)}
                                      className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2"
                                    >
                                      Fechar detalhes
                                    </button>
                                  </div>

                                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800">
                                    <table className="min-w-full text-xs">
                                      <thead className="bg-slate-900/80">
                                        <tr>
                                          <th className="px-2 py-2 text-left text-[11px] font-semibold text-slate-300">
                                            Quem comprou (uid)
                                          </th>
                                          <th className="px-2 py-2 text-left text-[11px] font-semibold text-slate-300">
                                            Quando
                                          </th>
                                          <th className="px-2 py-2 text-left text-[11px] font-semibold text-slate-300">
                                            Quantidade
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {s.purchases.length === 0 && (
                                          <tr>
                                            <td
                                              colSpan={3}
                                              className="px-2 py-3 text-center text-[11px] text-slate-400"
                                            >
                                              Nenhuma compra registrada para este item.
                                            </td>
                                          </tr>
                                        )}

                                        {s.purchases.map((p) => {
                                          const dateLabel = p.createdAt
                                            ? p.createdAt.toLocaleString("pt-BR", {
                                                dateStyle: "short",
                                                timeStyle: "short",
                                              })
                                            : "—";

                                          return (
                                            <tr
                                              key={p.txId}
                                              className="odd:bg-slate-950 even:bg-slate-900/70"
                                            >
                                              <td className="px-2 py-1.5 text-[11px] text-slate-200">
                                                {p.buyerUid}
                                              </td>
                                              <td className="px-2 py-1.5 text-[11px] text-slate-300">
                                                {dateLabel}
                                              </td>
                                              <td className="px-2 py-1.5 text-[11px] text-slate-200">
                                                {p.quantity}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                          </section>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}
