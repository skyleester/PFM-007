export function withUserIds(params: Record<string, string | number | boolean | undefined>, userIds: number[] | undefined) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  const base = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  const parts: string[] = [];
  const baseStr = base.toString();
  if (baseStr) parts.push(baseStr);
  if (userIds && userIds.length > 0) {
    for (const id of userIds) parts.push(`user_id=${encodeURIComponent(String(id))}`);
  }
  return parts.join("&");
}
