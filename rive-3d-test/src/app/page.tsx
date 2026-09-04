import { RiveViewerClient } from "@/components/RiveViewerClient";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-100">Rive 3D runtime test</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-neutral-400">
          Loads an exported <code className="text-neutral-300">.riv</code> through{" "}
          <code className="text-neutral-300">@rive-app/webgl2</code> (the Rive Renderer) and drives
          the <code className="text-neutral-300">LogoScene</code> ViewModel from React. The point is
          to find out whether GPU Canvas and Luau scripting survive export to a real runtime — the
          checks below answer that.
        </p>
      </header>
      <RiveViewerClient />
    </main>
  );
}
