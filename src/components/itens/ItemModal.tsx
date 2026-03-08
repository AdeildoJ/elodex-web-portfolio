"use client";

import { useEffect, useMemo, useState } from "react";
import movesData from "@/data/moves.json";
import type { PokemonItem, SellMode, ShopItemConfig } from "./ItensPage";

import { db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";

type MoveJson = {
  name?: string;
  id?: string | number;
  type?: string;
  target?: string;
  damageClass?: string;
  power?: number | null;
  accuracy?: number | null;
  pp?: number | null;
  priority?: number | null;
  effectText?: string | null;
  flags?: unknown[];
};
type MoveFromJson = Record<string, MoveJson>;
type BiomeOption = { id: string; name: string };

function getPokeApiItemSpriteUrl(id: string) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${id}.png`;
}

function getFallbackByCategory(item: PokemonItem) {
  if (item.category === "tm" || item.category === "hm" || item.category === "tr") {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/tm-normal.png";
  }
  return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/unknown.png";
}

function Row({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  return (
    <div className="text-xs text-slate-300">
      <b className="text-slate-200">{label}:</b> {String(value)}
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return <Row label={label} value={value ? "Sim" : "Nao"} />;
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
  onConfigSaved,
}: {
  item: PokemonItem;
  onClose: () => void;
  onConfigSaved?: (config: ShopItemConfig) => void;
}) {
  const preferred =
    item.sprite && item.sprite.startsWith("http")
      ? item.sprite
      : getPokeApiItemSpriteUrl(item.id);

  const fallback = getFallbackByCategory(item);

  const moveMap = movesData as unknown as MoveFromJson;
  const move = item.moveId ? moveMap[item.moveId] ?? null : null;

  const moveFlags =
    move?.flags && Array.isArray(move.flags) && move.flags.length > 0
      ? (move.flags as unknown[]).map((f) => (typeof f === "string" ? f : "")).filter(Boolean)
      : null;

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [saleEnabled, setSaleEnabled] = useState(false);
  const [sellMode, setSellMode] = useState<SellMode>("game");
  const [gamePriceText, setGamePriceText] = useState("");
  const [ecoinPriceText, setEcoinPriceText] = useState("");
  const [pixPaymentUrl, setPixPaymentUrl] = useState("");
  const [creditPaymentUrl, setCreditPaymentUrl] = useState("");
  const [debitPaymentUrl, setDebitPaymentUrl] = useState("");
  const [grantType, setGrantType] = useState<"inventory" | "biome_access">("inventory");
  const [biomeAccessBiomeId, setBiomeAccessBiomeId] = useState("");
  const [biomeAccessDurationHoursText, setBiomeAccessDurationHoursText] = useState("24");
  const [biomeOptions, setBiomeOptions] = useState<BiomeOption[]>([]);

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
          const data = snap.data() as Partial<ShopItemConfig> & {
            realPrice?: number | null;
            sellMode?: string;
            pixPaymentUrl?: string;
            creditPaymentUrl?: string;
            debitPaymentUrl?: string;
          };

          const rawSellMode = String(data.sellMode || "game");
          const normalizedSellMode: SellMode =
            rawSellMode === "real"
              ? "ecoin"
              : rawSellMode === "game" || rawSellMode === "ecoin" || rawSellMode === "both"
              ? (rawSellMode as SellMode)
              : "game";
          const normalizedRealPrice =
            typeof data.ecoinPrice === "number"
              ? data.ecoinPrice
              : typeof data.realPrice === "number"
              ? data.realPrice
              : null;

          setSaleEnabled(Boolean(data.saleEnabled));
          setSellMode(normalizedSellMode);
          setGamePriceText(typeof data.gamePrice === "number" ? String(data.gamePrice) : "");
          setEcoinPriceText(
            typeof normalizedRealPrice === "number" ? String(normalizedRealPrice) : ""
          );
          setPixPaymentUrl(typeof data.pixPaymentUrl === "string" ? data.pixPaymentUrl : "");
          setCreditPaymentUrl(
            typeof data.creditPaymentUrl === "string" ? data.creditPaymentUrl : ""
          );
          setDebitPaymentUrl(
            typeof data.debitPaymentUrl === "string" ? data.debitPaymentUrl : ""
          );
          setGrantType(data.grantType === "biome_access" ? "biome_access" : "inventory");
          setBiomeAccessBiomeId(String(data.biomeAccessBiomeId || "").trim().toLowerCase());
          setBiomeAccessDurationHoursText(
            typeof data.biomeAccessDurationHours === "number" && data.biomeAccessDurationHours > 0
              ? String(data.biomeAccessDurationHours)
              : "24"
          );
        } else {
          setSaleEnabled(false);
          setSellMode("game");
          setGamePriceText("");
          setEcoinPriceText("");
          setPixPaymentUrl("");
          setCreditPaymentUrl("");
          setDebitPaymentUrl("");
          setGrantType("inventory");
          setBiomeAccessBiomeId("");
          setBiomeAccessDurationHoursText("24");
        }
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : "Falha ao carregar configuracao de loja.");
      } finally {
        setLoadingConfig(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [configDocRef]);

  useEffect(() => {
    let alive = true;

    async function loadBiomes() {
      try {
        const snap = await getDocs(collection(db, "biomes"));
        if (!alive) return;
        const rows: BiomeOption[] = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const id = String(data.id || d.id).trim().toLowerCase();
          if (!id) return;
          rows.push({ id, name: String(data.name || id) });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        setBiomeOptions(rows);
      } catch {
        if (alive) setBiomeOptions([]);
      }
    }

    loadBiomes();
    return () => {
      alive = false;
    };
  }, []);

  async function handleSave() {
    setOkMsg(null);
    setErrorMsg(null);

    const gamePrice = toNumberOrNull(gamePriceText.trim());
    const realPrice = toNumberOrNull(ecoinPriceText.trim());
    const biomeAccessDurationHours = toNumberOrNull(biomeAccessDurationHoursText.trim());

    if (saleEnabled) {
      if (sellMode === "game" && (gamePrice === null || gamePrice === 0)) {
        setErrorMsg("Informe um preco valido em moedas do jogo.");
        return;
      }
      if (sellMode === "ecoin" && (realPrice === null || realPrice === 0)) {
        setErrorMsg("Informe um preco valido em dinheiro real.");
        return;
      }
      if (sellMode === "both") {
        if (gamePrice === null || gamePrice === 0) {
          setErrorMsg("Informe um preco valido em moedas do jogo (modo ambos).");
          return;
        }
        if (realPrice === null || realPrice === 0) {
          setErrorMsg("Informe um preco valido em dinheiro real (modo ambos).");
          return;
        }
      }
    }

    if (grantType === "biome_access") {
      if (!String(biomeAccessBiomeId || "").trim()) {
        setErrorMsg("Informe o bioma para o passe de acesso.");
        return;
      }
      if (biomeAccessDurationHours === null || biomeAccessDurationHours <= 0) {
        setErrorMsg("Informe uma duracao valida (horas) para acesso temporario.");
        return;
      }
    }

    const payload: ShopItemConfig = {
      saleEnabled,
      sellMode,
      gamePrice: saleEnabled && (sellMode === "game" || sellMode === "both") ? gamePrice : null,
      ecoinPrice:
        saleEnabled && (sellMode === "ecoin" || sellMode === "both") ? realPrice : null,
      grantType,
      biomeAccessBiomeId:
        grantType === "biome_access" ? String(biomeAccessBiomeId).trim().toLowerCase() : null,
      biomeAccessDurationHours: grantType === "biome_access" ? biomeAccessDurationHours : null,
    };

    try {
      setSaving(true);
      await setDoc(
        configDocRef,
        {
          ...payload,
          realPrice: payload.ecoinPrice,
          itemName: item.name,
          itemDescription: item.descriptionPtBr || item.effectPtBr || "",
          category: item.category || "outros",
          pixPaymentUrl: pixPaymentUrl.trim(),
          creditPaymentUrl: creditPaymentUrl.trim(),
          debitPaymentUrl: debitPaymentUrl.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      onConfigSaved?.(payload);
      setOkMsg("Configuracao de loja salva com sucesso!");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Falha ao salvar configuracao.");
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
        <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <div className="font-semibold">{item.name}</div>

          <button
            className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sm"
            onClick={onClose}
          >
            Fechar X
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto">
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
                {item.descriptionPtBr || "Sem descricao em PT-BR cadastrada."}
              </div>

              {item.effectPtBr ? (
                <div className="text-sm text-emerald-400 mt-2">{item.effectPtBr}</div>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Row label="Categoria" value={item.category} />
                <Row label="Subcategoria" value={item.subCategory} />
                <Row label="Preco base (PokeAPI)" value={item.price} />
                <Row label="MoveId" value={item.moveId} />
                <BoolRow label="Usavel em batalha" value={item.battleUsable} />
                <BoolRow label="Usavel fora de batalha" value={item.overworldUsable} />
                <BoolRow label="Consumivel" value={item.consumable} />
              </div>
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-100">Configuracao da loja</div>
                {loadingConfig ? <div className="text-xs text-slate-400">Carregando...</div> : null}
              </div>

              <div className="mt-3 bg-slate-900/30 border border-slate-800 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={saleEnabled}
                    onChange={(e) => setSaleEnabled(e.target.checked)}
                  />
                  Disponibilizar este item na loja
                </label>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-1">
                    <div className="text-xs text-slate-400 mb-1">Forma de pagamento</div>
                    <select
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      value={sellMode}
                      disabled={!saleEnabled}
                      onChange={(e) => setSellMode(e.target.value as SellMode)}
                    >
                      <option value="game">Moedas do jogo</option>
                      <option value="ecoin">Dinheiro real</option>
                      <option value="both">Ambos</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Preco (moedas do jogo)</div>
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
                    <div className="text-xs text-slate-400 mb-1">Preco (dinheiro real)</div>
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

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">URL checkout PIX</div>
                    <input
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      placeholder="https://.../{orderId}/{amount}"
                      value={pixPaymentUrl}
                      onChange={(e) => setPixPaymentUrl(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">URL checkout Credito</div>
                    <input
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      placeholder="https://.../{orderId}/{amount}"
                      value={creditPaymentUrl}
                      onChange={(e) => setCreditPaymentUrl(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">URL checkout Debito</div>
                    <input
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      placeholder="https://.../{orderId}/{amount}"
                      value={debitPaymentUrl}
                      onChange={(e) => setDebitPaymentUrl(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Tipo de entrega</div>
                    <select
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      value={grantType}
                      onChange={(e) =>
                        setGrantType(e.target.value === "biome_access" ? "biome_access" : "inventory")
                      }
                    >
                      <option value="inventory">Item no inventario</option>
                      <option value="biome_access">Acesso temporario a bioma</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Bioma alvo</div>
                    <select
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      value={biomeAccessBiomeId}
                      disabled={grantType !== "biome_access"}
                      onChange={(e) => setBiomeAccessBiomeId(e.target.value)}
                    >
                      <option value="">Selecione...</option>
                      {biomeOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Duracao (horas)</div>
                    <input
                      className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      placeholder="Ex: 24"
                      value={biomeAccessDurationHoursText}
                      disabled={grantType !== "biome_access"}
                      onChange={(e) => setBiomeAccessDurationHoursText(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>

                {errorMsg ? <div className="mt-3 text-sm text-red-300">{errorMsg}</div> : null}
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
