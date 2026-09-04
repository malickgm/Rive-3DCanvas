"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
// Imported for its module-level side effect: it patches console BEFORE the Rive
// WASM binds its own console.error reference. Order matters — see the file.
import { clearLines } from "@/lib/consoleCapture";
import type { GlbFile, RivFile } from "@/lib/riveFiles";
import { readDropped } from "@/lib/riveFiles";

/**
 * The Rive runtime touches WebGL and the DOM at import time, so it must not be
 * server-rendered. Next 16 only allows `ssr: false` inside a Client Component,
 * hence this wrapper — which also owns the dropped-file state, so the viewer
 * below can be remounted wholesale when a new file arrives.
 */
const RiveViewer = dynamic(
  () => import("@/components/RiveViewer").then((m) => m.RiveViewer),
  {
    ssr: false,
    loading: () => (
      <div className="grid aspect-square w-full place-items-center rounded-xl border border-neutral-800 bg-neutral-900/60 text-sm text-neutral-500">
        Loading Rive runtime…
      </div>
    ),
  },
);

export function RiveViewerClient() {
  const [riv, setRiv] = useState<RivFile | null>(null);
  const [glb, setGlb] = useState<GlbFile | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Bumped on every file change so the viewer remounts and `useRive`
  // re-initialises from scratch. Swapping the buffer in place is not reliable —
  // the runtime has already built its artboard and state machine.
  const [generation, setGeneration] = useState(0);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const result = await readDropped(files);
    setRejected(result.rejected);
    if (result.riv) setRiv(result.riv);
    if (result.glb) setGlb(result.glb);
    if (result.riv || result.glb) {
      // The capture buffer lives at module scope so it survives hot reloads and
      // remounts. Without this, output from a previous file keeps showing and
      // reads as if the new one failed the same way.
      clearLines();
      setGeneration((g) => g + 1);
    }
  }, []);

  /**
   * Optional `?src=/rive/foo.riv&glb=/rive/foo.glb` for repeatable testing —
   * handy when re-checking a runtime upgrade without re-dragging every time.
   * Drag & drop remains the primary path.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get("src");
    const glbSrc = params.get("glb");
    if (!src && !glbSrc) return;

    let cancelled = false;
    void (async () => {
      try {
        if (src) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          if (cancelled) return;
          setRiv({ name: src.split("/").pop() || src, buffer, size: buffer.byteLength });
        }
        if (glbSrc) {
          const res = await fetch(glbSrc);
          if (!res.ok) throw new Error(`${glbSrc}: HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          if (cancelled) return;
          setGlb({
            name: glbSrc.split("/").pop() || glbSrc,
            bytes: new Uint8Array(buffer),
            size: buffer.byteLength,
          });
        }
        if (!cancelled) {
          clearLines();
          setGeneration((g) => g + 1);
        }
      } catch (e) {
        if (!cancelled) setRejected([(e as Error).message]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Page-wide drag & drop. Without the depth counter, dragging over a child
  // element fires dragleave on the parent and the highlight flickers.
  const dragDepth = useRef(0);
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      void handleFiles(e.dataTransfer.files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  const clearRiv = useCallback(() => {
    setRiv(null);
    setGeneration((g) => g + 1);
  }, []);

  const clearGlb = useCallback(() => {
    setGlb(null);
    setGeneration((g) => g + 1);
  }, []);

  return (
    <>
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-sky-500/10 backdrop-blur-[1px]">
          <div className="rounded-xl border-2 border-dashed border-sky-400 bg-neutral-950/80 px-8 py-6 text-center">
            <p className="text-sm font-medium text-sky-200">Drop to load</p>
            <p className="mt-1 text-[11px] text-sky-300/70">.riv and .glb accepted</p>
          </div>
        </div>
      )}

      <RiveViewer
        key={generation}
        riv={riv}
        glb={glb}
        rejected={rejected}
        isDragging={isDragging}
        onFiles={handleFiles}
        onClearRiv={clearRiv}
        onClearGlb={clearGlb}
      />
    </>
  );
}
