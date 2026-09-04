"use client";

import type { ViewModelInstance } from "@rive-app/react-webgl2";
import {
  useViewModelInstanceBoolean,
  useViewModelInstanceNumber,
  useViewModelInstanceString,
  useViewModelInstanceTrigger,
} from "@rive-app/react-webgl2";
import type { Control, ControlGroup } from "@/lib/logoScene";

/**
 * One component per control kind, because the Rive hooks are typed per property
 * type and hooks cannot be called conditionally.
 */

function NumberControl({ control, vmi }: { control: Control; vmi: ViewModelInstance | null }) {
  const { value, setValue } = useViewModelInstanceNumber(control.path, vmi);

  // A null value means the property is missing from the ViewModel — worth
  // surfacing rather than rendering a dead slider.
  if (value === null) return <MissingRow control={control} />;

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm text-neutral-300">{control.label}</label>
        <span className="font-mono text-xs tabular-nums text-neutral-400">
          {Number(value.toFixed(3))}
        </span>
      </div>
      <input
        type="range"
        min={control.min ?? 0}
        max={control.max ?? 1}
        step={control.step ?? 0.01}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="mt-1 w-full accent-sky-400"
      />
      {control.hint && <p className="mt-0.5 text-[11px] text-neutral-500">{control.hint}</p>}
    </div>
  );
}

function BooleanControl({ control, vmi }: { control: Control; vmi: ViewModelInstance | null }) {
  const { value, setValue } = useViewModelInstanceBoolean(control.path, vmi);
  if (value === null) return <MissingRow control={control} />;

  return (
    <label className="flex cursor-pointer items-center justify-between py-2">
      <span className="text-sm text-neutral-300">{control.label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => setValue(e.target.checked)}
        className="h-4 w-4 accent-sky-400"
      />
    </label>
  );
}

function TriggerControl({ control, vmi }: { control: Control; vmi: ViewModelInstance | null }) {
  const { trigger } = useViewModelInstanceTrigger(control.path, vmi);
  return (
    <button
      type="button"
      onClick={() => trigger()}
      className="my-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition hover:border-sky-500 hover:bg-neutral-700 active:scale-[0.99]"
    >
      {control.label}
    </button>
  );
}

/** Values the Luau script writes back out — read-only here. */
function ReadonlyNumber({ control, vmi }: { control: Control; vmi: ViewModelInstance | null }) {
  const { value } = useViewModelInstanceNumber(control.path, vmi);
  return <ReadonlyRow label={control.label} value={value === null ? "—" : Number(value.toFixed(3))} />;
}

function ReadonlyString({ control, vmi }: { control: Control; vmi: ViewModelInstance | null }) {
  const { value } = useViewModelInstanceString(control.path, vmi);
  return <ReadonlyRow label={control.label} value={value || "—"} />;
}

function ReadonlyRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-neutral-400">{label}</span>
      <span className="max-w-[60%] truncate font-mono text-xs tabular-nums text-sky-300" title={String(value)}>
        {value}
      </span>
    </div>
  );
}

function MissingRow({ control }: { control: Control }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-neutral-500 line-through">{control.label}</span>
      <span className="font-mono text-[11px] text-amber-500">not in ViewModel</span>
    </div>
  );
}

function ControlRow({ control, vmi }: { control: Control; vmi: ViewModelInstance | null }) {
  switch (control.kind) {
    case "number":
      return <NumberControl control={control} vmi={vmi} />;
    case "boolean":
      return <BooleanControl control={control} vmi={vmi} />;
    case "trigger":
      return <TriggerControl control={control} vmi={vmi} />;
    case "readonly-number":
      return <ReadonlyNumber control={control} vmi={vmi} />;
    case "readonly-string":
      return <ReadonlyString control={control} vmi={vmi} />;
  }
}

export function Controls({
  groups,
  vmi,
}: {
  groups: ControlGroup[];
  vmi: ViewModelInstance | null;
}) {
  if (!vmi) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-200">
        No ViewModel instance bound. Either the file has no default instance, or
        <code className="mx-1 rounded bg-black/30 px-1">autoBind</code> did not resolve one.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.title} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-sm font-semibold tracking-wide text-neutral-100 uppercase">
            {group.title}
          </h2>
          {group.blurb && <p className="mt-1 mb-2 text-[11px] leading-snug text-neutral-500">{group.blurb}</p>}
          <div className="mt-2 divide-y divide-neutral-800/70">
            {group.controls.map((control) => (
              <ControlRow key={control.path} control={control} vmi={vmi} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
