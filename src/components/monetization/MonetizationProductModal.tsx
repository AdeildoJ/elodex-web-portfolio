"use client";

import { useEffect, useRef, useState } from "react";

import { imageFileToStorableDataUrl } from "@/lib/imageProcessing";
import {
  EGG_TYPE_OPTIONS,
  POKEMON_TYPE_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  TICKET_TYPE_OPTIONS,
  createProductDraft,
  syncProductDerivedFields,
  type EggType,
  type GymTicketMode,
  type MonetizationProductType,
  type SupportedMonetizationProductDoc,
  type TicketSubtype,
} from "@/lib/monetizationCatalog";

type Option = {
  id: string;
  label: string;
};

type Props = {
  open: boolean;
  saving: boolean;
  product: SupportedMonetizationProductDoc | null;
  biomes: Option[];
  events: Option[];
  onClose: () => void;
  onSave: (product: SupportedMonetizationProductDoc) => Promise<void> | void;
};

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function MonetizationProductModal({
  open,
  saving,
  product,
  biomes,
  events,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<SupportedMonetizationProductDoc>(createProductDraft("slot"));
  const [localError, setLocalError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    setDraft(product ? syncProductDerivedFields(product) : createProductDraft("slot"));
  }, [open, product]);

  if (!open) return null;

  function updateCommon<K extends keyof SupportedMonetizationProductDoc>(key: K, value: SupportedMonetizationProductDoc[K]) {
    setDraft((current) => syncProductDerivedFields({ ...current, [key]: value }));
  }

  function switchType(nextType: MonetizationProductType) {
    setDraft((current) => {
      const nextDraft = createProductDraft(nextType, current.sortOrder);
      return syncProductDerivedFields({
        ...nextDraft,
        id: current.id,
        code: current.code,
        name: current.name,
        description: current.description,
        imageUrl: current.imageUrl,
        price: current.price,
        status: current.status,
        storeVisible: current.storeVisible,
        sortOrder: current.sortOrder,
        paymentProvider: current.paymentProvider,
        paymentProductId: current.paymentProductId,
      });
    });
  }

  async function handleImagePick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToStorableDataUrl(file, 512, 0.78);
      updateCommon("imageUrl", dataUrl);
    } catch {
      setLocalError("Nao foi possivel processar a imagem do produto.");
    }
  }

  async function handleSubmit() {
    setLocalError(null);
    const normalized = syncProductDerivedFields({
      ...draft,
      id: slugify(draft.id || draft.code || draft.name),
      code: slugify(draft.code || draft.id || draft.name),
    });

    if (!normalized.id) {
      setLocalError("Informe nome ou codigo suficiente para gerar o identificador.");
      return;
    }

    await onSave(normalized);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              {product ? "Editar produto monetizado" : "Novo produto monetizado"}
            </h2>
            <p className="text-sm text-slate-400">Escolha o tipo primeiro. O restante do formulario se adapta sozinho.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Fechar
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {localError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {localError}
            </div>
          ) : null}

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm text-slate-200">
                Tipo do Produto
                <select
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.type}
                  onChange={(e) => switchType(e.target.value as MonetizationProductType)}
                >
                  {PRODUCT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-200">
                Nome do produto
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.name}
                  onChange={(e) => updateCommon("name", e.target.value)}
                />
              </label>

              <label className="text-sm text-slate-200">
                SKU / codigo interno
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.code}
                  onChange={(e) => updateCommon("code", slugify(e.target.value))}
                />
              </label>

              <label className="text-sm text-slate-200">
                ID do documento
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.id}
                  onChange={(e) => updateCommon("id", slugify(e.target.value))}
                  placeholder="Opcional. Se vazio, gera pelo nome/codigo."
                />
              </label>

              <label className="text-sm text-slate-200">
                Preco
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.price}
                  onChange={(e) => updateCommon("price", Math.max(0, parseNumber(e.target.value, 0)))}
                />
              </label>

              <label className="text-sm text-slate-200">
                Ordem de exibicao
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.sortOrder}
                  onChange={(e) => updateCommon("sortOrder", Math.max(1, Math.floor(parseNumber(e.target.value, 1))))}
                />
              </label>

              <label className="text-sm text-slate-200">
                Status
                <select
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={draft.status}
                  onChange={(e) => updateCommon("status", e.target.value === "inactive" ? "inactive" : "active")}
                >
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>

              <label className="flex items-center gap-2 pt-7 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={draft.storeVisible !== false}
                  onChange={(e) => updateCommon("storeVisible", e.target.checked)}
                />
                Visivel na loja
              </label>
            </div>

            <label className="mt-4 block text-sm text-slate-200">
              Descricao
              <textarea
                className="mt-1 min-h-28 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={draft.description}
                onChange={(e) => updateCommon("description", e.target.value)}
              />
            </label>

            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImagePick(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-900"
                >
                  Upload de imagem/icone
                </button>
                <input
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  placeholder="Ou informe uma URL/data URL manualmente"
                  value={draft.imageUrl || ""}
                  onChange={(e) => updateCommon("imageUrl", e.target.value)}
                />
              </div>
              {draft.imageUrl ? (
                <div className="mt-3 flex items-center gap-3">
                  <img
                    src={draft.imageUrl}
                    alt={draft.name || "Produto"}
                    className="h-16 w-16 rounded-lg border border-slate-700 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => updateCommon("imageUrl", "")}
                    className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-200 hover:bg-red-500/10"
                  >
                    Remover imagem
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Configuracao por tipo</h3>

            {draft.configuration.kind === "slot" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-200">
                  Slots adicionados
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.slotsAdded}
                    onChange={(e) =>
                      setDraft((current) =>
                        syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "slot",
                            slotScope: "gym",
                            slotsAdded: Math.max(1, Math.floor(parseNumber(e.target.value, 1))),
                          },
                        })
                      )
                    }
                  />
                </label>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                  Um lider de GYM inicia com 1 slot. Este produto aumenta a capacidade de defesa do GYM.
                </div>
              </div>
            ) : null}

            {draft.configuration.kind === "expansion" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-200">
                  Quantidade adicionada
                  <input
                    type="number"
                    min="10"
                    step="10"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.storageSlotsAdded}
                    onChange={(e) =>
                      setDraft((current) =>
                        syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "expansion",
                            storageSlotsAdded: Math.max(10, Math.floor(parseNumber(e.target.value, 10))),
                          },
                        })
                      )
                    }
                  />
                </label>
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                  Padrao atual: cada produto Expansao adiciona +10 espacos na BOX.
                </div>
              </div>
            ) : null}

            {draft.configuration.kind === "incubator" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-200">
                  Dias para chocar
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.hatchDays}
                    onChange={(e) =>
                      setDraft((current) => {
                        if (current.configuration.kind !== "incubator") return current;
                        return syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "incubator",
                            hatchDays: Math.max(1, Math.floor(parseNumber(e.target.value, 1))),
                            incubatorCount: current.configuration.incubatorCount,
                          },
                        });
                      })
                    }
                  />
                </label>
                <label className="text-sm text-slate-200">
                  Quantidade de incubadoras entregue
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.incubatorCount}
                    onChange={(e) =>
                      setDraft((current) => {
                        if (current.configuration.kind !== "incubator") return current;
                        return syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "incubator",
                            hatchDays: current.configuration.hatchDays,
                            incubatorCount: Math.max(1, Math.floor(parseNumber(e.target.value, 1))),
                          },
                        });
                      })
                    }
                  />
                </label>
              </div>
            ) : null}

            {draft.configuration.kind === "ticket" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-200">
                  Tipo de Ticket
                  <select
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.ticketSubtype}
                    onChange={(e) =>
                      setDraft((current) =>
                        syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "ticket",
                            ticketSubtype: e.target.value as TicketSubtype,
                            biomeId: null,
                            eventId: null,
                            gymMode: e.target.value === "gym" ? "permanent" : null,
                            gymDurationDays: null,
                          },
                        })
                      )
                    }
                  >
                    {TICKET_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.configuration.ticketSubtype === "biome" ? (
                  <label className="text-sm text-slate-200">
                    Bioma liberado
                    <select
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      value={draft.configuration.biomeId || ""}
                      onChange={(e) =>
                        setDraft((current) => {
                          if (current.configuration.kind !== "ticket") return current;
                          return syncProductDerivedFields({
                            ...current,
                            configuration: {
                              kind: "ticket",
                              ticketSubtype: "biome",
                              biomeId: e.target.value || null,
                              eventId: null,
                              gymMode: null,
                              gymDurationDays: null,
                            },
                          });
                        })
                      }
                    >
                      <option value="">Selecione um bioma</option>
                      {biomes.map((biome) => (
                        <option key={biome.id} value={biome.id}>
                          {biome.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {draft.configuration.ticketSubtype === "event" ? (
                  <label className="text-sm text-slate-200">
                    Evento vinculado
                    <select
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      value={draft.configuration.eventId || ""}
                      onChange={(e) =>
                        setDraft((current) => {
                          if (current.configuration.kind !== "ticket") return current;
                          return syncProductDerivedFields({
                            ...current,
                            configuration: {
                              kind: "ticket",
                              ticketSubtype: "event",
                              biomeId: null,
                              eventId: e.target.value || null,
                              gymMode: null,
                              gymDurationDays: null,
                            },
                          });
                        })
                      }
                    >
                      <option value="">Selecione um evento</option>
                      {events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {draft.configuration.ticketSubtype === "gym" ? (
                  <>
                    <label className="text-sm text-slate-200">
                      Modalidade do ticket GYM
                      <select
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        value={draft.configuration.gymMode || "permanent"}
                        onChange={(e) =>
                          setDraft((current) => {
                            if (current.configuration.kind !== "ticket") return current;
                            const gymMode = (e.target.value as GymTicketMode) || "permanent";
                            return syncProductDerivedFields({
                              ...current,
                              configuration: {
                                kind: "ticket",
                                ticketSubtype: "gym",
                                biomeId: null,
                                eventId: null,
                                gymMode,
                                gymDurationDays: gymMode === "temporary" ? current.configuration.gymDurationDays || 1 : null,
                              },
                            });
                          })
                        }
                      >
                        <option value="permanent">Permanente</option>
                        <option value="temporary">Temporario</option>
                      </select>
                    </label>
                    {draft.configuration.gymMode === "temporary" ? (
                      <label className="text-sm text-slate-200">
                        Duracao em dias
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                          value={draft.configuration.gymDurationDays || 1}
                          onChange={(e) =>
                            setDraft((current) => {
                              if (current.configuration.kind !== "ticket") return current;
                              return syncProductDerivedFields({
                                ...current,
                                configuration: {
                                  kind: "ticket",
                                  ticketSubtype: "gym",
                                  biomeId: null,
                                  eventId: null,
                                  gymMode: "temporary",
                                  gymDurationDays: Math.max(1, Math.floor(parseNumber(e.target.value, 1))),
                                },
                              });
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100 md:col-span-2">
                      O ticket GYM e consumido ao criar o GYM. Tickets temporarios renovam o mesmo GYM quando ele estiver bloqueado por expiracao.
                    </div>
                  </>
                ) : null}

                {draft.configuration.ticketSubtype === "castle" ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100 md:col-span-2">
                    Este ticket libera o acesso futuro ao Castelo de Batalha.
                  </div>
                ) : null}
              </div>
            ) : null}

            {draft.configuration.kind === "egg" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-200">
                  Tipo de Egg
                  <select
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.eggType}
                    onChange={(e) =>
                      setDraft((current) =>
                        syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "egg",
                            eggType: e.target.value as EggType,
                            pseudoLegendaryChancePercent: 5,
                            pokemonType: null,
                          },
                        })
                      )
                    }
                  >
                    {EGG_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.configuration.eggType === "mysterious" ? (
                  <label className="text-sm text-slate-200">
                    Chance (%) de vir pseudo-lendario
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      value={draft.configuration.pseudoLegendaryChancePercent}
                      onChange={(e) =>
                        setDraft((current) => {
                          if (current.configuration.kind !== "egg") return current;
                          return syncProductDerivedFields({
                            ...current,
                            configuration: {
                              kind: "egg",
                              eggType: "mysterious",
                              pseudoLegendaryChancePercent: Math.min(100, Math.max(0, parseNumber(e.target.value, 0))),
                              pokemonType: null,
                            },
                          });
                        })
                      }
                    />
                  </label>
                ) : null}

                {draft.configuration.eggType === "type" ? (
                  <label className="text-sm text-slate-200">
                    Tipo do ovo
                    <select
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      value={draft.configuration.pokemonType || ""}
                      onChange={(e) =>
                        setDraft((current) => {
                          if (current.configuration.kind !== "egg") return current;
                          return syncProductDerivedFields({
                            ...current,
                            configuration: {
                              kind: "egg",
                              eggType: "type",
                              pseudoLegendaryChancePercent: 0,
                              pokemonType: e.target.value || null,
                            },
                          });
                        })
                      }
                    >
                      <option value="">Selecione um tipo</option>
                      {POKEMON_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300 md:col-span-2">
                  Egg por tipo nunca gera Pokemon mitico ou lendario. Egg misterioso usa regras aleatorias do sistema.
                </div>
              </div>
            ) : null}

            {draft.configuration.kind === "iv_reset" ? (
              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                Produto basico sem campos adicionais. O item sera usado futuramente para reset de IV.
              </div>
            ) : null}

            {draft.configuration.kind === "trainer_license" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-200">
                  Duracao da licenca (dias)
                  <input
                    type="number"
                    min="1"
                    max="7"
                    step="1"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.durationDays}
                    onChange={(e) =>
                      setDraft((current) => {
                        if (current.configuration.kind !== "trainer_license") return current;
                        return syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "trainer_license",
                            durationDays: Math.min(7, Math.max(1, Math.floor(parseNumber(e.target.value, 1)))),
                            xpBonusPercent: current.configuration.xpBonusPercent,
                            shinyBonusPercent: current.configuration.shinyBonusPercent,
                            biomeAccessIds: current.configuration.biomeAccessIds,
                          },
                        });
                      })
                    }
                  />
                </label>
                <label className="text-sm text-slate-200">
                  Bonus de EXP (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.xpBonusPercent}
                    onChange={(e) =>
                      setDraft((current) => {
                        if (current.configuration.kind !== "trainer_license") return current;
                        return syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "trainer_license",
                            durationDays: current.configuration.durationDays,
                            xpBonusPercent: Math.min(100, Math.max(0, parseNumber(e.target.value, 0))),
                            shinyBonusPercent: current.configuration.shinyBonusPercent,
                            biomeAccessIds: current.configuration.biomeAccessIds,
                          },
                        });
                      })
                    }
                  />
                </label>
                <label className="text-sm text-slate-200">
                  Bonus de shiny (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={draft.configuration.shinyBonusPercent}
                    onChange={(e) =>
                      setDraft((current) => {
                        if (current.configuration.kind !== "trainer_license") return current;
                        return syncProductDerivedFields({
                          ...current,
                          configuration: {
                            kind: "trainer_license",
                            durationDays: current.configuration.durationDays,
                            xpBonusPercent: current.configuration.xpBonusPercent,
                            shinyBonusPercent: Math.min(100, Math.max(0, parseNumber(e.target.value, 0))),
                            biomeAccessIds: current.configuration.biomeAccessIds,
                          },
                        });
                      })
                    }
                  />
                </label>

                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 md:col-span-2">
                  <div className="mb-2 text-sm font-semibold text-slate-100">Biomas liberados pela licenca</div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {biomes.map((biome) => {
                      const checked = draft.configuration.kind === "trainer_license"
                        ? draft.configuration.biomeAccessIds.includes(biome.id)
                        : false;
                      return (
                        <label
                          key={biome.id}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                            checked
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                              : "border-slate-700 bg-slate-950 text-slate-200"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDraft((current) => {
                                if (current.configuration.kind !== "trainer_license") return current;
                                const nextIds = checked
                                  ? current.configuration.biomeAccessIds.filter((id) => id !== biome.id)
                                  : [...current.configuration.biomeAccessIds, biome.id];
                                return syncProductDerivedFields({
                                  ...current,
                                  configuration: {
                                    kind: "trainer_license",
                                    durationDays: current.configuration.durationDays,
                                    xpBonusPercent: current.configuration.xpBonusPercent,
                                    shinyBonusPercent: current.configuration.shinyBonusPercent,
                                    biomeAccessIds: nextIds,
                                  },
                                });
                              })
                            }
                          />
                          {biome.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar produto"}
          </button>
        </div>
      </div>
    </div>
  );
}

