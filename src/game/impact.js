// Impact model: turns logged choices into yearly figures for the reports.
// Values are null until sourced (see docs/SOURCES.md). Null values are shown as
// "figure being checked" and left out of totals, never guessed.
import factors from '../../data/impact-factors.json';

export function createActionLog() {
  const entries = [];
  return {
    record(actionId, levelId) { entries.push({ actionId, levelId, at: Date.now() }); },
    forLevel(levelId) { return entries.filter((e) => e.levelId === levelId); },
    all() { return [...entries]; },
  };
}

export function formatAmount(metric, value) {
  const m = factors.metrics[metric];
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  let text = `${rounded.toLocaleString('en-GB')} ${m.unit} ${m.noun}`;
  const eq = (factors.equivalents[metric] ?? []).find((e) => e.per_unit);
  if (eq) text += ` (about ${Math.round(value / eq.per_unit).toLocaleString('en-GB')} ${eq.label})`;
  return text;
}

// One report line per choice, projected to a year.
function describe(actionId) {
  const f = factors.actions[actionId];
  if (!f) return { actionId, label: `Unknown action "${actionId}"`, consequence: '', amounts: [], better: null, when: '', isBad: false };
  const days = factors.days_per_year[f.frequency] ?? 365;
  const amounts = Object.entries(f.per_occurrence ?? {}).map(([metric, v]) => ({ metric, value: v == null ? null : v * days }));
  const better = f.better ? factors.actions[f.better]?.label ?? null : null;
  const when = f.frequency === 'school_day' ? `every school day (${days} days a year)` : 'every day for a year';
  return { actionId, label: f.label, consequence: f.consequence, amounts, better, when, isBad: Boolean(f.better) };
}

function totals(lines) {
  const sum = {};
  for (const l of lines) for (const a of l.amounts) if (a.value != null) sum[a.metric] = (sum[a.metric] ?? 0) + a.value;
  return Object.entries(sum).filter(([, v]) => v > 0).map(([metric, value]) => ({ metric, value }));
}

export function summariseLevel(log, levelId) {
  const lines = log.forLevel(levelId).map((e) => describe(e.actionId));
  return { lines, totals: totals(lines), disclaimer: factors.disclaimer };
}

// End-of-game year view: everything combined, plus the top two things to change.
export function summariseYear(log) {
  const lines = log.all().map((e) => describe(e.actionId));
  const bad = lines.filter((l) => l.isBad);
  const uniqueBad = [...new Map(bad.map((l) => [l.actionId, l])).values()];
  // Rank by sourced impact; unsourced bad choices still appear but rank last.
  // (Different units are summed only for ranking, never shown.)
  const score = (l) => l.amounts.reduce((s, a) => s + (a.value ?? 0), 0);
  const topChanges = uniqueBad.sort((a, b) => score(b) - score(a)).slice(0, 2);
  return { totals: totals(lines), topChanges, goodCount: lines.length - bad.length, total: lines.length, disclaimer: factors.disclaimer };
}
