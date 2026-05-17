const GROUP_ORDER = ['R5', 'R4', 'R3', 'R2', 'R1', 'R0'];

export function normalizePlayerKey(name = '') {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export function normalizeSnapshot(row, fallbackTimeUtc) {
  const playerName = row.player_name || row.name || row.Player || row.player || '';
  const snapshotTime = row.snapshot_time_utc || row.snapshot_time || row.date || row.snapshot_date_utc || row.snapshot_date || fallbackTimeUtc;
  const normalizedTime = toUtcIso(snapshotTime);
  const power = parsePower(row.power ?? row.Power ?? row.power_m ?? row['Power M']);
  const furnaceRaw = row.furnace_level ?? row.furnace ?? row.level ?? row.Level;
  return {
    ...row,
    player_name: playerName,
    player_key: row.player_key || normalizePlayerKey(playerName),
    snapshot_time_utc: normalizedTime,
    snapshot_date_utc: normalizedTime.slice(0, 10),
    rank_group: row.rank_group || row.member_group || row.group || row.Group || null,
    rank_group_name: row.rank_group_name || row.group_name || '',
    power,
    power_m: power ? Number((power / 1_000_000).toFixed(3)) : null,
    furnace_level: furnaceRaw === '' || furnaceRaw == null ? null : Number(furnaceRaw),
  };
}

export function toUtcIso(value) {
  if (!value) return new Date().toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00Z`;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function parsePower(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 0 && value < 1000) return Math.round(value * 1_000_000);
    return Math.round(value);
  }
  const text = String(value).trim().replace(/,/g, '');
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!match) return Number(text) || null;
  const n = Number(match[1]);
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'b') return Math.round(n * 1_000_000_000);
  if (suffix === 'm') return Math.round(n * 1_000_000);
  if (suffix === 'k') return Math.round(n * 1_000);
  return Math.round(n);
}

export function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return headers.reduce((acc, h, i) => {
      acc[h] = cells[i] ?? '';
      return acc;
    }, {});
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') {
      cur += '"';
      i += 1;
    } else if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function buildStats(data) {
  const snapshots = (data?.snapshots || []).map((s) => normalizeSnapshot(s));
  const byPlayer = new Map();
  for (const snap of snapshots) {
    if (!snap.player_key) continue;
    const list = byPlayer.get(snap.player_key) || [];
    list.push(snap);
    byPlayer.set(snap.player_key, list);
  }

  const players = Array.from(byPlayer.entries()).map(([key, list]) => {
    list.sort((a, b) => new Date(a.snapshot_time_utc) - new Date(b.snapshot_time_utc));
    const first = list[0];
    const latest = list[list.length - 1];
    const gain = Number(latest.power || 0) - Number(first.power || 0);
    const pctGain = first.power ? (gain / first.power) * 100 : 0;
    return {
      key,
      name: latest.player_name || first.player_name || key,
      first,
      latest,
      snapshots: list,
      gain,
      pctGain,
      currentPower: Number(latest.power || 0),
      startingPower: Number(first.power || 0),
      furnaceLevel: latest.furnace_level ?? null,
      rankGroup: latest.rank_group || latest.member_group || 'Unknown',
      rankGroupName: latest.rank_group_name || '',
    };
  });

  players.sort((a, b) => b.currentPower - a.currentPower);
  players.forEach((p, idx) => { p.currentRank = idx + 1; });

  const totalPower = players.reduce((sum, p) => sum + p.currentPower, 0);
  const avgPower = players.length ? totalPower / players.length : 0;
  const medianPower = median(players.map((p) => p.currentPower));
  const snapshotDates = Array.from(new Set(snapshots.map((s) => s.snapshot_date_utc))).sort();
  const latestTimeUtc = snapshots.map((s) => s.snapshot_time_utc).sort().at(-1) || null;

  const groupStats = GROUP_ORDER.map((group) => {
    const members = players.filter((p) => p.rankGroup === group);
    return {
      group,
      count: members.length,
      totalPower: members.reduce((sum, p) => sum + p.currentPower, 0),
      avgPower: members.length ? members.reduce((sum, p) => sum + p.currentPower, 0) / members.length : 0,
    };
  }).filter((g) => g.count > 0);

  const furnaceStats = buildFurnaceStats(players);
  const growthLeaders = [...players].sort((a, b) => b.gain - a.gain).slice(0, 20);
  const topPower = players.slice(0, 20);
  const watchlist = [...players]
    .filter((p) => p.snapshots.length < snapshotDates.length || p.gain <= 0 || !p.furnaceLevel || p.furnaceLevel < 28)
    .sort((a, b) => a.gain - b.gain)
    .slice(0, 25);

  return { snapshots, players, totalPower, avgPower, medianPower, snapshotDates, latestTimeUtc, groupStats, furnaceStats, growthLeaders, topPower, watchlist };
}

function median(values) {
  const arr = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function buildFurnaceStats(players) {
  const buckets = [
    { label: 'Lv. 30', test: (n) => n === 30 },
    { label: 'Lv. 29', test: (n) => n === 29 },
    { label: 'Lv. 28', test: (n) => n === 28 },
    { label: 'Lv. 27 and below', test: (n) => n != null && n <= 27 },
    { label: 'Unknown', test: (n) => n == null || Number.isNaN(n) },
  ];
  return buckets.map((bucket) => {
    const members = players.filter((p) => bucket.test(p.furnaceLevel));
    return { label: bucket.label, count: members.length, totalPower: members.reduce((sum, p) => sum + p.currentPower, 0) };
  });
}

export function mergeData(existing, importedRows, snapshotTimeUtc) {
  const fallback = snapshotTimeUtc || new Date().toISOString();
  const imported = importedRows.map((r) => normalizeSnapshot(r, fallback));
  const merged = {
    event: existing?.event || { name: 'KvK Prep', startDate: fallback.slice(0, 10) },
    meta: {
      ...(existing?.meta || {}),
      schema_version: '0.2.0',
      time_basis: 'UTC',
      updated_at_utc: new Date().toISOString(),
    },
    snapshots: [...(existing?.snapshots || []), ...imported],
  };
  return dedupeSnapshots(merged);
}

function dedupeSnapshots(data) {
  const seen = new Set();
  const snapshots = [];
  for (const s of data.snapshots || []) {
    const n = normalizeSnapshot(s);
    const key = `${n.snapshot_time_utc}|${n.player_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(n);
  }
  return { ...data, snapshots };
}
