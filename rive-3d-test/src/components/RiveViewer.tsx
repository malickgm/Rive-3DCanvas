"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FileAsset } from "@rive-app/react-webgl2";
import { Fit, Layout, useRive } from "@rive-app/react-webgl2";
import { Controls } from "@/components/Controls";
import { DropPanel } from "@/components/DropPanel";
import { CONTROL_GROUPS } from "@/lib/logoScene";
import type { CapturedLine } from "@/lib/consoleCapture";
import {
  getLines,
  hasGpuCanvasFailure,
  hasScriptOutput,
  subscribe,
} from "@/lib/consoleCapture";
import type { GlbFile, RivFile } from "@/lib/riveFiles";
import { formatBytes } from "@/lib/riveFiles";

type LogLine = CapturedLine;

const EMPTY: CapturedLine[] = [];

/** Console lines captured at module load — see lib/consoleCapture.ts. */
function useScriptConsole(): CapturedLine[] {
  return useSyncExternalStore(subscribe, getLines, () => EMPTY);
}

export function RiveViewer({
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
  const logs = useScriptConsole();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    riv ? "loading" : "idle",
  );
  const [assetReports, setAssetReports] = useState<string[]>([]);

  /**
   * `assetLoader` is invoked synchronously while Rive parses the file, which can
   * land mid-render — calling setState directly there triggers React's
   * "Cannot update a component while rendering a different component" warning.
   * Buffer into a ref and flush on a microtask instead.
   */
  const pendingReports = useRef<string[]>([]);
  const flushScheduled = useRef(false);
  const report = useCallback((line: string) => {
    pendingReports.current.push(line);
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    queueMicrotask(() => {
      flushScheduled.current = false;
      const batch = pendingReports.current;
      pendingReports.current = [];
      if (batch.length) setAssetReports((prev) => [...prev, ...batch]);
    });
  }, []);

  /**
   * Called for every asset the file references but does not embed.
   *
   * Returning false hands the asset back to Rive (embedded bytes or its CDN).
   * We only step in for something model-shaped with no bytes — the case we
   * expect to break when a blob asset is left out of the export.
   */
  const assetLoader = useCallback(
    (asset: FileAsset, bytes: Uint8Array) => {
      const embedded = bytes.length > 0;
      report(
        `${asset.name || "(unnamed)"} · ${asset.fileExtension || "?"} · ${
          embedded ? `embedded (${formatBytes(bytes.length)})` : "NOT embedded"
        }${asset.cdnUuid ? " · CDN uuid" : ""}`,
      );

      if (embedded) return false;

      const looksLikeModel =
        /glb|gltf|blob/i.test(asset.fileExtension || "") || /glb/i.test(asset.name || "");
      if (!looksLikeModel) return false;

      if (!glb) {
        report(`↳ ${asset.name} is not embedded and no .glb was dropped — drop one to supply it`);
        return false;
      }

      asset.decode(glb.bytes);
      report(`↳ supplied ${asset.name} from dropped ${glb.name}`);
      return true;
    },
    [glb, report],
  );

  const [playing, setPlaying] = useState<string[]>([]);

  // `?autobind=0` disables autoBind so the file's own artboard→ViewModel
  // binding is used instead. Useful for isolating whether autoBind is what the
  // Luau script's context:viewModel() can or cannot see.
  const autoBind = useMemo(() => {
    if (typeof window === "undefined") return true;
    return new URLSearchParams(window.location.search).get("autobind") !== "0";
  }, []);

  const { rive, RiveComponent } = useRive(
    riv
      ? {
          buffer: riv.buffer,
          autoplay: true,
          autoBind,
          layout: new Layout({ fit: Fit.Contain }),
          assetLoader,
          // These runtime callbacks can fire synchronously while the hook runs,
          // i.e. during render. Deferring the state writes avoids React's
          // "Cannot update a component while rendering" warning.
          onLoad: () => queueMicrotask(() => setStatus("ready")),
          onLoadError: () => queueMicrotask(() => setStatus("error")),
          // Without an explicit state machine the runtime plays the artboard's
          // first linear animation instead and warns about it. The name is not
          // known until the file is parsed, so it is started here.
          onRiveReady: (instance) => {
            const machines = instance.stateMachineNames;
            if (machines.length > 0) {
              instance.play(machines[0]);
            }
            queueMicrotask(() => setPlaying(machines.slice(0, 1)));
          },
        }
      : null,
  );

  const vmi = rive?.viewModelInstance ?? null;

  const fileInfo = useMemo(() => {
    if (!rive) return null;
    let artboards: string[] = [];
    let machines: string[] = [];
    try {
      artboards = rive.contents?.artboards?.map((a) => a.name) ?? [];
      machines = rive.contents?.artboards?.[0]?.stateMachines?.map((s) => s.name) ?? [];
    } catch {
      /* contents is best-effort */
    }
    return { artboards, machines, vmName: vmi?.viewModelName ?? null };
  }, [rive, vmi]);

  const gpuCanvasFailed = hasGpuCanvasFailure(logs);
  const scriptRan = hasScriptOutput(logs) || gpuCanvasFailed;
  const otherError = logs.some((l) => l.kind === "error") && !gpuCanvasFailed;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-4">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-800 bg-[radial-gradient(circle_at_50%_35%,#1b2432,#0a0d12)]">
          {riv && <RiveComponent className="h-full w-full" />}

          {status === "idle" && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <p className="text-sm font-medium text-neutral-300">Drop a .riv to begin</p>
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-neutral-500">
                  Anywhere on the page, or use the panel on the right. Add the .glb too if it was
                  not embedded in the export.
                </p>
              </div>
            </div>
          )}

          {status === "loading" && (
            <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">
              Loading {riv?.name}…
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <p className="text-sm font-medium text-red-300">Could not load {riv?.name}</p>
                <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                  Rive rejected the file. Check it is a real .riv export and not a project archive.
                </p>
              </div>
            </div>
          )}
        </div>

        <Diagnostics
          status={status}
          riv={riv}
          scriptRan={scriptRan}
          gpuCanvasFailed={gpuCanvasFailed}
          otherError={otherError}
          fileInfo={fileInfo}
          playing={playing}
          assetReports={assetReports}
          logs={logs}
        />
      </div>

      <aside className="space-y-5 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-1">
        <DropPanel
          riv={riv}
          glb={glb}
          rejected={rejected}
          isDragging={isDragging}
          onFiles={onFiles}
          onClearRiv={onClearRiv}
          onClearGlb={onClearGlb}
        />
        {riv && <Controls groups={CONTROL_GROUPS} vmi={vmi} />}
      </aside>
    </div>
  );
}

