export function formatPower(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function formatSignedPower(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${formatPower(n)}`;
}

export function formatPct(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function utcDateLabel(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).replace('T00:00:00Z', '');
  return d.toISOString().slice(0, 10);
}
