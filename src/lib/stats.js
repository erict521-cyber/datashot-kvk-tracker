const GROUP_ORDER = ['R5', 'R4', 'R3', 'R2', 'R1', 'R0'];
const DEFAULT_PREP_START_DATE_UTC = '2026-05-18';
const DEFAULT_PREP_DAYS = 5;

export function normalizePlayerKey(name = '') {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export function normalizeSnapshot(row, fallbackTimeUtc) {
  const playerName = row.player_name || row.name || row.Player || row.player || '';
  const snapshotTime =
    row.snapshot_time_utc ||
    row.snapshot_time ||
    row.date ||
    row.snapshot_date_utc ||
    row.snapshot_date ||
    fallbackTimeUtc;

  const normalizedTime = toUtcIso(snapshotTime);
  const power = parsePower(row.power ?? row.Power ?? row.power_m ?? row['Power M']);
  const townCenterRaw =
    row.town_center_level ??
    row.town_center ??
    row.furnace_level ??
    row.furnace ??
    row.level ??
    row.Level;

  const truegoldRaw =
    row.truegold_level ??
    row.truegold_tier ??
    row.truegold ??
    row.tg_level ??
    row.tg ??
    null;

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
    town_center_level: parseInteger(townCenterRaw),
    furnace_level: parseInteger(townCenterRaw),
    truegold_level: parseInteger(truegoldRaw),
    alliance_power_rank: parseInteger(row.alliance_power_rank ?? row.power_rank ?? row.rank),
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

function parseInteger(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseCsv(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);

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
  const snapshots = (data?.snapshots || [])
    .map((s) => normalizeSnapshot(s))
    .sort((a, b) => new Date(a.snapshot_time_utc) - new Date(b.snapshot_time_utc));

  const earliestSnapshotTimeUtc = snapshots[0]?.snapshot_time_utc || null;
  const latestTimeUtc = snapshots.at(-1)?.snapshot_time_utc || null;

  const prepStartDateUtc =
    data?.event?.prep_start_date_utc ||
    data?.event?.prepStartDateUtc ||
    DEFAULT_PREP_START_DATE_UTC;

  const prepDays = Number(data?.event?.prep_days || data?.event?.prepDays || DEFAULT_PREP_DAYS);

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
    const growthEligible = first.snapshot_time_utc === earliestSnapshotTimeUtc;

    return {
      key,
      name: latest.player_name || first.player_name || key,
      first,
      latest,
      snapshots: list,
      gain,
      pctGain,
      growthEligible,
      currentPower: Number(latest.power || 0),
      startingPower: Number(first.power || 0),
      townCenterLevel: latest.town_center_level ?? latest.furnace_level ?? null,
      truegoldLevel: latest.truegold_level ?? null,
      rankGroup: latest.rank_group || latest.member_group || 'Unknown',
      rankGroupName: latest.rank_group_name || '',
    };
  });

  players.sort((a, b) => b.currentPower - a.currentPower);
  players.forEach((p, idx) => {
    p.currentRank = idx + 1;
  });

  const totalPower = players.reduce((sum, p) => sum + p.currentPower, 0);
  const avgPower = players.length ? totalPower / players.length : 0;
  const medianPower = median(players.map((p) => p.currentPower));
  const snapshotDates = Array.from(new Set(snapshots.map((s) => s.snapshot_date_utc))).sort();

  const groupStats = GROUP_ORDER.map((group) => {
    const members = players.filter((p) => p.rankGroup === group);
    return {
      group,
      count: members.length,
      totalPower: members.reduce((sum, p) => sum + p.currentPower, 0),
      avgPower: members.length
        ? members.reduce((sum, p) => sum + p.currentPower, 0) / members.length
        : 0,
    };
  }).filter((row) => row.count > 0);

  const timeline = buildTimeline(snapshots, prepStartDateUtc, prepDays);
  const townCenterStats = buildTownCenterStats(players);
  const truegoldStats = buildTruegoldStats(players);

  const growthLeaders = [...players]
    .filter((p) => p.growthEligible)
    .sort((a, b) => b.gain - a.gain || b.pctGain - a.pctGain)
    .slice(0, 20);

  const highestGrowerOverall = growthLeaders[0] || null;

  const watchlist = [...players]
    .filter((p) => {
      const missingSnapshots = p.snapshots.length < timeline.length;
      const noGrowth = p.growthEligible && timeline.length > 1 && p.gain <= 0;
      const unknownTownCenter = !p.townCenterLevel;
      const lowTownCenter = p.townCenterLevel != null && p.townCenterLevel < 28;
      return missingSnapshots || noGrowth || unknownTownCenter || lowTownCenter;
    })
    .sort((a, b) => a.gain - b.gain)
    .slice(0, 25);

  return {
    snapshots,
    players,
    totalPower,
    avgPower,
    medianPower,
    snapshotDates,
    latestTimeUtc,
    earliestSnapshotTimeUtc,
    groupStats,
    townCenterStats,
    truegoldStats,
    growthLeaders,
    highestGrowerOverall,
    watchlist,
    timeline,
    prepStartDateUtc,
    prepDays,
    currentPrepDay: calculatePrepDay(latestTimeUtc, prepStartDateUtc),
    summary: {
      tc30Members: players.filter((p) => p.townCenterLevel === 30).length,
      tc29PlusMembers: players.filter((p) => Number(p.townCenterLevel || 0) >= 29).length,
      truegoldMembers: players.filter((p) => Number(p.truegoldLevel || 0) > 0).length,
    },
  };
}

