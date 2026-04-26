"use client";

import "@xyflow/react/dist/style.css";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react";
import { collection, deleteField, doc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  defaultRouteId,
  deleteBiomeRoute,
  listBiomeRoutes,
  saveBiomeRoute,
  type BiomeRouteRecord,
} from "@/lib/biomeRoutes";
import BiomeRouteModal from "@/components/biomas/BiomeRouteModal";

/** Nova chave para ignorar URLs antigas inválidas (ex.: caminho em `out/`). */
const LS_MAP_BG = "elodex-admin-biome-map-bg-v2";

/**
 * Mapa mundi: coloque a PNG em `admin/public/assets/mapa-mundi.png` e rode o dev server.
 * A pasta `out/` é só export estático; não serve arquivos em `next dev`.
 */
const DEFAULT_WORLD_MAP_BG = "/assets/mapa-mundi.png";

/** Corrige nomes errados (ex.: espaços / sem hífens) para o ficheiro real em `public/assets`. */
function canonicalMundiMapPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) return trimmed;
  const t = trimmed.replace(/\\/g, "/");
  const lower = t.toLowerCase();
  const compact = lower.replace(/\s+/g, "");
  if (
    lower.includes("biome world map mundi") ||
    lower.includes("mapa-mundi.png") ||
    lower.includes("/assets/mapa-mundi.png") ||
    compact === "/images/biomeworldmapmundi.png" ||
    compact.endsWith("biomeworldmapmundi.png") ||
    compact.endsWith("/assets/mapa-mundi.png")
  ) {
    return DEFAULT_WORLD_MAP_BG;
  }
  /* Caminhos Windows / pasta `out/` / export do ChatGPT → asset em `public/assets`. */
  if (
    lower.includes("/out/biomas/") ||
    lower.includes("\\out\\biomas\\") ||
    /chatgpt.*\.png/i.test(lower) ||
    lower.includes("22_05_09.png")
  ) {
    return DEFAULT_WORLD_MAP_BG;
  }
  return trimmed;
}

/** Garante que caminhos relativos com espaços ou caracteres especiais pedem o ficheiro certo ao servidor. */
function toResolvableImgSrc(url: string): string {
  const t = url.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t) || t.startsWith("data:")) return t;
  const path = t.startsWith("/") ? t : `/${t}`;
  const parts = path.split("/").map((seg) => {
    if (seg === "") return "";
    try {
      return encodeURIComponent(decodeURIComponent(seg));
    } catch {
      return encodeURIComponent(seg);
    }
  });
  return parts.join("/");
}

export type BiomeMapEditorProps = {
  /** Abre o cadastro do bioma (modal na página pai). */
  onEditBiome?: (biomeId: string) => void;
  /** Incrementar no pai após salvar bioma para recarregar dados do mapa. */
  refreshToken?: number;
};

export type BiomeMapRow = {
  id: string;
  name: string;
  imageUrl: string;
  order: number;
  mapPosition: { x: number; y: number } | null;
  isPlacedOnMap: boolean;
};

type BiomeNodeData = {
  biomeId: string;
  label: string;
  order: number;
  imageUrl: string;
  statusLabel: string;
  onEditBiome?: (biomeId: string) => void;
  onRemoveFromMap?: (biomeId: string) => void;
  onCreateRouteFrom?: (biomeId: string) => void;
};

function findRouteForPair(routes: BiomeRouteRecord[], source: string, target: string): BiomeRouteRecord | null {
  const s = source.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  for (const r of routes) {
    if (r.fromBiomeId === s && r.toBiomeId === t) return r;
    if (r.bidirectional && r.fromBiomeId === t && r.toBiomeId === s) return r;
  }
  return null;
}

