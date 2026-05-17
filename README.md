# Datashot KvK Tracker

Quick-and-dirty static KvK prep dashboard.

## What it does

- Public dashboard reads `public/data/kvk-snapshots.json`.
- Admin tab lets you paste/upload parsed CSV or JSON.
- Admin tab merges into browser localStorage and downloads an updated `kvk-snapshots.json`.
- You manually commit that downloaded file back to `public/data/kvk-snapshots.json`.
- All stored snapshot times and calculations use UTC.

## Local run

```bash
npm install
npm run dev
```

## Manual update workflow

1. Send alliance member screenshots to ChatGPT.
2. ChatGPT returns parsed CSV/JSON.
3. Open the app and go to `#admin`.
4. Upload or paste the parsed data.
5. Set the screenshot capture time. The app stores UTC.
6. Merge into working data.
7. Download `kvk-snapshots.json`.
8. Replace `public/data/kvk-snapshots.json` in GitHub and commit.
9. Your public dashboard updates after redeploy.

## Data rules

- Use `snapshot_time_utc` for comparisons.
- Use `player_key` when available; otherwise the app normalizes `player_name`.
- Do not overwrite old snapshots. Growth requires history.
- Screenshots should be stitched before import so R5/R4/R3/R2/R1 group tags are correct.
