export function serializeField(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  return String(v);
}

export function buildChangeMap(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): Record<string, [string | null, string | null]> {
  const out: Record<string, [string | null, string | null]> = {};
  for (const k of keys) {
    const sb = serializeField(before[k]);
    const sa = serializeField(after[k]);
    if (sb !== sa) {
      out[k] = [sb, sa];
    }
  }
  return out;
}