function buildTimeline(snapshots, prepStartDateUtc, prepDays) {
  const byTime = new Map();

  for (const snap of snapshots) {
    const list = byTime.get(snap.snapshot_time_utc) || [];
    list.push(snap);
    byTime.set(snap.snapshot_time_utc, list);
  }

  const points = Array.from(byTime.entries())
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([timeUtc, rows]) => ({
      timeUtc,
      dateUtc: timeUtc.slice(0, 10),
      totalPower: rows.reduce((sum, row) => sum + Number(row.power || 0), 0),
      memberCount: rows.length,
      prepDay: calculatePrepDay(timeUtc, prepStartDateUtc, prepDays),
    }));

  const baseline = points[0]?.totalPower || 0;

  return points.map((point) => ({
    ...point,
    gainFromStart: point.totalPower - baseline,
  }));
}

function calculatePrepDay(timeUtc, prepStartDateUtc) {
  if (!timeUtc || !prepStartDateUtc) return 1;

  const dayMs = 24 * 60 * 60 * 1000;
  const current = new Date(timeUtc);
  const currentDayUtc = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  );

  const start = new Date(`${prepStartDateUtc}T00:00:00Z`);
  const startDayUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );

  const diffDays = Math.floor((currentDayUtc - startDayUtc) / dayMs);
  return diffDays + 1;
}

function median(values) {
  const arr = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function buildTownCenterStats(players) {
  const buckets = [
    { label: 'TC30', test: (n) => n === 30 },
    { label: 'TC29', test: (n) => n === 29 },
    { label: 'TC28', test: (n) => n === 28 },
    { label: 'TC27 and below', test: (n) => n != null && n <= 27 },
    { label: 'Unknown', test: (n) => n == null || Number.isNaN(n) },
  ];

  return buckets.map((bucket) => {
    const members = players.filter((p) => bucket.test(p.townCenterLevel));
    return {
      label: bucket.label,
      count: members.length,
      totalPower: members.reduce((sum, p) => sum + p.currentPower, 0),
    };
  });
}

function buildTruegoldStats(players) {
  const buckets = [
    { label: 'TG-3+', test: (n) => Number(n || 0) >= 3 },
    { label: 'TG-2', test: (n) => Number(n || 0) === 2 },
    { label: 'TG-1', test: (n) => Number(n || 0) === 1 },
    { label: 'No TG badge', test: (n) => !n || Number(n) <= 0 },
  ];

  return buckets.map((bucket) => {
    const members = players.filter((p) => bucket.test(p.truegoldLevel));
    return {
      label: bucket.label,
      count: members.length,
      totalPower: members.reduce((sum, p) => sum + p.currentPower, 0),
    };
  });
}

export function mergeData(existing, importedRows, snapshotTimeUtc) {
  const fallback = snapshotTimeUtc || new Date().toISOString();
  const imported = importedRows.map((r) => normalizeSnapshot(r, fallback));

  const merged = {
    schema_version: existing?.schema_version || '0.3.0',
    event: {
      ...(existing?.event || {}),
      timezone_policy: 'UTC',
      prep_start_date_utc:
        existing?.event?.prep_start_date_utc ||
        existing?.event?.prepStartDateUtc ||
        DEFAULT_PREP_START_DATE_UTC,
      prep_days:
        Number(existing?.event?.prep_days || existing?.event?.prepDays || DEFAULT_PREP_DAYS),
    },
    capture: {
      ...(existing?.capture || {}),
    },
    meta: {
      ...(existing?.meta || {}),
      schema_version: '0.3.0',
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
}  return d.toISOString();
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
