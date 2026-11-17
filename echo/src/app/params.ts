/** A number from the address bar, kept inside `min..max`; anything that is not a number gives `fallback`. */
export const numberParam = (params: URLSearchParams, name: string, fallback: number, min: number, max: number): number => {
  const raw = params.get(name);
  const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
