export type MonetizationStatus = "active" | "inactive";
export type MonetizationCurrency = "BRL";
export type MonetizationProductType =
  | "slot"
  | "expansion"
  | "incubator"
  | "ticket"
  | "egg"
  | "iv_reset"
  | "trainer_license";

export type LegacyMonetizationProductType =
  | "biome_ticket"
  | "mystery_egg"
  | "gym_ticket"
  | "gym_police_npc"
  | "gym_extra_npc"
  | "gym_badges"
  | "gym_type_egg"
  | "gym_storage_upgrade"
  | "gym_main_team_slot"
  | "battle_castle_ticket"
  | "exclusive_event_ticket";

export type ProductType = MonetizationProductType | LegacyMonetizationProductType;
export type TicketSubtype = "biome" | "gym" | "castle" | "event";
export type GymTicketMode = "permanent" | "temporary";
export type EggType = "mysterious" | "type";
export type VipIncludedItemSource = "item_config" | "monetization_product" | "ecoin_package";

export const PRODUCT_TYPE_OPTIONS: Array<{ value: MonetizationProductType; label: string }> = [
  { value: "slot", label: "Slot" },
  { value: "expansion", label: "Expansao" },
  { value: "incubator", label: "Incubadora" },
  { value: "ticket", label: "Ticket" },
  { value: "egg", label: "Egg" },
  { value: "iv_reset", label: "IV Reset" },
  { value: "trainer_license", label: "Licenca de Treinador" },
];

export const TICKET_TYPE_OPTIONS: Array<{ value: TicketSubtype; label: string }> = [
  { value: "biome", label: "Bioma" },
  { value: "gym", label: "GYM" },
  { value: "castle", label: "Castelo" },
  { value: "event", label: "Evento" },
];

export const EGG_TYPE_OPTIONS: Array<{ value: EggType; label: string }> = [
  { value: "mysterious", label: "Misterioso" },
  { value: "type", label: "Tipo" },
];

export const POKEMON_TYPE_OPTIONS = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type PokemonTypeOption = (typeof POKEMON_TYPE_OPTIONS)[number];

export type VipBenefitSet = {
  maxCharacters: number;
  maxCapturedPokemon: number;
  maxStorageItems: number;
  xpBonusPercent: number;
  moneyBonusPercent: number;
  weeklyIncubators: number;
};

export type VipIncludedItemRef = {
  id: string;
  source: VipIncludedItemSource;
  refId: string;
  refCode?: string | null;
  name: string;
  categoryLabel?: string | null;
  quantity: number;
};

export type VipPlanDoc = {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  currency: MonetizationCurrency;
  durationDays: number;
  status: MonetizationStatus;
  benefits: VipBenefitSet;
  includedItems: VipIncludedItemRef[];
  paymentProvider?: string | null;
  paymentProductId?: string | null;
  sortOrder: number;
};