const BiomeFlowNode = memo(function BiomeFlowNode({ data }: NodeProps<Node<BiomeNodeData>>) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className="group relative">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !-translate-y-1 !border-white/70 !bg-cyan-300 !opacity-0 !shadow-[0_0_10px_rgba(34,211,238,0.8)] transition-opacity group-hover:!opacity-100"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPopoverOpen((v) => !v);
        }}
        className="nodrag nopan flex flex-col items-center text-center"
      >
        <span className="relative block">
          <span className="block h-6 w-6 rounded-full border-2 border-white bg-gradient-to-br from-cyan-400 to-violet-500 shadow-[0_0_18px_rgba(34,211,238,0.55)]" />
          <span className="absolute left-1/2 top-[19px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/80" />
        </span>
        <span className="mt-2 max-w-[92px] truncate text-[11px] font-bold leading-none text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.95)]">
          {data.label}
        </span>
      </button>

      <div className="pointer-events-none absolute left-1/2 bottom-[calc(100%+18px)] z-40 hidden w-56 -translate-x-1/2 rounded-2xl border border-slate-600/60 bg-slate-950/96 p-3 text-left shadow-[0_18px_40px_rgba(0,0,0,0.45)] group-hover:block">
        {data.imageUrl ? (
          <img src={data.imageUrl} alt={data.label} className="mb-2 h-24 w-full rounded-xl object-cover" />
        ) : (
          <div className="mb-2 h-24 w-full rounded-xl bg-slate-800" />
        )}
        <div className="text-sm font-semibold text-white">{data.label}</div>
        <div className="mt-1 text-[11px] text-slate-400">Ordem {String(data.order).padStart(3, "0")}</div>
        <div className="text-[11px] text-cyan-200">{data.statusLabel}</div>
      </div>

      {popoverOpen ? (
        <div className="absolute left-1/2 top-[calc(100%+14px)] z-50 w-60 -translate-x-1/2 rounded-2xl border border-slate-600/70 bg-slate-950/98 p-3 shadow-[0_22px_46px_rgba(0,0,0,0.55)]">
          {data.imageUrl ? (
            <img src={data.imageUrl} alt={data.label} className="mb-2 h-24 w-full rounded-xl object-cover" />
          ) : (
            <div className="mb-2 h-24 w-full rounded-xl bg-slate-800" />
          )}
          <div className="text-sm font-semibold text-white">{data.label}</div>
          <div className="mt-1 text-[11px] text-slate-400">Ordem {String(data.order).padStart(3, "0")}</div>
          <div className="mb-3 text-[11px] text-cyan-200">{data.statusLabel}</div>
          <div className="flex flex-col gap-2">
            {data.onEditBiome ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onEditBiome?.(data.biomeId);
                  setPopoverOpen(false);
                }}
                className="nodrag nopan rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"
              >
                Editar bioma
              </button>
            ) : null}
            {data.onCreateRouteFrom ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onCreateRouteFrom?.(data.biomeId);
                  setPopoverOpen(false);
                }}
                className="nodrag nopan rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/20"
              >
                Criar rota a partir daqui
              </button>
            ) : null}
            {data.onRemoveFromMap ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onRemoveFromMap?.(data.biomeId);
                  setPopoverOpen(false);
                }}
                className="nodrag nopan rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
              >
                Remover do mapa
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !translate-y-1 !border-white/70 !bg-violet-300 !opacity-0 !shadow-[0_0_10px_rgba(167,139,250,0.8)] transition-opacity group-hover:!opacity-100"
      />
    </div>
  );
});

const nodeTypes: NodeTypes = {
  biome: BiomeFlowNode,
};

const MAP_WIDTH = 1536;
const MAP_HEIGHT = 1024;
const WORLD_PADDING = 160;
const FALLBACK_WORLD_SIZE = { width: MAP_WIDTH, height: MAP_HEIGHT };

