/** Small id helper that works in both service worker and page contexts. */
export function uid(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}
