/** A `.riv` the user dropped in. */
export type RivFile = {
  name: string;
  buffer: ArrayBuffer;
  size: number;
};

/** A `.glb` held in memory, ready to feed an unembedded asset. */
export type GlbFile = {
  name: string;
  bytes: Uint8Array;
  size: number;
};

export type DroppedFiles = {
  riv: RivFile | null;
  glb: GlbFile | null;
};

export type FileKind = "riv" | "glb" | "unknown";

export function classify(name: string): FileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".riv")) return "riv";
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "glb";
  return "unknown";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Reads whatever was dropped and sorts it into a .riv and/or a .glb.
 * Anything else is reported back so the UI can say why it was ignored.
 */
export async function readDropped(
  fileList: FileList | File[],
): Promise<{ riv: RivFile | null; glb: GlbFile | null; rejected: string[] }> {
  const files = Array.from(fileList);
  let riv: RivFile | null = null;
  let glb: GlbFile | null = null;
  const rejected: string[] = [];

  for (const file of files) {
    const kind = classify(file.name);
    if (kind === "riv") {
      const buffer = await file.arrayBuffer();
      riv = { name: file.name, buffer, size: buffer.byteLength };
    } else if (kind === "glb") {
      const buffer = await file.arrayBuffer();
      glb = { name: file.name, bytes: new Uint8Array(buffer), size: buffer.byteLength };
    } else {
      rejected.push(file.name);
    }
  }

  return { riv, glb, rejected };
}

/**
 * Sanity-check a .glb header so a mis-drop is caught here rather than surfacing
 * as a confusing parse failure inside the Luau loader.
 * Magic is 'glTF' little-endian.
 */
export function looksLikeGlb(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
  return view.getUint32(0, true) === 0x46546c67;
}

/** `.riv` files start with the ASCII tag "RIVE". */
export function looksLikeRiv(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const b = new Uint8Array(buffer, 0, 4);
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x56 && b[3] === 0x45;
}