function MundiMapPlane({ imageUrl, width, height }: { imageUrl: string; width: number; height: number }) {
  const transform = useStore((s) => s.transform);
  const src = useMemo(() => toResolvableImgSrc(canonicalMundiMapPath(imageUrl)), [imageUrl]);
  if (!src) return null;
  const [x, y, zoom] = transform;
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        style={{
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          transformOrigin: "top left",
          width,
          height,
          position: "absolute",
          left: 0,
          top: 0,
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none block select-none"
          style={{
            width,
            height,
            maxWidth: "none",
            opacity: 0.5,
            filter: "saturate(0.94) contrast(0.92) brightness(0.9)",
          }}
        />
      </div>
    </div>
  );
}

function biomeRowsToNodes(rows: BiomeMapRow[]): Node<BiomeNodeData>[] {
  const out: Node<BiomeNodeData>[] = [];
  for (const b of rows) {
    if (!b.mapPosition || !b.isPlacedOnMap) continue;
    out.push({
      id: b.id,
      type: "biome",
      position: { x: b.mapPosition.x, y: b.mapPosition.y },
      data: {
        biomeId: b.id,
        label: b.name,
        order: b.order,
        imageUrl: b.imageUrl,
        statusLabel: "No mapa",
      },
    });
  }
  return out;
}

/**
 * Ao recarregar após salvar rota (etc.), o Firestore pode ainda não ter `mapPosition` dos biomas que você
 * só arrastou na tela. Mescla posições/dados locais do React Flow com o que veio do servidor.
 */
function mergeBiomeNodesFromServerAndLocal(rows: BiomeMapRow[], prev: Node<BiomeNodeData>[]): Node<BiomeNodeData>[] {
  const fromServer = biomeRowsToNodes(rows);
  const serverIds = new Set(fromServer.map((n) => n.id));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const out = [...fromServer];
  for (const p of prev) {
    if (serverIds.has(p.id)) continue;
    const row = rowById.get(p.id);
    if (!row) continue;
    out.push({
      ...p,
      type: "biome",
      data: {
        biomeId: row.id,
        label: row.name,
        order: row.order,
        imageUrl: row.imageUrl,
        statusLabel: "No mapa",
      },
    });
  }
  return out;
}

function routesToEdges(routes: BiomeRouteRecord[], playerView: boolean): Edge[] {
  return routes.map((r) => ({
    id: r.id,
    source: r.fromBiomeId,
    target: r.toBiomeId,
    label: `${r.kmCost} km${r.bidirectional ? " ↔" : ""}`,
    animated: r.status === "active",
    deletable: !playerView,
    style: r.status === "inactive" ? { stroke: "#64748b", opacity: 0.6 } : undefined,
  }));
}

async function fetchBiomeMapRows(): Promise<BiomeMapRow[]> {
  const snap = await getDocs(collection(db, "biomes"));
  const rows: BiomeMapRow[] = [];
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const id = String(data.id || d.id || "")
      .trim()
      .toLowerCase();
    if (!id) return;
    const mp = data.mapPosition;
    let mapPosition: { x: number; y: number } | null = null;
    if (mp && typeof mp === "object") {
      const o = mp as Record<string, unknown>;
      const x = Number(o.x);
      const y = Number(o.y);
      if (Number.isFinite(x) && Number.isFinite(y)) mapPosition = { x, y };
    }
    rows.push({
      id,
      name: String(data.name || id),
      imageUrl: String(data.imageUrl || ""),
      order: Math.max(0, Math.trunc(Number(data.order ?? 0))),
      mapPosition,
      isPlacedOnMap: data.isPlacedOnMap === true || Boolean(mapPosition),
    });
  });
  rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
  return rows;
}