export type MonetizationProductBenefitSet = {
  expansionSlots?: number | null;
  incubators?: number | null;
  biomeTicketCount?: number | null;
  mysteryEggCount?: number | null;
  ivResetCount?: number | null;
  trainerLicenseDays?: number | null;
  gymTicketCount?: number | null;
  gymDefenseSlotsAdded?: number | null;
  gymMainTeamSlots?: number | null;
  battleCastleTicketCount?: number | null;
  exclusiveEventTicketCount?: number | null;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ProductBase = {
  id: string;
  code: string;
  type: ProductType;
  name: string;
  description: string;
  imageUrl?: string | null;
  durationDays: number | null;
  price: number;
  currency: MonetizationCurrency;
  status: MonetizationStatus;
  storeVisible: boolean;
  benefits: MonetizationProductBenefitSet;
  paymentProvider?: string | null;
  paymentProductId?: string | null;
  grantType: "entitlement";
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type SlotProductConfig = {
  kind: "slot";
  slotScope: "gym";
  slotsAdded: number;
};

export type ExpansionProductConfig = {
  kind: "expansion";
  storageSlotsAdded: number;
};

export type IncubatorProductConfig = {
  kind: "incubator";
  hatchDays: number;
  incubatorCount: number;
};

export type TicketProductConfig = {
  kind: "ticket";
  ticketSubtype: TicketSubtype;
  biomeId: string | null;
  eventId: string | null;
  gymMode: GymTicketMode | null;
  gymDurationDays: number | null;
};

export type EggProductConfig = {
  kind: "egg";
  eggType: EggType;
  pseudoLegendaryChancePercent: number;
  pokemonType: string | null;
};

export type IvResetProductConfig = {
  kind: "iv_reset";
};

export type TrainerLicenseProductConfig = {
  kind: "trainer_license";
  durationDays: number;
  xpBonusPercent: number;
  shinyBonusPercent: number;
  biomeAccessIds: string[];
};

export type LegacyProductConfig = {
  kind: "legacy";
  legacyType: LegacyMonetizationProductType;
};

export type MonetizationProductConfig =
  | SlotProductConfig
  | ExpansionProductConfig
  | IncubatorProductConfig
  | TicketProductConfig
  | EggProductConfig
  | IvResetProductConfig
  | TrainerLicenseProductConfig
  | LegacyProductConfig;

export type SupportedMonetizationProductDoc = ProductBase & {
  type: MonetizationProductType;
  configuration: Exclude<MonetizationProductConfig, LegacyProductConfig>;
};

export type LegacyMonetizationProductDoc = ProductBase & {
  type: LegacyMonetizationProductType;
  configuration: LegacyProductConfig;
};

export type MonetizationProductDoc = SupportedMonetizationProductDoc | LegacyMonetizationProductDoc;

type RawMonetizationProductDoc = Partial<ProductBase> & {
  configuration?: unknown;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toMetadataString(metadata: Record<string, string | number | boolean | null> | undefined, key: string) {
  const raw = metadata?.[key];
  return raw == null ? "" : String(raw).trim();
}

function toMetadataStringList(metadata: Record<string, string | number | boolean | null> | undefined, key: string) {
  return toMetadataString(metadata, key)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeVipIncludedItem(input: Partial<VipIncludedItemRef> | null | undefined): VipIncludedItemRef | null {
  if (!input) return null;
  const source = input.source;
  if (source !== "item_config" && source !== "monetization_product" && source !== "ecoin_package") {
    return null;
  }
  const refId = String(input.refId || "").trim();
  const name = String(input.name || "").trim();
  if (!refId || !name) return null;
  return {
    id: String(input.id || `${source}:${refId}`).trim(),
    source,
    refId,
    refCode: input.refCode ? String(input.refCode).trim() : null,
    name,
    categoryLabel: input.categoryLabel ? String(input.categoryLabel).trim() : null,
    quantity: Math.max(1, Math.floor(toNumber(input.quantity, 1))),
  };
}

export function normalizeVipPlan(raw: Partial<VipPlanDoc> | null | undefined, id: string): VipPlanDoc {
  return {
    id,
    code: String(raw?.code || id).trim().toLowerCase(),
    name: String(raw?.name || id),
    description: String(raw?.description || ""),
    price: Math.max(0, toNumber(raw?.price, 0)),
    currency: "BRL",
    durationDays: Math.max(1, Math.floor(toNumber(raw?.durationDays, 30))),
    status: raw?.status === "inactive" ? "inactive" : "active",
    benefits: {
      maxCharacters: Math.max(1, Math.floor(toNumber(raw?.benefits?.maxCharacters, 3))),
      maxCapturedPokemon: Math.max(1, Math.floor(toNumber(raw?.benefits?.maxCapturedPokemon, 50))),
      maxStorageItems: Math.max(1, Math.floor(toNumber(raw?.benefits?.maxStorageItems, 50))),
      xpBonusPercent: Math.max(0, toNumber(raw?.benefits?.xpBonusPercent, 0)),
      moneyBonusPercent: Math.max(0, toNumber(raw?.benefits?.moneyBonusPercent, 0)),
      weeklyIncubators: Math.max(0, Math.floor(toNumber(raw?.benefits?.weeklyIncubators, 0))),
    },
    includedItems: Array.isArray(raw?.includedItems)
      ? raw!.includedItems.map(normalizeVipIncludedItem).filter((item): item is VipIncludedItemRef => Boolean(item))
      : [],
    paymentProvider: raw?.paymentProvider ?? null,
    paymentProductId: raw?.paymentProductId ?? null,
    sortOrder: Math.max(1, Math.floor(toNumber(raw?.sortOrder, 1))),
  };
}

export function isSupportedProductType(type: string): type is MonetizationProductType {
  return PRODUCT_TYPE_OPTIONS.some((option) => option.value === type);
}

export function isLegacyProduct(product: MonetizationProductDoc): product is LegacyMonetizationProductDoc {
  return product.configuration.kind === "legacy";
}

export function createProductDraft(
  type: MonetizationProductType = "slot",
  sortOrder = 1
): SupportedMonetizationProductDoc {
  const base: Omit<SupportedMonetizationProductDoc, "type" | "configuration" | "durationDays" | "benefits"> = {
    id: "",
    code: "",
    name: "",
    description: "",
    imageUrl: "",
    price: 0,
    currency: "BRL",
    status: "active",
    storeVisible: true,
    paymentProvider: null,
    paymentProductId: null,
    grantType: "entitlement",
    sortOrder,
  };

  if (type === "slot") {
    return {
      ...base,
      type,
      durationDays: null,
      configuration: { kind: "slot", slotScope: "gym", slotsAdded: 1 },
      benefits: { gymDefenseSlotsAdded: 1, metadata: { productType: "slot", slotScope: "gym", slotsAdded: 1 } },
    };
  }
  if (type === "expansion") {
    return {
      ...base,
      type,
      durationDays: null,
      configuration: { kind: "expansion", storageSlotsAdded: 10 },
      benefits: { expansionSlots: 10, metadata: { productType: "expansion", expansionSlots: 10 } },
    };
  }
  if (type === "incubator") {
    return {
      ...base,
      type,
      durationDays: null,
      configuration: { kind: "incubator", hatchDays: 3, incubatorCount: 1 },
      benefits: { incubators: 1, metadata: { productType: "incubator", hatchDays: 3, incubatorCount: 1 } },
    };
  }
  if (type === "ticket") {
    return {
      ...base,
      type,
      durationDays: null,
      configuration: {
        kind: "ticket",
        ticketSubtype: "biome",
        biomeId: null,
        eventId: null,
        gymMode: null,
        gymDurationDays: null,
      },
      benefits: { biomeTicketCount: 1, metadata: { productType: "ticket", ticketSubtype: "biome" } },
    };
  }
  if (type === "egg") {
    return {
      ...base,
      type,
      durationDays: null,
      configuration: { kind: "egg", eggType: "mysterious", pseudoLegendaryChancePercent: 5, pokemonType: null },
      benefits: {
        mysteryEggCount: 1,
        metadata: { productType: "egg", eggType: "mysterious", pseudoLegendaryChancePercent: 5 },
      },
    };
  }
  if (type === "iv_reset") {
    return {
      ...base,
      type,
      durationDays: null,
      configuration: { kind: "iv_reset" },
      benefits: { ivResetCount: 1, metadata: { productType: "iv_reset" } },
    };
  }
  return {
    ...base,
    type: "trainer_license",
    durationDays: 7,
    configuration: {
      kind: "trainer_license",
      durationDays: 7,
      xpBonusPercent: 0,
      shinyBonusPercent: 0,
      biomeAccessIds: [],
    },
    benefits: {
      trainerLicenseDays: 7,
      metadata: { productType: "trainer_license", xpBonusPercent: 0, shinyBonusPercent: 0, biomeAccessIds: "" },
    },
  };
}

export function syncProductDerivedFields(product: SupportedMonetizationProductDoc): SupportedMonetizationProductDoc {
  const base = {
    ...product,
    code: String(product.code || "").trim().toLowerCase(),
    imageUrl: String(product.imageUrl || "").trim(),
  };

  if (product.configuration.kind === "slot") {
    const slotsAdded = Math.max(1, Math.floor(toNumber(product.configuration.slotsAdded, 1)));
    return {
      ...base,
      durationDays: null,
      configuration: { kind: "slot", slotScope: "gym", slotsAdded },
      benefits: {
        gymDefenseSlotsAdded: slotsAdded,
        metadata: { productType: "slot", slotScope: "gym", slotsAdded },
      },
    };
  }

  if (product.configuration.kind === "expansion") {
    const storageSlotsAdded = Math.max(1, Math.floor(toNumber(product.configuration.storageSlotsAdded, 10)));
    return {
      ...base,
      durationDays: null,
      configuration: { kind: "expansion", storageSlotsAdded },
      benefits: {
        expansionSlots: storageSlotsAdded,
        metadata: { productType: "expansion", expansionSlots: storageSlotsAdded },
      },
    };
  }

  if (product.configuration.kind === "incubator") {
    const hatchDays = Math.max(
      1,
      Math.floor(toNumber((product.configuration as Partial<IncubatorProductConfig> & { distanceKm?: number }).hatchDays ?? (product.configuration as { distanceKm?: number }).distanceKm, 3))
    );
    const incubatorCount = Math.max(1, Math.floor(toNumber(product.configuration.incubatorCount, 1)));
    return {
      ...base,
      durationDays: null,
      configuration: { kind: "incubator", hatchDays, incubatorCount },
      benefits: {
        incubators: incubatorCount,
        metadata: { productType: "incubator", hatchDays, incubatorCount },
      },
    };
  }

  if (product.configuration.kind === "ticket") {
    const ticketSubtype = product.configuration.ticketSubtype;
    const biomeId = product.configuration.biomeId ? String(product.configuration.biomeId).trim().toLowerCase() : null;
    const eventId = product.configuration.eventId ? String(product.configuration.eventId).trim() : null;
    const gymMode = ticketSubtype === "gym" ? product.configuration.gymMode || "permanent" : null;
    const gymDurationDays =
      ticketSubtype === "gym" && gymMode === "temporary"
        ? Math.max(1, Math.floor(toNumber(product.configuration.gymDurationDays, 1)))
        : null;
    return {
      ...base,
      durationDays: null,
      configuration: {
        kind: "ticket",
        ticketSubtype,
        biomeId,
        eventId,
        gymMode,
        gymDurationDays,
      },
      benefits: {
        biomeTicketCount: ticketSubtype === "biome" ? 1 : 0,
        gymTicketCount: ticketSubtype === "gym" ? 1 : 0,
        battleCastleTicketCount: ticketSubtype === "castle" ? 1 : 0,
        exclusiveEventTicketCount: ticketSubtype === "event" ? 1 : 0,
        metadata: {
          productType: "ticket",
          ticketSubtype,
          ticketType: ticketSubtype,
          biomeId: biomeId || "",
          eventId: eventId || "",
          gymTicketMode: gymMode || "",
          gymDurationDays: gymDurationDays ?? "",
        },
      },
    };
  }

  if (product.configuration.kind === "egg") {
    const eggType = product.configuration.eggType;
    const pseudoLegendaryChancePercent = clamp(toNumber(product.configuration.pseudoLegendaryChancePercent, 0), 0, 100);
    const pokemonType = product.configuration.pokemonType ? String(product.configuration.pokemonType).trim().toLowerCase() : null;
    return {
      ...base,
      durationDays: null,
      configuration: { kind: "egg", eggType, pseudoLegendaryChancePercent, pokemonType },
      benefits: {
        mysteryEggCount: 1,
        metadata: {
          productType: "egg",
          eggType,
          pseudoLegendaryChancePercent,
          pokemonType: pokemonType || "",
        },
      },
    };
  }

  if (product.configuration.kind === "iv_reset") {
    return {
      ...base,
      durationDays: null,
      configuration: { kind: "iv_reset" },
      benefits: { ivResetCount: 1, metadata: { productType: "iv_reset" } },
    };
  }

  const durationDays = clamp(Math.floor(toNumber(product.configuration.durationDays, 7)), 1, 7);
  const xpBonusPercent = clamp(toNumber(product.configuration.xpBonusPercent, 0), 0, 100);
  const shinyBonusPercent = clamp(toNumber(product.configuration.shinyBonusPercent, 0), 0, 100);
  const biomeAccessIds = Array.from(
    new Set(product.configuration.biomeAccessIds.map((value) => String(value).trim().toLowerCase()).filter(Boolean))
  );
  return {
    ...base,
    durationDays,
    configuration: { kind: "trainer_license", durationDays, xpBonusPercent, shinyBonusPercent, biomeAccessIds },
    benefits: {
      trainerLicenseDays: durationDays,
      metadata: {
        productType: "trainer_license",
        xpBonusPercent,
        shinyBonusPercent,
        biomeAccessIds: biomeAccessIds.join(","),
      },
    },
  };
}

export function serializeMonetizationProduct(product: MonetizationProductDoc) {
  return isLegacyProduct(product) ? product : syncProductDerivedFields(product);
}

function normalizeSupportedProduct(
  input: RawMonetizationProductDoc & { id: string; type: MonetizationProductType }
): SupportedMonetizationProductDoc {
  const metadata = input.benefits?.metadata || {};
  const sortOrder = Math.max(1, Math.floor(toNumber(input.sortOrder, 1)));
  const base = createProductDraft(input.type, sortOrder);
  const common: SupportedMonetizationProductDoc = {
    ...base,
    id: String(input.id || ""),
    code: String(input.code || input.id || ""),
    name: String(input.name || ""),
    description: String(input.description || ""),
    imageUrl: String(input.imageUrl || ""),
    price: Math.max(0, toNumber(input.price, 0)),
    currency: "BRL",
    status: input.status === "inactive" ? "inactive" : "active",
    storeVisible: input.storeVisible !== false,
    paymentProvider: input.paymentProvider ?? null,
    paymentProductId: input.paymentProductId ?? null,
    grantType: "entitlement",
    sortOrder,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    durationDays: input.durationDays ?? base.durationDays,
    benefits: input.benefits || base.benefits,
    configuration: base.configuration,
  };

  if (input.type === "slot") {
    return syncProductDerivedFields({
      ...common,
      type: "slot",
      configuration: {
        kind: "slot",
        slotScope: "gym",
        slotsAdded: Math.max(
          1,
          Math.floor(
            toNumber(
              (input.configuration as Partial<SlotProductConfig> | undefined)?.slotsAdded ??
                input.benefits?.gymDefenseSlotsAdded ??
                metadata.slotsAdded,
              1
            )
          )
        ),
      },
    });
  }

  if (input.type === "expansion") {
    return syncProductDerivedFields({
      ...common,
      type: "expansion",
      configuration: {
        kind: "expansion",
        storageSlotsAdded: Math.max(
          1,
          Math.floor(
            toNumber(
              (input.configuration as Partial<ExpansionProductConfig> | undefined)?.storageSlotsAdded ??
                input.benefits?.expansionSlots,
              10
            )
          )
        ),
      },
    });
  }

  if (input.type === "incubator") {
    return syncProductDerivedFields({
      ...common,
      type: "incubator",
      configuration: {
        kind: "incubator",
        hatchDays: Math.max(
          1,
          Math.floor(
            toNumber(
              (input.configuration as Partial<IncubatorProductConfig> | undefined)?.hatchDays ??
                metadata.hatchDays ??
                metadata.distanceKm,
              3
            )
          )
        ),
        incubatorCount: Math.max(
          1,
          Math.floor(
            toNumber(
              (input.configuration as Partial<IncubatorProductConfig> | undefined)?.incubatorCount ??
                input.benefits?.incubators,
              1
            )
          )
        ),
      },
    });
  }

  if (input.type === "ticket") {
    const config = (input.configuration as Partial<TicketProductConfig> | undefined) || {};
    const ticketSubtype = ((config.ticketSubtype || metadata.ticketSubtype || metadata.ticketType) as TicketSubtype) || "biome";
    const gymTicketMode = ((config.gymMode || metadata.gymTicketMode) as GymTicketMode) || null;
    return syncProductDerivedFields({
      ...common,
      type: "ticket",
      configuration: {
        kind: "ticket",
        ticketSubtype,
        biomeId: config.biomeId ?? (toMetadataString(metadata, "biomeId") || null),
        eventId: config.eventId ?? (toMetadataString(metadata, "eventId") || null),
        gymMode: ticketSubtype === "gym" ? gymTicketMode || "permanent" : null,
        gymDurationDays:
          ticketSubtype === "gym"
            ? Math.max(1, Math.floor(toNumber(config.gymDurationDays ?? metadata.gymDurationDays, 1)))
            : null,
      },
    });
  }

  if (input.type === "egg") {
    return syncProductDerivedFields({
      ...common,
      type: "egg",
      configuration: {
        kind: "egg",
        eggType: (((input.configuration as Partial<EggProductConfig> | undefined)?.eggType || metadata.eggType) as EggType) || "mysterious",
        pseudoLegendaryChancePercent: clamp(
          toNumber(
            (input.configuration as Partial<EggProductConfig> | undefined)?.pseudoLegendaryChancePercent ??
              metadata.pseudoLegendaryChancePercent,
            5
          ),
          0,
          100
        ),
        pokemonType:
          (input.configuration as Partial<EggProductConfig> | undefined)?.pokemonType ??
          (toMetadataString(metadata, "pokemonType") || null),
      },
    });
  }

  if (input.type === "iv_reset") {
    return syncProductDerivedFields({ ...common, type: "iv_reset", configuration: { kind: "iv_reset" } });
  }

  return syncProductDerivedFields({
    ...common,
    type: "trainer_license",
    configuration: {
      kind: "trainer_license",
      durationDays: clamp(
        Math.floor(
          toNumber(
            (input.configuration as Partial<TrainerLicenseProductConfig> | undefined)?.durationDays ??
              input.durationDays ??
              input.benefits?.trainerLicenseDays,
            7
          )
        ),
        1,
        7
      ),
      xpBonusPercent: clamp(
        toNumber(
          (input.configuration as Partial<TrainerLicenseProductConfig> | undefined)?.xpBonusPercent ??
            metadata.xpBonusPercent,
          0
        ),
        0,
        100
      ),
      shinyBonusPercent: clamp(
        toNumber(
          (input.configuration as Partial<TrainerLicenseProductConfig> | undefined)?.shinyBonusPercent ??
            metadata.shinyBonusPercent,
          0
        ),
        0,
        100
      ),
      biomeAccessIds:
        (input.configuration as Partial<TrainerLicenseProductConfig> | undefined)?.biomeAccessIds ??
        toMetadataStringList(metadata, "biomeAccessIds"),
    },
  });
}

export function normalizeMonetizationProduct(raw: RawMonetizationProductDoc | null | undefined, id: string): MonetizationProductDoc {
  const type = String(raw?.type || "").trim().toLowerCase();
  const input = { id, ...(raw || {}) };

  if (isSupportedProductType(type)) {
    return normalizeSupportedProduct(input as RawMonetizationProductDoc & { id: string; type: MonetizationProductType });
  }

  if (type === "biome_ticket") {
    return normalizeSupportedProduct({
      ...input,
      type: "ticket",
      configuration: { kind: "ticket", ticketSubtype: "biome", biomeId: toMetadataString(input.benefits?.metadata, "biomeId") || null, eventId: null, gymMode: null, gymDurationDays: null },
    });
  }
  if (type === "gym_ticket") {
    return normalizeSupportedProduct({
      ...input,
      type: "ticket",
      configuration: {
        kind: "ticket",
        ticketSubtype: "gym",
        biomeId: null,
        eventId: null,
        gymMode: ((toMetadataString(input.benefits?.metadata, "gymTicketMode") || "permanent") as GymTicketMode),
        gymDurationDays: Math.max(1, Math.floor(toNumber(input.benefits?.metadata?.gymDurationDays, 1))),
      },
    });
  }
  if (type === "battle_castle_ticket") {
    return normalizeSupportedProduct({
      ...input,
      type: "ticket",
      configuration: { kind: "ticket", ticketSubtype: "castle", biomeId: null, eventId: null, gymMode: null, gymDurationDays: null },
    });
  }
  if (type === "exclusive_event_ticket") {
    return normalizeSupportedProduct({
      ...input,
      type: "ticket",
      configuration: { kind: "ticket", ticketSubtype: "event", biomeId: null, eventId: toMetadataString(input.benefits?.metadata, "eventId") || null, gymMode: null, gymDurationDays: null },
    });
  }
  if (type === "mystery_egg") {
    return normalizeSupportedProduct({
      ...input,
      type: "egg",
      configuration: { kind: "egg", eggType: "mysterious", pseudoLegendaryChancePercent: clamp(toNumber(input.benefits?.metadata?.pseudoLegendaryChancePercent, 5), 0, 100), pokemonType: null },
    });
  }
  if (type === "gym_type_egg") {
    return normalizeSupportedProduct({
      ...input,
      type: "egg",
      configuration: { kind: "egg", eggType: "type", pseudoLegendaryChancePercent: 0, pokemonType: toMetadataString(input.benefits?.metadata, "gymType") || null },
    });
  }
  if (type === "gym_main_team_slot") {
    return normalizeSupportedProduct({
      ...input,
      type: "slot",
      configuration: { kind: "slot", slotScope: "gym", slotsAdded: Math.max(1, Math.floor(toNumber(input.benefits?.gymDefenseSlotsAdded ?? input.benefits?.gymMainTeamSlots, 1))) },
    });
  }

  const legacyType = (type || "gym_police_npc") as LegacyMonetizationProductType;
  return {
    id,
    code: String(input.code || id).trim().toLowerCase(),
    type: legacyType,
    name: String(input.name || id),
    description: String(input.description || "Produto legado"),
    imageUrl: String(input.imageUrl || ""),
    durationDays: input.durationDays ?? null,
    price: Math.max(0, toNumber(input.price, 0)),
    currency: "BRL",
    status: input.status === "inactive" ? "inactive" : "active",
    storeVisible: input.storeVisible !== false,
    benefits: input.benefits || {},
    paymentProvider: input.paymentProvider ?? null,
    paymentProductId: input.paymentProductId ?? null,
    grantType: "entitlement",
    sortOrder: Math.max(1, Math.floor(toNumber(input.sortOrder, 1))),
    configuration: { kind: "legacy", legacyType },
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function validateMonetizationProduct(product: SupportedMonetizationProductDoc) {
  const normalized = syncProductDerivedFields(product);
  const errors: string[] = [];
  if (!String(normalized.name || "").trim()) errors.push("Nome do produto e obrigatorio.");
  if (!String(normalized.description || "").trim()) errors.push("Descricao do produto e obrigatoria.");
  if (!String(normalized.code || "").trim()) errors.push("SKU/codigo interno e obrigatorio.");
  if (normalized.price < 0) errors.push("Preco nao pode ser negativo.");
  if (normalized.sortOrder < 1) errors.push("Ordem de exibicao deve ser maior que zero.");
  if (normalized.configuration.kind === "incubator" && normalized.configuration.hatchDays <= 0) {
    errors.push("Dias da incubadora devem ser maiores que zero.");
  }
  if (normalized.configuration.kind === "ticket") {
    if (normalized.configuration.ticketSubtype === "biome" && !normalized.configuration.biomeId) {
      errors.push("Selecione o bioma liberado pelo ticket.");
    }
    if (normalized.configuration.ticketSubtype === "event" && !normalized.configuration.eventId) {
      errors.push("Selecione o evento vinculado ao ticket.");
    }
    if (normalized.configuration.ticketSubtype === "gym" && normalized.configuration.gymMode === "temporary" && !normalized.configuration.gymDurationDays) {
      errors.push("Informe a quantidade de dias do ticket GYM temporario.");
    }
  }
  if (normalized.configuration.kind === "egg") {
    if (normalized.configuration.eggType === "type" && !normalized.configuration.pokemonType) {
      errors.push("Selecione o tipo do Egg.");
    }
  }
  if (normalized.configuration.kind === "trainer_license") {
    if (normalized.configuration.biomeAccessIds.length === 0) {
      errors.push("Selecione ao menos um bioma liberado pela licenca.");
    }
  }
  return errors;
}

export function describeProductConfiguration(product: MonetizationProductDoc) {
  if (product.configuration.kind === "slot") {
    return `Adiciona ${product.configuration.slotsAdded} slot(s) do GYM.`;
  }
  if (product.configuration.kind === "expansion") {
    return `Adiciona +${product.configuration.storageSlotsAdded} espacos na BOX.`;
  }
  if (product.configuration.kind === "incubator") {
    return `Incubadora com chocagem em ${product.configuration.hatchDays} dia(s).`;
  }
  if (product.configuration.kind === "ticket") {
    if (product.configuration.ticketSubtype === "gym") {
      return product.configuration.gymMode === "temporary"
        ? `Ticket GYM temporario de ${product.configuration.gymDurationDays || 1} dia(s).`
        : "Ticket GYM permanente.";
    }
    if (product.configuration.ticketSubtype === "biome") {
      return `Ticket de bioma para ${product.configuration.biomeId || "bioma nao definido"}.`;
    }
    if (product.configuration.ticketSubtype === "event") {
      return `Ticket de evento para ${product.configuration.eventId || "evento nao definido"}.`;
    }
    return "Permite participar do Castelo de Batalha.";
  }
  if (product.configuration.kind === "egg") {
    return product.configuration.eggType === "type"
      ? `Egg de tipo ${product.configuration.pokemonType || "nao definido"}.`
      : `Egg misterioso com ${product.configuration.pseudoLegendaryChancePercent}% de pseudo-lendario.`;
  }
  if (product.configuration.kind === "iv_reset") {
    return "Item para resetar IV de Pokemon.";
  }
  if (product.configuration.kind === "trainer_license") {
    return `Licenca de ${product.configuration.durationDays} dia(s) com ${product.configuration.xpBonusPercent}% EXP.`;
  }
  return `Produto legado (${product.configuration.legacyType}).`;
}

export const DEFAULT_VIP_PLANS: VipPlanDoc[] = [
  normalizeVipPlan(
    {
      id: "vip-basic",
      code: "vip-basic",
      name: "VIP Basic",
      description: "Plano de entrada com bonus leves e limites expandidos.",
      price: 6,
      currency: "BRL",
      durationDays: 30,
      status: "active",
      benefits: {
        maxCharacters: 3,
        maxCapturedPokemon: 50,
        maxStorageItems: 50,
        xpBonusPercent: 10,
        moneyBonusPercent: 10,
        weeklyIncubators: 1,
      },
      includedItems: [],
      sortOrder: 1,
    },
    "vip-basic"
  ),
  normalizeVipPlan(
    {
      id: "vip-plus",
      code: "vip-plus",
      name: "VIP Plus",
      description: "Plano premium com bonus maiores e pacote configuravel de itens.",
      price: 15,
      currency: "BRL",
      durationDays: 30,
      status: "active",
      benefits: {
        maxCharacters: 3,
        maxCapturedPokemon: 50,
        maxStorageItems: 50,
        xpBonusPercent: 12,
        moneyBonusPercent: 12,
        weeklyIncubators: 1,
      },
      includedItems: [],
      sortOrder: 2,
    },
    "vip-plus"
  ),
];

export const DEFAULT_MONETIZATION_PRODUCTS: MonetizationProductDoc[] = [
  syncProductDerivedFields({
    ...createProductDraft("slot", 1),
    id: "gym-slot",
    code: "gym-slot",
    name: "Slot de GYM",
    description: "Adiciona +1 slot ao time principal do GYM ate o limite de 6.",
    price: 12,
    status: "inactive",
  }),
  syncProductDerivedFields({
    ...createProductDraft("expansion", 2),
    id: "box-expansion",
    code: "box-expansion",
    name: "Expansao",
    description: "Adiciona +10 espacos na BOX do jogador.",
    price: 10,
    status: "inactive",
  }),
  syncProductDerivedFields({
    ...createProductDraft("incubator", 3),
    id: "custom-incubator",
    code: "custom-incubator",
    name: "Incubadora",
    description: "Incubadora monetizada com distancia configuravel.",
    price: 8,
    status: "inactive",
  }),
  syncProductDerivedFields({
    ...createProductDraft("ticket", 4),
    id: "biome-ticket",
    code: "biome-ticket",
    name: "Ticket de Bioma",
    description: "Libera acesso a um bioma especifico.",
    price: 9,
    status: "inactive",
    configuration: { kind: "ticket", ticketSubtype: "biome", biomeId: null, eventId: null, gymMode: null, gymDurationDays: null },
  }),
  syncProductDerivedFields({
    ...createProductDraft("ticket", 5),
    id: "gym-ticket",
    code: "gym-ticket",
    name: "Ticket de GYM",
    description: "Ticket consumido para criar ou renovar um GYM.",
    price: 20,
    status: "inactive",
    configuration: { kind: "ticket", ticketSubtype: "gym", biomeId: null, eventId: null, gymMode: "permanent", gymDurationDays: null },
  }),
  syncProductDerivedFields({
    ...createProductDraft("egg", 6),
    id: "mystery-egg",
    code: "mystery-egg",
    name: "Egg Misterioso",
    description: "Gera um Baby Form aleatorio com chance de pseudo-lendario.",
    price: 11,
    status: "inactive",
  }),
  syncProductDerivedFields({
    ...createProductDraft("iv_reset", 7),
    id: "iv-reset",
    code: "iv-reset",
    name: "IV Reset",
    description: "Item preparado para reset de IV de Pokemon.",
    price: 9,
    status: "inactive",
  }),
  syncProductDerivedFields({
    ...createProductDraft("trainer_license", 8),
    id: "trainer-license",
    code: "trainer-license",
    name: "Licenca de Treinador",
    description: "Licenca temporaria com bonus e acesso a biomas exclusivos.",
    price: 15,
    status: "inactive",
  }),
];

export const MONETIZATION_PRODUCT_SEED_IDS = [
  "expansion-pack",
  "weekly-incubator",
  "biome-ticket",
  "mystery-egg",
  "iv-reset",
  "trainer-license",
  "battle-castle-ticket",
  "gym-ticket",
  "gym-police-npc",
  "gym-extra-npc",
  "gym-extra-badges",
  "gym-type-egg",
  "gym-storage-upgrade",
  "gym-main-team-slot",
  "exclusive-event-ticket",
  "gym-slot",
  "box-expansion",
  "custom-incubator",
] as const;
