import './styles.css';

const DATA_URL = `${import.meta.env.BASE_URL}data/kvk-snapshots.json`;
const STORAGE_KEY = 'datashot-kvk-tracker-working-data';

function formatPower(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function normalizeKey(name = '') {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function parsePower(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') {
    if (value > 0 && value < 1000) return Math.round(value * 1_000_000);
    return Math.round(value);
  }

  const text = String(value).trim().replace(/,/g, '');
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!match) return Number(text) || 0;

  const n = Number(match[1]);
  const suffix = (match[2] || '').toLowerCase();

  if (suffix === 'b') return Math.round(n * 1_000_000_000);
  if (suffix === 'm') return Math.round(n * 1_000_000);
  if (suffix === 'k') return Math.round(n * 1_000);

  return Math.round(n);
}

function normalizeSnapshot(row) {
  const playerName = row.player_name || row.name || row.Player || row.player || '';
  const time =
    row.snapshot_time_utc ||
    row.snapshot_time ||
    row.snapshot_date_utc ||
    row.snapshot_date ||
    new Date().toISOString();

  const d = new Date(time);
  const iso = Number.isNaN(d.getTime())
    ? new Date().toISOString()
    : d.toISOString();

  const furnaceRaw =
    row.furnace_level ??
    row.furnace ??
    row.level ??
    row.Level ??
    null;

  return {
    ...row,
    player_name: playerName,
    player_key: row.player_key || normalizeKey(playerName),
    snapshot_time_utc: iso,
    snapshot_date_utc: iso.slice(0, 10),
    rank_group: row.rank_group || row.member_group || row.group || row.Group || 'Unknown',
    power: parsePower(row.power ?? row.Power ?? row.power_m ?? row['Power M']),
    furnace_level:
      furnaceRaw === '' || furnaceRaw == null || Number.isNaN(Number(furnaceRaw))
        ? null
        : Number(furnaceRaw),
  };
}