async function persistBiomePositions(nodes: Node<BiomeNodeData>[]) {
  let batch = writeBatch(db);
  let n = 0;
  for (const node of nodes) {
    const id = node.id.trim().toLowerCase();
    if (!id) continue;
    batch.set(
      doc(db, "biomes", id),
      {
        mapPosition: { x: node.position.x, y: node.position.y },
        isPlacedOnMap: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    n += 1;
    if (n >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

async function removeBiomeFromMapPosition(biomeId: string) {
  const id = biomeId.trim().toLowerCase();
  if (!id) return;
  await writeBatch(db)
    .set(
      doc(db, "biomes", id),
      {
        mapPosition: deleteField(),
        isPlacedOnMap: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
    .commit();
}

function BiomeMapEditorInner({ onEditBiome, refreshToken = 0 }: BiomeMapEditorProps) {
  const { screenToFlowPosition, setViewport } = useReactFlow();

  const [mapBgUrl, setMapBgUrl] = useState(DEFAULT_WORLD_MAP_BG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Aviso quando só a coleção biomeRoutes falhar (regras não publicadas, etc.). */
  const [routesPermissionHint, setRoutesPermissionHint] = useState<string | null>(null);
  const [biomes, setBiomes] = useState<BiomeMapRow[]>([]);
  const [routes, setRoutes] = useState<BiomeRouteRecord[]>([]);
  const [playerView, setPlayerView] = useState(false);
  const [savingMap, setSavingMap] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BiomeNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [routeModalInitial, setRouteModalInitial] = useState<BiomeRouteRecord | null>(null);
  const [routeConnectFrom, setRouteConnectFrom] = useState("");
  const [routeConnectTo, setRouteConnectTo] = useState("");
  const [worldSize, setWorldSize] = useState(FALLBACK_WORLD_SIZE);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fitKeyRef = useRef("");

  const biomesById = useMemo(() => new Map(biomes.map((b) => [b.id, b])), [biomes]);

  const handleCreateRouteFromBiome = useCallback((biomeId: string) => {
    setRouteModalInitial(null);
    setRouteConnectFrom(biomeId);
    setRouteConnectTo("");
    setRouteModalOpen(true);
  }, []);

  const handleRemoveBiomeFromMap = useCallback(
    async (biomeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== biomeId));
      setBiomes((rows) =>
        rows.map((row) => (row.id === biomeId ? { ...row, isPlacedOnMap: false, mapPosition: null } : row))
      );
      try {
        await removeBiomeFromMapPosition(biomeId);
      } catch (err) {
        console.error(err);
        setError("Falha ao remover bioma do mapa.");
      }
    },
    [setNodes]
  );

  const enrichNodes = useCallback(
    (list: Node<BiomeNodeData>[]) =>
      list.map((node) => ({
        ...node,
        data: {
          ...node.data,
          statusLabel: "No mapa",
          onEditBiome,
          onRemoveFromMap: handleRemoveBiomeFromMap,
          onCreateRouteFrom: handleCreateRouteFromBiome,
        },
      })),
    [handleCreateRouteFromBiome, handleRemoveBiomeFromMap, onEditBiome]
  );

  const worldBounds = useMemo(
    () => ({
      x: 0,
      y: 0,
      width: worldSize.width,
      height: worldSize.height,
    }),
    [worldSize]
  );

  const translateExtent = useMemo(
    () =>
      [
        [-WORLD_PADDING, -WORLD_PADDING],
        [worldSize.width + WORLD_PADDING, worldSize.height + WORLD_PADDING],
      ] as [[number, number], [number, number]],
    [worldSize]
  );

  const initialZoom = useMemo(() => {
    if (viewportSize.width <= 0 || worldSize.width <= 0) return 1;
    return Math.max(0.12, viewportSize.width / worldSize.width);
  }, [viewportSize.width, worldSize.width]);
  const maxZoom = useMemo(() => Math.max(2.5, initialZoom * 2.5), [initialZoom]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRoutesPermissionHint(null);
    try {
      const bRows = await fetchBiomeMapRows();
      let rRows: BiomeRouteRecord[] = [];
      try {
        rRows = await listBiomeRoutes(db);
      } catch (routeErr: unknown) {
        console.error("[BiomeMapEditor] biomeRoutes", routeErr);
        const code =
          routeErr && typeof routeErr === "object" && "code" in routeErr
            ? String((routeErr as { code?: string }).code)
            : "";
        if (code === "permission-denied") {
          setRoutesPermissionHint(
            "Sem permissão para ler a coleção biomeRoutes. Publique as regras do Firestore a partir da pasta admin: " +
              "firebase deploy --only firestore:rules (o arquivo admin/firestore.rules precisa conter match /biomeRoutes/{id})."
          );
        } else {
          setRoutesPermissionHint("Não foi possível carregar as rotas. Verifique o console para detalhes.");
        }
      }
      setBiomes(bRows);
      setRoutes(rRows);
      setNodes((prev) => enrichNodes(mergeBiomeNodesFromServerAndLocal(bRows, prev as Node<BiomeNodeData>[])));
      setEdges(routesToEdges(rRows, playerView));
    } catch (e) {
      console.error(e);
      setError("Não foi possível carregar os biomas.");
    } finally {
      setLoading(false);
    }
  }, [enrichNodes, playerView, setEdges, setNodes]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_MAP_BG);
      if (v === null) {
        setMapBgUrl(DEFAULT_WORLD_MAP_BG);
        return;
      }
      if (v === "") {
        setMapBgUrl("");
        return;
      }
      const canon = canonicalMundiMapPath(v);
      if (canon !== v) {
        try {
          localStorage.setItem(LS_MAP_BG, canon);
        } catch {
          /* ignore */
        }
      }
      setMapBgUrl(canon);
    } catch {
      setMapBgUrl(DEFAULT_WORLD_MAP_BG);
    }
  }, []);

  function persistMapBg(url: string) {
    const t = url.trim();
    const canon = t === "" ? "" : canonicalMundiMapPath(url);
    setMapBgUrl(canon);
    try {
      if (!canon) {
        localStorage.setItem(LS_MAP_BG, "");
        return;
      }
      localStorage.setItem(LS_MAP_BG, canon);
    } catch {
      /* ignore */
    }
  }

  function restoreBundledWorldMap() {
    setMapBgUrl(DEFAULT_WORLD_MAP_BG);
    try {
      localStorage.removeItem(LS_MAP_BG);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void reload();
  }, [refreshToken, reload]);

  useEffect(() => {
    fitKeyRef.current = "";
  }, [mapBgUrl]);

  useEffect(() => {
    const src = toResolvableImgSrc(mapBgUrl);
    if (!src) {
      setWorldSize(FALLBACK_WORLD_SIZE);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || FALLBACK_WORLD_SIZE.width;
      const height = img.naturalHeight || FALLBACK_WORLD_SIZE.height;
      setWorldSize({ width, height });
    };
    img.onerror = () => {
      console.warn("[BiomeMapEditor] Falha ao carregar imagem de fundo:", src);
      setWorldSize(FALLBACK_WORLD_SIZE);
    };
    img.src = src;
  }, [mapBgUrl]);

  useEffect(() => {
    if (!mapBgUrl.trim()) return;
    function fitMap(force = false) {
      const el = canvasRef.current;
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width < 32 || height < 32) return;
      setViewportSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      const key = `${mapBgUrl}|${worldSize.width}x${worldSize.height}|${width}x${height}`;
      if (!force && fitKeyRef.current === key) return;
      fitKeyRef.current = key;
      const fitWidthZoom = width / worldSize.width;
      const viewport = {
        x: 0,
        y: Math.max(0, (height - worldSize.height * fitWidthZoom) / 2),
        zoom: fitWidthZoom,
      };
      void setViewport(viewport, { duration: 0 });
    }

    fitMap(true);
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fitMap(false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [mapBgUrl, setViewport, worldBounds, worldSize]);

  useEffect(() => {
    setEdges((prev) => prev.map((e) => ({ ...e, deletable: !playerView })));
  }, [playerView, setEdges]);

  const placedIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const biomeOptions = useMemo(() => biomes.map((b) => ({ id: b.id, name: b.name })), [biomes]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (playerView) return;
      const s = c.source?.trim().toLowerCase();
      const t = c.target?.trim().toLowerCase();
      if (!s || !t || s === t) return;
      const existing = findRouteForPair(routes, s, t);
      setRouteModalInitial(existing);
      if (existing) {
        setRouteConnectFrom(existing.fromBiomeId);
        setRouteConnectTo(existing.toBiomeId);
      } else {
        setRouteConnectFrom(s);
        setRouteConnectTo(t);
      }
      setRouteModalOpen(true);
    },
    [playerView, routes]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (playerView) return;
      const r = routes.find((x) => x.id === edge.id);
      if (!r) return;
      setRouteModalInitial(r);
      setRouteConnectFrom(r.fromBiomeId);
      setRouteConnectTo(r.toBiomeId);
      setRouteModalOpen(true);
    },
    [playerView, routes]
  );

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      if (playerView) return;
      try {
        for (const e of deleted) {
          await deleteBiomeRoute(db, e.id);
        }
        await reload();
      } catch (err) {
        console.error(err);
        setError("Falha ao remover rota.");
      }
    },
    [playerView, reload]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (playerView) return;
      const biomeId = e.dataTransfer.getData("application/biome-id").trim().toLowerCase();
      if (!biomeId) return;
      const b = biomesById.get(biomeId);
      if (!b) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes((nds) => {
        const exists = nds.some((n) => n.id === biomeId);
        if (exists) {
          return nds.map((n) => (n.id === biomeId ? { ...n, position: pos } : n));
        }
        return [
          ...nds,
          {
            id: biomeId,
            type: "biome",
            position: pos,
            data: {
              biomeId,
              label: b.name,
              order: b.order,
              imageUrl: b.imageUrl,
              statusLabel: "No mapa",
              onEditBiome,
              onRemoveFromMap: handleRemoveBiomeFromMap,
              onCreateRouteFrom: handleCreateRouteFromBiome,
            },
          },
        ];
      });
    },
    [biomesById, handleCreateRouteFromBiome, handleRemoveBiomeFromMap, onEditBiome, playerView, screenToFlowPosition, setNodes]
  );

  async function handleSaveMap() {
    setSavingMap(true);
    setError(null);
    try {
      await persistBiomePositions(nodes as Node<BiomeNodeData>[]);
      await reload();
    } catch (e) {
      console.error(e);
      setError("Falha ao salvar posições do mapa.");
    } finally {
      setSavingMap(false);
    }
  }

  function handleAutoLayout() {
    const ids = nodes.map((n) => n.id);
    if (!ids.length) return;
    const cols = Math.ceil(Math.sqrt(ids.length));
    const dx = 240;
    const dy = 170;
    const posMap: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, i) => {
      posMap[id] = { x: 40 + (i % cols) * dx, y: 40 + Math.floor(i / cols) * dy };
    });
    setNodes((nds) => nds.map((n) => ({ ...n, position: posMap[n.id] ?? n.position })));
  }

  async function handleSaveRoute(rec: BiomeRouteRecord) {
    const canonical = findRouteForPair(routes, rec.fromBiomeId, rec.toBiomeId);
    const id =
      canonical?.id ??
      (rec.fromBiomeId === routeConnectFrom && rec.toBiomeId === routeConnectTo
        ? defaultRouteId(routeConnectFrom, routeConnectTo)
        : defaultRouteId(rec.fromBiomeId, rec.toBiomeId));
    await saveBiomeRoute(db, { ...rec, id });
    setRouteModalOpen(false);
    await reload();
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold tracking-tight text-white md:text-2xl">Mapa de Biomas</h1>
        <div className="flex max-w-xl flex-col gap-2 sm:max-w-none sm:items-end">
          <p className="text-[11px] leading-snug text-slate-500 sm:text-right">
            Arraste os biomas sobre o canvas e salve quando terminar. As rotas continuam sendo editadas por cima do mapa.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={savingMap || loading || playerView}
              onClick={() => void handleSaveMap()}
              className="rounded-xl border border-emerald-500/40 bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {savingMap ? "Salvando…" : "Salvar Mapa"}
            </button>
            <button
              type="button"
              disabled={loading || playerView || !nodes.length}
              onClick={handleAutoLayout}
              className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              Auto-organizar
            </button>
            <button
              type="button"
              onClick={() => setPlayerView((v) => !v)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                playerView
                  ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100"
                  : "border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700"
              }`}
            >
              Visualizar como Jogador
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}
      {routesPermissionHint && !error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {routesPermissionHint}
        </div>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Biomas cadastrados</h2>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {loading && <p className="text-sm text-slate-500">Carregando…</p>}
          {!loading &&
            biomes.map((b) => {
              const onMap = placedIds.has(b.id);
              return (
                <div
                  key={b.id}
                  draggable={!playerView}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/biome-id", b.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`flex w-36 shrink-0 flex-col gap-1 rounded-lg border p-2 ${
                    onMap ? "border-cyan-500/50 bg-cyan-950/30" : "border-slate-700 bg-slate-950/80"
                  } ${playerView ? "" : "cursor-grab active:cursor-grabbing"}`}
                >
                  {b.imageUrl ? (
                    <img src={b.imageUrl} alt="" className="h-12 w-full rounded object-cover" />
                  ) : (
                    <div className="h-12 w-full rounded bg-slate-800" />
                  )}
                  <span className="text-[10px] font-medium text-slate-400">Ordem {b.order}</span>
                  <span className="line-clamp-2 text-[11px] leading-tight text-slate-100">{b.name}</span>
                  <span className="truncate font-mono text-[9px] text-slate-500" title={b.id}>
                    {b.id}
                  </span>
                  <span className={`text-[10px] ${onMap ? "text-cyan-300" : "text-amber-200/90"}`}>
                    {onMap ? "No mapa" : "Não posicionado"}
                  </span>
                  {onEditBiome && !playerView && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditBiome(b.id);
                      }}
                      className="mt-1 rounded border border-slate-600 py-1 text-[10px] font-medium text-cyan-300 hover:bg-slate-800"
                    >
                      Editar bioma
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </section>

      <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Área do Mapa</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Zoom no scroll, arraste para mover o canvas e clique nas rotas para editar.
            </p>
          </div>
          <details className="group rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
            <summary className="cursor-pointer list-none font-medium text-slate-200">
              Configurar fundo
            </summary>
            <div className="mt-3 flex w-[min(100%,28rem)] flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-slate-500">
                  Caminho padrão: <code className="text-slate-400">public/assets/mapa-mundi.png</code>
                </span>
                <input
                  value={mapBgUrl}
                  onChange={(e) => persistMapBg(e.target.value)}
                  placeholder={DEFAULT_WORLD_MAP_BG}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={restoreBundledWorldMap}
                  className="rounded-lg border border-violet-500/50 px-2 py-1.5 text-[11px] text-violet-200 hover:bg-violet-950/50"
                >
                  Usar mapa padrão
                </button>
                <button
                  type="button"
                  onClick={() => persistMapBg("")}
                  className="rounded-lg border border-slate-600 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                >
                  Remover fundo
                </button>
              </div>
            </div>
          </details>
        </div>
        <div
          ref={canvasRef}
          className="relative isolate m-4 w-auto flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
          style={{
            minHeight: 720,
            height: "calc(100vh - 260px)",
            aspectRatio: `${worldSize.width} / ${worldSize.height}`,
          }}
        >
          {mapBgUrl.trim() ? (
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
              aria-hidden
            >
              <img
                src={toResolvableImgSrc(mapBgUrl)}
                alt=""
                draggable={false}
                className="h-full w-full select-none"
                style={{
                  objectFit: "cover",
                  opacity: 0.16,
                  filter: "blur(20px) saturate(0.9) brightness(0.65)",
                  transform: "scale(1.04)",
                }}
              />
            </div>
          ) : null}
          {mapBgUrl.trim() ? <MundiMapPlane imageUrl={mapBgUrl} width={worldSize.width} height={worldSize.height} /> : null}
          {mapBgUrl.trim() ? <div className="pointer-events-none absolute inset-0 z-[1] bg-slate-950/10" aria-hidden /> : null}
          <ReactFlow
            className="!h-full !w-full !bg-transparent"
            style={{ background: "transparent" }}
            colorMode="light"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            onEdgesDelete={onEdgesDelete}
            nodeTypes={nodeTypes}
            nodesDraggable={!playerView}
            nodesConnectable={!playerView}
            elementsSelectable={!playerView}
            onDragOver={onDragOver}
            onDrop={onDrop}
            minZoom={initialZoom}
            maxZoom={maxZoom}
            zoomOnScroll
            zoomOnPinch
            panOnScroll={false}
            panOnDrag
            fitView={false}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            translateExtent={translateExtent}
            nodeExtent={translateExtent}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={playerView ? null : "Delete"}
          >
            <Controls showZoom showFitView position="bottom-right" />
            <MiniMap
              className="!bg-slate-900"
              maskColor="rgba(15, 23, 42, 0.65)"
              nodeStrokeWidth={2}
            />
          </ReactFlow>
        </div>
      </section>

      <BiomeRouteModal
        open={routeModalOpen}
        onClose={() => setRouteModalOpen(false)}
        onSave={handleSaveRoute}
        biomes={biomeOptions}
        initial={routeModalInitial}
        connectFrom={routeConnectFrom}
        connectTo={routeConnectTo}
      />
    </div>
  );
}

export default function BiomeMapEditor(props: BiomeMapEditorProps) {
  return (
    <ReactFlowProvider>
      <BiomeMapEditorInner {...props} />
    </ReactFlowProvider>
  );
}
