"use client";

import { useRef, useState } from "react";
import type { GlbFile, RivFile } from "@/lib/riveFiles";
import { formatBytes, looksLikeGlb, looksLikeRiv } from "@/lib/riveFiles";

export function DropPanel({
  riv,
  glb,
  rejected,
  isDragging,
  onFiles,
  onClearRiv,
  onClearGlb,
}: {
  riv: RivFile | null;
  glb: GlbFile | null;
  rejected: string[];
  isDragging: boolean;
  onFiles: (files: FileList | File[]) => void;
  onClearRiv: () => void;
  onClearGlb: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localDrag, setLocalDrag] = useState(false);
  const active = isDragging || localDrag;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-neutral-100 uppercase">Files</h2>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">
        Drop anywhere on the page, or click below. The <code>.glb</code> is only needed if it was
        not embedded in the <code>.riv</code>.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setLocalDrag(true);
        }}
        onDragLeave={() => setLocalDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setLocalDrag(false);
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
        className={`mt-3 w-full rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          active
            ? "border-sky-400 bg-sky-500/10"
            : "border-neutral-700 bg-neutral-950/40 hover:border-neutral-600"
        }`}
      >
        <p className="text-sm font-medium text-neutral-200">
          {active ? "Release to load" : "Drop .riv / .glb"}
        </p>
        <p className="mt-1 text-[11px] text-neutral-500">or click to browse</p>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".riv,.glb,.gltf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          // Allow re-selecting the same file after a re-export.
          e.target.value = "";
        }}
      />

      <div className="mt-3 space-y-2">
        <FileRow
          label=".riv"
          required
          name={riv?.name}
          size={riv?.size}
          warning={riv && !looksLikeRiv(riv.buffer) ? "Missing RIVE header — is this really a .riv?" : null}
          onClear={onClearRiv}
        />
        <FileRow
          label=".glb"
          name={glb?.name}
          size={glb?.size}
          warning={glb && !looksLikeGlb(glb.bytes) ? "Missing glTF header — is this really a .glb?" : null}
          onClear={onClearGlb}
        />
      </div>

      {rejected.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-500">
          Ignored (not .riv or .glb): {rejected.join(", ")}
        </p>
      )}

      {riv && (
        <p className="mt-3 border-t border-neutral-800 pt-2 text-[11px] text-neutral-500">
          Files live in memory only — a page reload clears them.
        </p>
      )}
    </section>
  );
}

function FileRow({
  label,
  name,
  size,
  required,
  warning,
  onClear,
}: {
  label: string;
  name?: string;
  size?: number;
  required?: boolean;
  warning?: string | null;
  onClear: () => void;
}) {
  const loaded = Boolean(name);

  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        loaded ? "border-neutral-700 bg-neutral-950/50" : "border-neutral-800/70 bg-transparent"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-neutral-500">{label}</span>
        {loaded ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-neutral-500 transition hover:text-red-400"
          >
            clear
          </button>
        ) : (
          <span className="text-[11px] text-neutral-600">
            {required ? "required" : "optional"}
          </span>
        )}
      </div>
      {loaded ? (
        <div className="mt-0.5">
          <p className="truncate text-sm text-neutral-200" title={name}>
            {name}
          </p>
          <p className="font-mono text-[11px] text-neutral-500">{formatBytes(size ?? 0)}</p>
        </div>
      ) : (
        <p className="mt-0.5 text-sm text-neutral-600">not loaded</p>
      )}
      {warning && <p className="mt-1 text-[11px] text-amber-500">{warning}</p>}
    </div>
  );
}