function Verdict({ ok, label }: { ok: boolean | null; label: string }) {
  const tone = ok === null ? "text-neutral-500" : ok ? "text-emerald-400" : "text-red-400";
  const mark = ok === null ? "—" : ok ? "PASS" : "FAIL";
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-neutral-300">{label}</span>
      <span className={`font-mono text-xs font-semibold ${tone}`}>{mark}</span>
    </div>
  );
}

function Diagnostics({
  status,
  riv,
  scriptRan,
  gpuCanvasFailed,
  otherError,
  fileInfo,
  playing,
  assetReports,
  logs,
}: {
  status: "idle" | "loading" | "ready" | "error";
  riv: RivFile | null;
  scriptRan: boolean;
  gpuCanvasFailed: boolean;
  otherError: boolean;
  fileInfo: { artboards: string[]; machines: string[]; vmName: string | null } | null;
  playing: string[];
  assetReports: string[];
  logs: LogLine[];
}) {
  const settled = status === "ready";
  const pending = status === "idle" || status === "loading";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-neutral-100 uppercase">
        Runtime check
      </h2>
      <p className="mt-1 text-[11px] text-neutral-500">
        Does GPU Canvas + Luau scripting actually run in <code>@rive-app/webgl2</code>?
      </p>

      <div className="mt-3 divide-y divide-neutral-800/70">
        <Verdict ok={pending ? null : status === "ready"} label="1 · .riv file loads" />
        <Verdict ok={settled ? fileInfo?.vmName != null : null} label="2 · ViewModel binds" />
        <Verdict ok={settled ? scriptRan : null} label="3 · Luau script executes" />
        <Verdict
          ok={settled ? !gpuCanvasFailed : null}
          label="4 · GPU Canvas available"
        />
        <Verdict ok={settled ? !otherError : null} label="5 · No other runtime errors" />
      </div>

      {gpuCanvasFailed && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 p-3">
          <p className="text-xs font-semibold text-red-300">
            GPU Canvas is not compiled into this runtime
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-red-200/80">
            The script runs, but <code>context:gpuCanvas()</code> is unavailable in the published{" "}
            <code>@rive-app/webgl2</code> WASM build. Scripting ships; the GPU layer the 3D renderer
            needs does not — yet. Nothing in the file can fix this.
          </p>
        </div>
      )}

      {!riv && (
        <p className="mt-3 border-t border-neutral-800 pt-3 text-[11px] text-neutral-500">
          Waiting for a .riv file.
        </p>
      )}

      {fileInfo && (
        <dl className="mt-3 space-y-1 border-t border-neutral-800 pt-3 text-[11px] text-neutral-400">
          <Row label="Artboards" value={fileInfo.artboards.join(", ") || "—"} />
          <Row label="State machines" value={fileInfo.machines.join(", ") || "—"} />
          <Row label="Playing" value={playing.join(", ") || "none"} />
          <Row label="ViewModel" value={fileInfo.vmName || "not bound"} />
        </dl>
      )}

      {assetReports.length > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          <p className="mb-1 text-[11px] font-semibold text-neutral-300">Assets</p>
          <ul className="space-y-0.5 font-mono text-[11px] text-neutral-400">
            {assetReports.map((r, i) => (
              <li key={i} className={/NOT embedded/.test(r) ? "text-amber-400" : ""}>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 border-t border-neutral-800 pt-3">
        <p className="mb-1 text-[11px] font-semibold text-neutral-300">
          Script console <span className="font-normal text-neutral-500">({logs.length})</span>
        </p>
        <div className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {logs.length === 0 && (
            <p className="text-neutral-600">
              Nothing yet. A working script prints a{" "}
              <span className="text-neutral-400">[LogoViewport] loaded …</span> line here.
            </p>
          )}
          {logs.map((l, i) => (
            <p
              key={i}
              className={
                l.kind === "error"
                  ? "text-red-400"
                  : l.kind === "warn"
                    ? "text-amber-400"
                    : "text-neutral-400"
              }
            >
              {l.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="max-w-[65%] truncate text-right text-neutral-300" title={value}>
        {value}
      </dd>
    </div>
  );
}
