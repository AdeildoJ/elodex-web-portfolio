"use client";

import { useEffect, useMemo, useState } from "react";
import movesData from "@/data/moves.json";
import type { PokemonItem } from "./ItensPage";

// 🔥 Firestore
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

type MoveFromJson = Record<string, any>;

type SellMode = "game" | "ecoin" | "both";

type ItemSaleConfig = {
  saleEnabled: boolean;
  sellMode: SellMode;
  gamePrice: number | null;
  ecoinPrice: number | null;
};

function getPokeApiItemSpriteUrl(id: string) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${id}.png`;
}

function getFallbackByCategory(item: PokemonItem) {
  if (item.category === "tm" || item.category === "hm" || item.category === "tr") {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/tm-normal.png";
  }
  return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/unknown.png";
}

function Row({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  return (
    <div className="text-xs text-slate-300">
      <b className="text-slate-200">{label}:</b> {String(value)}
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined) return null;
  return <Row label={label} value={value ? "Sim" : "Não"} />;
}

function toNumberOrNull(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

export default function ItemModal({
  item,
  onClose,
}: {
  item: PokemonItem;
  onClose: () => void;
}) {
  const preferred =
    item.sprite && item.sprite.startsWith("http")
      ? item.sprite
      : getPokeApiItemSpriteUrl(item.id);

  const fallback = getFallbackByCategory(item);

  // ✅ TM/HM/TR: move completo via moveId
  const move = item.moveId ? (movesData as MoveFromJson)[item.moveId] || null : null;

  const moveFlags =
    move?.flags && Array.isArray(move.flags) && move.flags.length > 0
      ? move.flags.map((f: any) => (typeof f === "string" ? f : f?.name)).filter(Boolean)
      : null;

  // -----------------------------
  // 🔥 Venda: carrega e salva Firestore
  // -----------------------------
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [saleEnabled, setSaleEnabled] = useState(false);
  const [sellMode, setSellMode] = useState<SellMode>("game");
  const [gamePriceText, setGamePriceText] = useState("");
  const [ecoinPriceText, setEcoinPriceText] = useState("");

  const configDocRef = useMemo(() => doc(db, "itemsConfig", item.id), [item.id]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoadingConfig(true);
      setErrorMsg(null);
      setOkMsg(null);

      try {
        const snap = await getDoc(configDocRef);
        if (!alive) return;

        if (snap.exists()) {
          const data = snap.data() as Partial<ItemSaleConfig>;

          setSaleEnabled(Boolean(data.saleEnabled));
          setSellMode((data.sellMode as SellMode) || "game");
          setGamePriceText(
            typeof data.gamePrice === "number" ? String(data.gamePrice) : ""
          );
          setEcoinPriceText(
            typeof data.ecoinPrice === "number" ? String(data.ecoinPrice) : ""
          );
        } else {
          // padrão: desativado (pra não vender sem querer)
          setSaleEnabled(false);
          setSellMode("game");
          setGamePriceText("");
          setEcoinPriceText("");
        }
      } catch (e: any) {
        setErrorMsg(e?.message || "Falha ao carregar configuração de venda.");
      } finally {
        setLoadingConfig(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [configDocRef]);

  async function handleSave() {
    setOkMsg(null);
    setErrorMsg(null);

    const gamePrice = toNumberOrNull(gamePriceText.trim());
    const ecoinPrice = toNumberOrNull(ecoinPriceText.trim());

    // ✅ validações
    if (saleEnabled) {
      if (sellMode === "game" && (gamePrice === null || gamePrice === 0)) {
        setErrorMsg("Informe um preço válido em moedas do jogo.");
        return;
      }
      if (sellMode === "ecoin" && (ecoinPrice === null || ecoinPrice === 0)) {
        setErrorMsg("Informe um preço válido em ECoin.");
        return;
      }
      if (sellMode === "both") {
        if (gamePrice === null || gamePrice === 0) {
          setErrorMsg("Informe um preço válido em moedas do jogo (modo Ambos).");
          return;
        }
        if (ecoinPrice === null || ecoinPrice === 0) {
          setErrorMsg("Informe um preço válido em ECoin (modo Ambos).");
          return;
        }
      }
    }

    // Se não estiver vendendo, a gente pode zerar preços
    const payload: ItemSaleConfig = {
      saleEnabled,
      sellMode,
      gamePrice: saleEnabled && (sellMode === "game" || sellMode === "both") ? gamePrice : null,
      ecoinPrice: saleEnabled && (sellMode === "ecoin" || sellMode === "both") ? ecoinPrice : null,
    };

    try {
      setSaving(true);
      await setDoc(
        configDocRef,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          // updatedBy: null, // (opcional) se você quiser colocar user.email/uid depois
        },
        { merge: true }
      );

      setOkMsg("Configuração salva com sucesso!");
    } catch (e: any) {
      setErrorMsg(e?.message || "Falha ao salvar configuração.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-slate-950 border border-slate-800 rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Topo fixo */}
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <div className="font-semibold">{item.name}</div>

          <button
            className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sm"
            onClick={onClose}
          >
            Fechar ✕
          </button>
        </div>

        {/* Conteúdo com scroll interno */}
        <div className="max-h-[75vh] overflow-y-auto">
          {/* Cabeçalho item */}
          <div className="p-4 flex gap-4">
            <div className="w-24 h-24 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
              <img
                src={preferred}
                alt={item.name}
                className="w-20 h-20 object-contain"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (img.src !== fallback) img.src = fallback;
                }}
              />
            </div>

            <div className="flex-1">
              <div className="text-sm text-slate-200">
                {item.descriptionPtBr || "Sem descrição em PT-BR cadastrada."}
              </div>

              {item.effectPtBr ? (
                <div className="text-sm text-emerald-400 mt-2">{item.effectPtBr}</div>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Row label="Categoria" value={item.category} />
                <Row label="Subcategoria" value={item.subCategory} />
                <Row label="Preço base (PokeAPI)" value={item.price} />
                <Row label="MoveId" value={item.moveId} />
                <BoolRow label="Usável em batalha" value={item.battleUsable} />
                <BoolRow label="Usável fora de batalha" value={item.overworldUsable} />
                <BoolRow label="Consumível" value={item.consumable} />
              </div>
            </div>
          </div>

          {/* ✅ Configuração de venda (Firestore) */}
          <div className="px-4 pb-4">
            <div className="border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-100">Configuração de venda</div>
                {loadingConfig ? (
                  <div className="text-xs text-slate-400">Carregando...</div>
                ) : null}
              </div>

              <div className="mt-3 bg-slate-900/30 border border-slate-800 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={saleEnabled}
                    onChange={(e) => setSaleEnabled(e.target.checked)}
                  />
                  Vender este item
                </label>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-1">
                    <div className="text-xs text-slate-400 mb-1">Forma de venda</div>
                    <select
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      value={sellMode}
                      disabled={!saleEnabled}
                      onChange={(e) => setSellMode(e.target.value as SellMode)}
                    >
                      <option value="game">Moeda do jogo</option>
                      <option value="ecoin">ECoin</option>
                      <option value="both">Ambos</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Preço (moeda do jogo)</div>
                    <input
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      placeholder="Ex: 200"
                      value={gamePriceText}
                      disabled={!saleEnabled || (sellMode !== "game" && sellMode !== "both")}
                      onChange={(e) => setGamePriceText(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Preço (ECoin)</div>
                    <input
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      placeholder="Ex: 5"
                      value={ecoinPriceText}
                      disabled={!saleEnabled || (sellMode !== "ecoin" && sellMode !== "both")}
                      onChange={(e) => setEcoinPriceText(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>

                {errorMsg ? (
                  <div className="mt-3 text-sm text-red-300">{errorMsg}</div>
                ) : null}
                {okMsg ? <div className="mt-3 text-sm text-emerald-300">{okMsg}</div> : null}

                <div className="mt-3 flex justify-end">
                  <button
                    className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-40"
                    onClick={handleSave}
                    disabled={loadingConfig || saving}
                  >
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Movimento associado (TM/HM/TR) */}
          {move ? (
            <div className="px-4 pb-5">
              <div className="border-t border-slate-800 pt-4">
                <div className="font-semibold text-slate-100 mb-2">Movimento associado</div>

                <div className="grid grid-cols-2 gap-2">
                  <Row label="name" value={move.name} />
                  <Row label="id" value={move.id} />
                  <Row label="type" value={move.type} />
                  <Row label="target" value={move.target} />
                  <Row label="damageClass" value={move.damageClass} />
                  <Row label="power" value={move.power} />
                  <Row label="accuracy" value={move.accuracy} />
                  <Row label="pp" value={move.pp} />
                  <Row label="priority" value={move.priority} />
                </div>

                {move.effectText ? (
                  <div className="mt-3 text-sm text-slate-200">
                    <b className="text-slate-100">effectText:</b> {move.effectText}
                  </div>
                ) : null}

                {moveFlags ? (
                  <div className="mt-3 text-xs text-slate-300">
                    <b className="text-slate-200">flags:</b> {moveFlags.join(", ")}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
