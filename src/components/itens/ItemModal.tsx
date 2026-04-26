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
type FishingGroupOption = { id: string; name: string };

function getPokeApiItemSpriteUrl(id: string) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${id}.png`;
}

function getFallbackByCategory(item: PokemonItem) {
  if (item.category === "tm" || item.category === "hm" || item.category === "tr") {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/tm-normal.png";
  }
  return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/unknown.png";
}

function prettifyMoveName(raw: string) {
  return raw
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
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

  const isMachineItem = item.category === "tm" || item.category === "hm" || item.category === "tr";
  const machineMoveName = isMachineItem
    ? prettifyMoveName(String(move?.name || item.moveNameCache || item.moveId || "").trim())
    : "";

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
  const [fishingBaitEnabled, setFishingBaitEnabled] = useState(false);
  const [fishingConfigMode, setFishingConfigMode] = useState<"legacy" | "isca-anzol">("legacy");
  const [fishingBaitTagsText, setFishingBaitTagsText] = useState("");
  const [fishingBaseSuccessText, setFishingBaseSuccessText] = useState("98");
  const [fishingSpawnWeightBonusText, setFishingSpawnWeightBonusText] = useState("10");
  const [fishingIscaUsesText, setFishingIscaUsesText] = useState("10");
  const [fishingIscaGroupIdsText, setFishingIscaGroupIdsText] = useState("");
  const [fishingIscaSpeciesIdsText, setFishingIscaSpeciesIdsText] = useState("");
  const [biomeOptions, setBiomeOptions] = useState<BiomeOption[]>([]);
  const [fishingGroupOptions, setFishingGroupOptions] = useState<FishingGroupOption[]>([]);

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
          const fishingConfig =
            data.fishingConfig && typeof data.fishingConfig === "object"
              ? (data.fishingConfig as Record<string, unknown>)
              : null;
          setFishingBaitEnabled(Boolean(fishingConfig?.enabled));
          const modeRaw = String(fishingConfig?.mode || "").trim().toLowerCase();
          setFishingConfigMode(
            modeRaw === "isca-anzol" || modeRaw === "isca_anzol" ? "isca-anzol" : "legacy"
          );
          setFishingBaitTagsText(
            Array.isArray(fishingConfig?.attractTags)
              ? (fishingConfig?.attractTags as unknown[]).map((tag) => String(tag || "").trim()).filter(Boolean).join(", ")
              : ""
          );
          setFishingBaseSuccessText(
            typeof fishingConfig?.baseSuccessPercent === "number" ? String(fishingConfig.baseSuccessPercent) : "98"
          );
          setFishingSpawnWeightBonusText(
            typeof fishingConfig?.groupWeightBonusPercent === "number"
              ? String(fishingConfig.groupWeightBonusPercent)
              : "10"
          );
          setFishingIscaUsesText(
            typeof fishingConfig?.uses === "number" && fishingConfig.uses > 0
              ? String(fishingConfig.uses)
              : "10"
          );
          setFishingIscaGroupIdsText(
            Array.isArray(fishingConfig?.fishingGroupIds)
              ? (fishingConfig.fishingGroupIds as unknown[])
                  .map((id) => String(id || "").trim().toLowerCase())
                  .filter(Boolean)
                  .join(", ")
              : ""
          );
          setFishingIscaSpeciesIdsText(
            Array.isArray(fishingConfig?.fishingSpeciesIds)
              ? (fishingConfig.fishingSpeciesIds as unknown[])
                  .map((n) => String(Math.trunc(Number(n) || 0)))
                  .filter((s) => s !== "0")
                  .join(", ")
              : ""
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
          setFishingBaitEnabled(false);
          setFishingConfigMode("legacy");
          setFishingBaitTagsText("");
          setFishingBaseSuccessText("98");
          setFishingSpawnWeightBonusText("10");
          setFishingIscaUsesText("10");
          setFishingIscaGroupIdsText("");
          setFishingIscaSpeciesIdsText("");
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

  useEffect(() => {
    let alive = true;
    async function loadFishingGroups() {
      try {
        const snap = await getDocs(collection(db, "fishingGroups"));
        if (!alive) return;
        const rows: FishingGroupOption[] = [];
        snap.forEach((d) => {
          const data = d.data() as { name?: string };
          rows.push({ id: d.id.trim().toLowerCase(), name: String(data.name || d.id) });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        setFishingGroupOptions(rows);
      } catch {
        if (alive) setFishingGroupOptions([]);
      }
    }
    void loadFishingGroups();
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
    const fishingBaseSuccess = toNumberOrNull(fishingBaseSuccessText.trim());
    const fishingSpawnWeightBonus = toNumberOrNull(fishingSpawnWeightBonusText.trim());
    const fishingIscaUses = toNumberOrNull(fishingIscaUsesText.trim());
    const fishingTags = fishingBaitTagsText
      .split(/[,\|]/g)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    const iscaGroupIds = fishingIscaGroupIdsText
      .split(/[,\n]/g)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const iscaSpeciesIds = fishingIscaSpeciesIdsText
      .split(/[,\n]/g)
      .map((s) => Math.max(0, Math.trunc(Number(s.trim()) || 0)))
      .filter((n) => n > 0);

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

    if (fishingBaitEnabled) {
      if (fishingConfigMode === "isca-anzol") {
        if (fishingIscaUses === null || fishingIscaUses < 1) {
          setErrorMsg("Isca/Anzol: informe a quantidade de usos (numero inteiro >= 1).");
          return;
        }
        if (iscaGroupIds.length === 0 && iscaSpeciesIds.length === 0) {
          setErrorMsg("Isca/Anzol: informe ao menos um grupo de pesca (ID em fishingGroups) ou uma especie (ID).");
          return;
        }
      } else {
        if (fishingBaseSuccess === null || fishingBaseSuccess < 0 || fishingBaseSuccess > 100) {
          setErrorMsg("Informe uma taxa base de sucesso valida para a isca (0 a 100).");
          return;
        }
        if (fishingSpawnWeightBonus === null || fishingSpawnWeightBonus < 0) {
          setErrorMsg("Informe um bonus valido de aparicao para a isca.");
          return;
        }
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
      fishingConfig: fishingBaitEnabled
        ? fishingConfigMode === "isca-anzol" && fishingIscaUses != null
          ? {
              enabled: true,
              mode: "isca-anzol",
              uses: fishingIscaUses,
              fishingGroupIds: iscaGroupIds,
              fishingSpeciesIds: iscaSpeciesIds,
              baseSuccessPercent: 98,
              groupWeightBonusPercent: 0,
              attractTags: [],
            }
          : {
              enabled: true,
              mode: "legacy",
              baseSuccessPercent: fishingBaseSuccess,
              groupWeightBonusPercent: fishingSpawnWeightBonus,
              attractTags: fishingTags,
              uses: null,
              fishingGroupIds: null,
              fishingSpeciesIds: null,
            }
        : null,
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
          imageUrl: preferred,
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
          <div className="font-semibold">
            {item.name}
            {machineMoveName ? (
              <span className="ml-2 text-slate-300 font-normal">- {machineMoveName}</span>
            ) : null}
          </div>

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
                <Row
                  label="Movimento"
                  value={
                    machineMoveName
                      ? `${machineMoveName}${item.moveId ? ` (${item.moveId})` : ""}`
                      : item.moveId
                  }
                />
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

                <div className="mt-4 rounded-lg border border-sky-900/50 bg-slate-950/70 p-3">
                  <div className="text-sm font-semibold text-sky-200">Loja — Isca/Anzol e pesca classica</div>
                  <div className="mt-1 text-xs text-slate-400">
                    A opcao <b className="text-slate-200">Isca/Anzol</b> exige os tres campos abaixo (quantidade, grupos e/ou
                    individuais). A entrega e feita junto com a mochila.
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={fishingBaitEnabled}
                      onChange={(e) => {
                        setFishingBaitEnabled(e.target.checked);
                        if (!e.target.checked) setFishingConfigMode("legacy");
                      }}
                    />
                    Tratar como item de pesca na loja
                  </label>

                  <div className="mt-3">
                    <div className="text-xs text-slate-400 mb-1">Tipo de item (obrigatorio se for isca de loja)</div>
                    <select
                      className="w-full max-w-md px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                      value={fishingConfigMode}
                      onChange={(e) => {
                        const v = e.target.value === "isca-anzol" ? "isca-anzol" : "legacy";
                        if (v === "isca-anzol") setFishingBaitEnabled(true);
                        setFishingConfigMode(v);
                      }}
                    >
                      <option value="legacy">Classica (tags, peso e taxa de gancho na tabela)</option>
                      <option value="isca-anzol">Isca/Anzol</option>
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Isca/Anzol: 98% de gancho, sorteio so entre grupos/individuais (intersecao com o bioma ou NPC) e
                      consumo a cada tentativa, conforme o app.
                    </p>
                  </div>

                  {fishingBaitEnabled && fishingConfigMode === "isca-anzol" ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="text-xs text-slate-200 mb-1 font-medium">Quantidade (obrigatorio)</div>
                        <div className="text-[10px] text-slate-500 mb-1">Numero de usos da isca (tentativas) por unidade entregue na mochila.</div>
                        <input
                          className="w-full max-w-xs px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                          placeholder="ex.: 10"
                          value={fishingIscaUsesText}
                          onChange={(e) => setFishingIscaUsesText(e.target.value)}
                          inputMode="numeric"
                        />
                      </div>
                      <div>
                        <div className="text-xs text-slate-200 mb-1 font-medium">Grupos de Pokemon (obrigatorio: este campo e/ou o seguinte)</div>
                        <div className="text-[10px] text-slate-500 mb-1">IDs em <code className="text-cyan-400/90">fishingGroups</code>, separados por virgula (Admin: Pesca &gt; grupos).</div>
                        <input
                          className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                          placeholder="ex.: agua-doce, rios"
                          value={fishingIscaGroupIdsText}
                          onChange={(e) => setFishingIscaGroupIdsText(e.target.value)}
                        />
                        {fishingGroupOptions.length ? (
                          <div className="text-[10px] text-slate-500 mt-1">
                            Cadastrados: {fishingGroupOptions.map((g) => `${g.name} (${g.id})`).join(" · ")}
                          </div>
                        ) : null}
                      </div>
                      <div>
                        <div className="text-xs text-slate-200 mb-1 font-medium">Pokemon individuais (obrigatorio: este campo e/ou grupos acima)</div>
                        <div className="text-[10px] text-slate-500 mb-1">IDs nacionais (species), separados por virgula.</div>
                        <input
                          className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                          placeholder="ex.: 129, 130, 118"
                          value={fishingIscaSpeciesIdsText}
                          onChange={(e) => setFishingIscaSpeciesIdsText(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Tags atraidas</div>
                        <input
                          className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                          placeholder="water, rare"
                          value={fishingBaitTagsText}
                          disabled={!fishingBaitEnabled}
                          onChange={(e) => setFishingBaitTagsText(e.target.value)}
                        />
                      </div>

                      <div>
                        <div className="text-xs text-slate-400 mb-1">Taxa base de sucesso %</div>
                        <input
                          className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                          placeholder="98"
                          value={fishingBaseSuccessText}
                          disabled={!fishingBaitEnabled}
                          onChange={(e) => setFishingBaseSuccessText(e.target.value)}
                          inputMode="numeric"
                        />
                      </div>

                      <div>
                        <div className="text-xs text-slate-400 mb-1">Bonus de aparicao %</div>
                        <input
                          className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
                          placeholder="10"
                          value={fishingSpawnWeightBonusText}
                          disabled={!fishingBaitEnabled}
                          onChange={(e) => setFishingSpawnWeightBonusText(e.target.value)}
                          inputMode="numeric"
                        />
                      </div>
                    </div>
                  )}
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