function buildStats(data) {
  const snapshots = (data.snapshots || []).map(normalizeSnapshot);
  const byPlayer = new Map();

  for (const snap of snapshots) {
    if (!snap.player_key) continue;
    if (!byPlayer.has(snap.player_key)) byPlayer.set(snap.player_key, []);
    byPlayer.get(snap.player_key).push(snap);
  }

  const players = [...byPlayer.entries()].map(([key, list]) => {
    list.sort((a, b) => new Date(a.snapshot_time_utc) - new Date(b.snapshot_time_utc));
    const first = list[0];
    const latest = list[list.length - 1];
    const gain = Number(latest.power || 0) - Number(first.power || 0);

    return {
      key,
      name: latest.player_name || first.player_name || key,
      group: latest.rank_group || 'Unknown',
      furnace: latest.furnace_level,
      currentPower: Number(latest.power || 0),
      startingPower: Number(first.power || 0),
      gain,
      pctGain: first.power ? (gain / first.power) * 100 : 0,
      snapshots: list,
    };
  });

  players.sort((a, b) => b.currentPower - a.currentPower);

  const totalPower = players.reduce((sum, p) => sum + p.currentPower, 0);
  const avgPower = players.length ? totalPower / players.length : 0;
  const dates = [...new Set(snapshots.map((s) => s.snapshot_date_utc))].sort();
  const latestTimeUtc = snapshots.map((s) => s.snapshot_time_utc).sort().at(-1) || null;

  const groupOrder = ['R5', 'R4', 'R3', 'R2', 'R1', 'Unknown'];
  const groupStats = groupOrder
    .map((group) => {
      const members = players.filter((p) => p.group === group);
      return {
        group,
        count: members.length,
        totalPower: members.reduce((sum, p) => sum + p.currentPower, 0),
        avgPower: members.length
          ? members.reduce((sum, p) => sum + p.currentPower, 0) / members.length
          : 0,
      };
    })
    .filter((g) => g.count > 0);

  const furnaceBuckets = [
    { label: 'Lv. 30', test: (n) => n === 30 },
    { label: 'Lv. 29', test: (n) => n === 29 },
    { label: 'Lv. 28', test: (n) => n === 28 },
    { label: 'Lv. 27 and below', test: (n) => n != null && n <= 27 },
    { label: 'Unknown', test: (n) => n == null },
  ].map((bucket) => {
    const members = players.filter((p) => bucket.test(p.furnace));
    return {
      label: bucket.label,
      count: members.length,
      totalPower: members.reduce((sum, p) => sum + p.currentPower, 0),
    };
  });

  const hasGrowth = dates.length > 1;

  const growthLeaders = [...players]
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 20);

  const watchlist = players
    .filter((p) => !p.furnace || p.furnace < 28 || (hasGrowth && p.gain <= 0))
    .slice(0, 25);

  return {
    snapshots,
    players,
    totalPower,
    avgPower,
    latestTimeUtc,
    dates,
    groupStats,
    furnaceBuckets,
    growthLeaders,
    topPower: players.slice(0, 20),
    watchlist,
    hasGrowth,
  };
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderDashboard(data) {
  const stats = buildStats(data);
  const app = document.getElementById('app');

  const topPowerRows = stats.topPower
    .map(
      (p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.group}</td>
          <td>${formatPower(p.currentPower)}</td>
        </tr>
      `
    )
    .join('');

  const growthRows = stats.growthLeaders
    .map(
      (p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.group}</td>
          <td>${formatPower(p.startingPower)}</td>
          <td>${formatPower(p.currentPower)}</td>
          <td class="${p.gain >= 0 ? 'good' : 'bad'}">${p.gain >= 0 ? '+' : ''}${formatPower(p.gain)}</td>
          <td>${p.pctGain >= 0 ? '+' : ''}${p.pctGain.toFixed(1)}%</td>
        </tr>
      `
    )
    .join('');

  const groupRows = stats.groupStats
    .map(
      (g) => `
        <tr>
          <td>${g.group}</td>
          <td>${g.count}</td>
          <td>${formatPower(g.totalPower)}</td>
          <td>${formatPower(g.avgPower)}</td>
        </tr>
      `
    )
    .join('');

  const furnaceRows = stats.furnaceBuckets
    .map(
      (f) => `
        <tr>
          <td>${f.label}</td>
          <td>${f.count}</td>
          <td>${formatPower(f.totalPower)}</td>
        </tr>
      `
    )
    .join('');

  const watchRows = stats.watchlist
    .map((p) => {
      const reasons = [];
      if (!p.furnace) reasons.push('Unknown furnace');
      else if (p.furnace < 28) reasons.push(`Furnace ${p.furnace}`);
      if (stats.hasGrowth && p.gain <= 0) reasons.push('No growth');

      return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.group}</td>
          <td>${reasons.join(', ') || 'Review'}</td>
          <td>${formatPower(p.currentPower)}</td>
        </tr>
      `;
    })
    .join('');

  app.innerHTML = `
    <main class="app">
      <header class="hero">
        <div>
          <div class="eyebrow">Datashot</div>
          <h1>KvK Prep Growth Tracker</h1>
          <p class="muted">Static public dashboard backed by one manually updated UTC data file.</p>
          <p class="muted">Latest data update: ${stats.latestTimeUtc || '—'}</p>
        </div>
      </header>

      ${
        !stats.hasGrowth
          ? `<section class="panel callout">
              <h2>Baseline captured</h2>
              <p>This dashboard has one snapshot so far. After the next upload, the growth leaderboard becomes the main KvK prep view.</p>
            </section>`
          : ''
      }

      <section class="grid cards">
        <div class="stat"><span>Members</span><strong>${stats.players.length}</strong></div>
        <div class="stat"><span>Total Power</span><strong>${formatPower(stats.totalPower)}</strong></div>
        <div class="stat"><span>Average Power</span><strong>${formatPower(stats.avgPower)}</strong></div>
        <div class="stat"><span>Snapshots</span><strong>${stats.dates.length}</strong></div>
        <div class="stat"><span>Latest UTC Date</span><strong>${stats.latestTimeUtc ? stats.latestTimeUtc.slice(0, 10) : '—'}</strong></div>
        <div class="stat"><span>Data Source</span><strong>Manual</strong></div>
      </section>

      <section class="panel">
        <h2>${stats.hasGrowth ? 'Growth Leaders' : 'Top Power Leaderboard'}</h2>
        ${
          stats.hasGrowth
            ? table(['#', 'Player', 'Group', 'Start', 'Current', 'Gain', '%'], growthRows)
            : table(['#', 'Player', 'Group', 'Power'], topPowerRows)
        }
      </section>

      <section class="two-col">
        <section class="panel">
          <h2>Rank Group Contribution</h2>
          ${table(['Group', 'Members', 'Total Power', 'Average Power'], groupRows)}
        </section>

        <section class="panel">
          <h2>Furnace Readiness</h2>
          ${table(['Bucket', 'Members', 'Power'], furnaceRows)}
        </section>
      </section>

      <section class="panel">
        <h2>Watchlist</h2>
        ${
          watchRows
            ? table(['Player', 'Group', 'Reason', 'Power'], watchRows)
            : '<p class="muted">No watchlist items yet.</p>'
        }
      </section>

      <section class="panel">
        <h2>Manual Update Workflow</h2>
        <p>Send screenshots to ChatGPT, get parsed JSON/CSV, replace <code>public/data/kvk-snapshots.json</code>, then commit.</p>
        <p class="muted">All snapshot times should be stored as UTC.</p>
      </section>
    </main>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function loadData() {
  const app = document.getElementById('app');

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      renderDashboard(JSON.parse(saved));
      return;
    }

    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${DATA_URL}. HTTP ${res.status}`);

    const data = await res.json();
    renderDashboard(data);
  } catch (err) {
    app.innerHTML = `
      <main class="app">
        <section class="panel">
          <h1>Datashot KvK Tracker</h1>
          <p class="error">${escapeHtml(err.message)}</p>
          <p>Check that <code>public/data/kvk-snapshots.json</code> exists and contains valid JSON.</p>
        </section>
      </main>
    `;
  }
}

loadData();
