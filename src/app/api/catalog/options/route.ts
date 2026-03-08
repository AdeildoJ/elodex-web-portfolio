import { NextResponse } from "next/server";

import movesData from "@/data/moves.json";
import pokemonSpeciesData from "@/data/pokemon/pokemonSpecies.json";

type SpeciesRow = {
  id?: number | string;
  name?: string;
};

type MoveRow = {
  name?: string;
};

export async function GET() {
  const speciesRoot = pokemonSpeciesData as Record<string, SpeciesRow>;
  const moveRoot = movesData as Record<string, MoveRow>;

  const species = Object.values(speciesRoot)
    .map((row) => {
      const id = Number(row.id || 0);
      const name = String(row.name || "").trim();
      if (!id || !name) return null;
      return { id, label: `#${id} ${name}` };
    })
    .filter((row): row is { id: number; label: string } => Boolean(row))
    .sort((a, b) => a.id - b.id);

  const moves = Object.entries(moveRoot)
    .map(([id, row]) => ({
      id,
      label: String(row.name || id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return NextResponse.json({ species, moves });
}
