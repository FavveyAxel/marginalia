// Messages entre participants (dans le rendu) : enveloppe JSON + octets facultatifs. Le transport
// (electron/collab-net.cjs) les chiffre et les relaie sans les lire.
export interface Head {
  t: string;
  [k: string]: unknown;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function pack(head: Head, body?: Uint8Array | ArrayBuffer | null): Uint8Array {
  const h = enc.encode(JSON.stringify(head));
  const b = body ? (body instanceof Uint8Array ? body : new Uint8Array(body)) : new Uint8Array(0);
  const out = new Uint8Array(4 + h.length + b.length);
  new DataView(out.buffer).setUint32(0, h.length);
  out.set(h, 4);
  out.set(b, 4 + h.length);
  return out;
}

export function unpack(bytes: Uint8Array): { head: Head; body: Uint8Array } | null {
  try {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
    const n = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(0);
    if (n > u.length - 4 || n > 64 * 1024 * 1024) return null;
    const head = JSON.parse(dec.decode(u.subarray(4, 4 + n)));
    if (!head || typeof head !== 'object' || typeof head.t !== 'string') return null;
    return { head, body: u.subarray(4 + n) };
  } catch {
    return null;
  }
}

/** Plusieurs fichiers dans un seul corps : [{ name, len }] dans l'enveloppe, octets à la suite. */
export function joinFiles(files: { name: string; data: ArrayBuffer | Uint8Array }[]): { list: { name: string; len: number }[]; body: Uint8Array } {
  const list = files.map((f) => ({ name: f.name, len: f.data.byteLength }));
  const body = new Uint8Array(list.reduce((n, f) => n + f.len, 0));
  let off = 0;
  for (const f of files) {
    body.set(f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data), off);
    off += f.data.byteLength;
  }
  return { list, body };
}
export function splitFiles(list: unknown, body: Uint8Array): { name: string; data: ArrayBuffer }[] | null {
  if (!Array.isArray(list)) return null;
  const out: { name: string; data: ArrayBuffer }[] = [];
  let off = 0;
  for (const f of list) {
    if (!f || typeof f.name !== 'string' || typeof f.len !== 'number' || f.len < 0 || off + f.len > body.length) return null;
    out.push({ name: f.name, data: body.slice(off, off + f.len).buffer as ArrayBuffer });
    off += f.len;
  }
  return out;
}
