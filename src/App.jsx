import React, { useEffect, useMemo, useState } from 'react';
import { buildStats, mergeData, parseCsv, toUtcIso } from './lib/stats.js';
import { formatPct, formatPower, formatSignedPower, utcDateLabel } from './lib/formatters.js';

const STORAGE_KEY = 'datashot-kvk-tracker-working-data';

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState(window.location.hash === '#admin' ? 'admin' : 'dashboard');

  useEffect(() => {
    async function load() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setData(JSON.parse(saved));
          return;
        }
        const res = await fetch('/data/kvk-snapshots.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not load /data/kvk-snapshots.json (${res.status})`);
        setData(await res.json());
      } catch (err) {
        setLoadError(err.message || 'Unable to load tracker data.');
      }
    }
    load();
  }, []);

  useEffect(() => {
    window.location.hash = tab === 'admin' ? 'admin' : '';
  }, [tab]);

  const stats = useMemo(() => (data ? buildStats(data) : null), [data]);

  function saveWorkingData(next) {
    setData(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function resetWorkingData() {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }

  if (loadError) return <Shell tab={tab} setTab={setTab}><div className="panel error">{loadError}</div></Shell>;
  if (!data || !stats) return <Shell tab={tab} setTab={setTab}><div className="panel">Loading tracker…</div></Shell>;

  return (
    <Shell tab={tab} setTab={setTab} updatedAt={data?.meta?.updated_at_utc}>
      {tab === 'dashboard' ? (
        <Dashboard data={data} stats={stats} />
      ) : (
        <Admin data={data} stats={stats} onSave={saveWorkingData} onReset={resetWorkingData} />
      )}
    </Shell>
  );
}

function Shell({ children, tab, setTab, updatedAt }) {
  return (
    <div className="app">
      <header className="hero">
        <div>
          <div className="eyebrow">Datashot</div>
          <h1>KvK Prep Growth Tracker</h1>
          <p>Static public dashboard backed by one manually updated UTC data file.</p>
          {updatedAt && <p className="muted">Last data update: {updatedAt}</p>}
        </div>
        <nav className="tabs">
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Admin</button>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

function Dashboard({ data, stats }) {
  const hasGrowth = stats.snapshotDates.length > 1;
  return (
    <>
      <section className="grid cards">
        <StatCard label="Members tracked" value={stats.players.length} />
        <StatCard label="Total alliance power" value={formatPower(stats.totalPower)} />
        <StatCard label="Average power" value={formatPower(stats.avgPower)} />
        <StatCard label="Median power" value={formatPower(stats.medianPower)} />
        <StatCard label="Snapshot dates" value={stats.snapshotDates.length} sub={stats.snapshotDates.map(utcDateLabel).join(' → ')} />
        <StatCard label="Latest snapshot UTC" value={utcDateLabel(stats.latestTimeUtc)} sub={stats.latestTimeUtc || '—'} />
      </section>

      {!hasGrowth && (
        <section className="panel callout">
          <h2>Baseline captured</h2>
          <p>This dashboard has one snapshot so far. After the next upload, the growth leaderboard, no-growth watchlist, and percent gain columns become the main KvK prep view.</p>
        </section>
      )}

      <section className="two-col">
        <Panel title={hasGrowth ? 'Top growth' : 'Top power now'}>
          <PlayerTable players={hasGrowth ? stats.growthLeaders : stats.topPower} showGrowth={hasGrowth} />
        </Panel>
        <Panel title="Furnace readiness">
          <SimpleTable rows={stats.furnaceStats.map((r) => ({ label: r.label, count: r.count, power: formatPower(r.totalPower) }))} columns={[['label', 'Bucket'], ['count', 'Members'], ['power', 'Power']]} />
        </Panel>
      </section>

      <section className="two-col">
        <Panel title="Rank group contribution">
          <SimpleTable rows={stats.groupStats.map((r) => ({ group: r.group, count: r.count, total: formatPower(r.totalPower), avg: formatPower(r.avgPower) }))} columns={[['group', 'Group'], ['count', 'Members'], ['total', 'Total'], ['avg', 'Avg']]} />
        </Panel>
        <Panel title="Watchlist">
          <Watchlist rows={stats.watchlist} snapshotCount={stats.snapshotDates.length} />
        </Panel>
      </section>

      <Panel title="Top 20 power leaderboard">
        <PlayerTable players={stats.topPower} showGrowth={hasGrowth} />
      </Panel>
    </>
  );
}

function Admin({ data, stats, onSave, onReset }) {
  const [raw, setRaw] = useState('');
  const [snapshotTime, setSnapshotTime] = useState(new Date().toISOString().slice(0, 16));
  const [message, setMessage] = useState('');

  function importedRowsFromRaw() {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return parsed.snapshots || [];
    }
    if (trimmed.startsWith('[')) return JSON.parse(trimmed);
    return parseCsv(trimmed);
  }

  function previewImport() {
    try {
      const rows = importedRowsFromRaw();
      setMessage(`Parsed ${rows.length} rows. Snapshot time will be stored as ${toUtcIso(snapshotTime)}.`);
    } catch (err) {
      setMessage(`Import error: ${err.message}`);
    }
  }

  function mergeImport() {
    try {
      const rows = importedRowsFromRaw();
      const next = mergeData(data, rows, toUtcIso(snapshotTime));
      onSave(next);
      setMessage(`Merged ${rows.length} rows. Working data now has ${next.snapshots.length} snapshots.`);
    } catch (err) {
      setMessage(`Import error: ${err.message}`);
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kvk-snapshots.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file) {
    if (!file) return;
    setRaw(await file.text());
  }

  return (
    <section className="panel admin">
      <h2>Manual update workflow</h2>
      <p className="muted">Paste CSV/JSON from the parsed screenshots, merge it into browser working data, then download <code>kvk-snapshots.json</code> and commit it to <code>public/data/kvk-snapshots.json</code>.</p>
      <div className="admin-grid">
        <label>
          Snapshot time, entered in your browser then converted to UTC
          <input type="datetime-local" value={snapshotTime} onChange={(e) => setSnapshotTime(e.target.value)} />
        </label>
        <label>
          Upload CSV or JSON
          <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
      </div>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste CSV or JSON here…" />
      <div className="actions">
        <button onClick={previewImport}>Preview parse</button>
        <button onClick={mergeImport}>Merge into working data</button>
        <button onClick={downloadJson}>Download kvk-snapshots.json</button>
        <button className="danger" onClick={onReset}>Reset browser working copy</button>
      </div>
      {message && <p className="message">{message}</p>}
      <div className="mini-stats">
        <StatCard label="Working members" value={stats.players.length} />
        <StatCard label="Working snapshots" value={data.snapshots?.length || 0} />
        <StatCard label="UTC latest" value={utcDateLabel(stats.latestTimeUtc)} sub={stats.latestTimeUtc || '—'} />
      </div>
    </section>
  );
}

function StatCard({ label, value, sub }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function PlayerTable({ players, showGrowth }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Player</th><th>Group</th><th>Power</th>{showGrowth && <><th>Gain</th><th>%</th></>}</tr></thead>
        <tbody>
          {players.map((p, i) => <tr key={p.key}><td>{i + 1}</td><td>{p.name}</td><td>{p.rankGroup}</td><td>{formatPower(p.currentPower)}</td>{showGrowth && <><td className={p.gain >= 0 ? 'good' : 'bad'}>{formatSignedPower(p.gain)}</td><td>{formatPct(p.pctGain)}</td></>}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ rows, columns }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{columns.map(([key]) => <td key={key}>{row[key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Watchlist({ rows, snapshotCount }) {
  if (!rows.length) return <p className="muted">No watchlist items yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Player</th><th>Reason</th><th>Power</th></tr></thead>
        <tbody>
          {rows.map((p) => {
            const reasons = [];
            if (p.snapshots.length < snapshotCount) reasons.push('Missing latest snapshot');
            if (p.gain <= 0 && snapshotCount > 1) reasons.push('No growth');
            if (!p.furnaceLevel) reasons.push('Unknown furnace');
            else if (p.furnaceLevel < 28) reasons.push(`Furnace ${p.furnaceLevel}`);
            return <tr key={p.key}><td>{p.name}</td><td>{reasons.join(', ') || 'Review'}</td><td>{formatPower(p.currentPower)}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
