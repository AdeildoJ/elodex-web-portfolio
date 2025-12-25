"use client";

import { useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";

type Props = {
  value: string;
  onChange: (url: string) => void;
  storagePathHint: string;
};

export default function NpcUploader({ value, onChange, storagePathHint }: Props) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File) {
    try {
      setErr(null);
      setUploading(true);

      const safeName = file.name.replace(/\s+/g, "_");
      const path = `${storagePathHint}/${Date.now()}_${safeName}`;

      const r = ref(storage, path);
      await uploadBytes(r, file);

      const url = await getDownloadURL(r);
      onChange(url);
    } catch (e: any) {
      setErr(e?.message || "Falha no upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <input
        type="file"
        accept="image/*"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
        className="block w-full text-xs text-slate-200"
      />

      {uploading && (
        <div className="mt-2 text-[11px] text-slate-300">Enviando imagem...</div>
      )}

      {err && (
        <div className="mt-2 text-[11px] text-red-200">{err}</div>
      )}

      <div className="mt-2">
        <div className="text-[11px] text-slate-400">URL:</div>
        <div className="text-[11px] text-slate-200 break-all">
          {value || "—"}
        </div>

        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt="NPC"
            className="mt-2 w-full max-h-40 object-cover rounded-md border border-slate-800"
          />
        ) : null}
      </div>
    </div>
  );
}
