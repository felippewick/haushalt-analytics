# Haushalt Analytics

Local app to visualize and categorize expenses from **DKB Girokonto** and **Trade Republic** CSV exports. All data stays on your computer — no cloud, no database, no account.

## For everyone (Mac / Windows)

1. Open this repository’s **Releases** page and download the latest installer for your system:
   - **Mac (Apple Silicon):** `.dmg` with `aarch64` in the filename
   - **Mac (Intel):** `.dmg` with `x64` / `x86_64` in the filename
   - **Windows:** `.msi` (recommended) or `.exe`
2. Install and open **Haushalt Analytics**.
3. Go to **Import** and drop a bank CSV.

Your data is saved automatically on this machine. Nothing is uploaded.

> **Unsigned builds:** Until the app is code-signed, macOS Gatekeeper or Windows SmartScreen may warn on first open. On Mac: right-click the app → **Open**. On Windows: choose **More info** → **Run anyway**.

A sample file is included for developers: [`sample-dkb.csv`](sample-dkb.csv).

## Export CSV from DKB

1. Log in to [banking.dkb.de](https://banking.dkb.de)
2. Open your **Girokonto**
3. Open **Umsätze** (transactions)
4. Pick a date range (export regularly; overlapping ranges are fine)
5. Click **Export** → **CSV**

The app expects the current (post-2023) format: semicolon-separated, German dates (`DD.MM.YYYY`), and amounts with decimal commas (`-12,34`).

> **Why not pull via API?** DKB’s PSD2 interface is only for licensed third-party providers. For a local personal tool, CSV export is the reliable option. Unofficial scrapers need 2FA and break often.

## Features

- **Import** with automatic dedupe (safe to re-export overlapping periods)
- **Auto-categorization** via keyword rules (REWE → Groceries, BVG → Transport, etc.)
- **Manual overrides** in the transactions table; check **always** to remember a merchant
- **Overview**: stacked expense chart for a selectable month range (defaults to the last 12 months when enough history exists); click a month for income/expenses, category donut, and biggest expenses. Months missing data for an account are marked on the chart.
- **Accounts**: import CSVs into named accounts (DKB, Trade Republic, …); aggregate all by default or filter in the header
- **DKB + Trade Republic** CSV auto-detection on import
- **Persistence**: desktop app writes to the OS app-data folder; browser/dev mode writes to [`data/store.json`](data/store.json)

## Categories

Groceries, Coffee & Restaurants, Rent, Clothing, Transport, Subscriptions, Insurance, Health, Utilities, Shopping, Entertainment, Kids, Travel, Reserves (Rücklagen), Investments (income), ATM / Cash, Salary, Transfer (excluded from totals), Other, Uncategorized.

Internal transfers should be tagged **Transfer** so they don’t inflate spending. Monthly **manual reserves** count in that month’s totals; when the bank later pays them out, tag the bank booking as Transfer to avoid double-counting.

## Develop (maintainers)

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (for the desktop shell)
- On Mac: Xcode Command Line Tools (`xcode-select --install`)
- On Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the “Desktop development with C++” workload, plus WebView2 (usually preinstalled on Windows 10/11)

### Browser-only (fast UI iteration)

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Persistence uses the Vite middleware → `data/store.json`.

### Desktop app

```bash
npm install
npm run tauri:dev      # Vite + native window
npm run tauri:build    # production installers
```

Installers are written under:

`src-tauri/target/release/bundle/`

| Platform | Artifacts |
|----------|-----------|
| macOS (build on a Mac) | `.app`, `.dmg` |
| Windows (build on Windows) | `.msi`, NSIS `.exe` |

Cross-compiling Mac ↔ Windows is not supported in the default setup — build each OS on that OS (or a matching CI runner).

#### Where desktop data lives

| OS | `store.json` location |
|----|------------------------|
| macOS | `~/Library/Application Support/com.haushalt.analytics/store.json` |
| Windows | `%APPDATA%\com.haushalt.analytics\store.json` |

This is **not** the same file as repo `data/store.json`. Dev browser data is not auto-migrated into the packaged app.

#### GitHub Releases (CI)

Pushing a version tag builds Mac + Windows installers and attaches them to a **draft** GitHub Release (see [`.github/workflows/release.yml`](.github/workflows/release.yml)).

1. Bump the version in all three places (keep them equal):
   - [`package.json`](package.json)
   - [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)
   - [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml)
2. Commit, then tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. Wait for the **Release** workflow on the Actions tab (macOS arm, macOS Intel, Windows).
4. Open the draft release → review assets → **Publish release**.

You can also run **Actions → Release → Run workflow** without a tag; it creates `v__VERSION__` from `tauri.conf.json`.

If the workflow fails with “Resource not accessible by integration”, set **Settings → Actions → General → Workflow permissions** to **Read and write permissions**.

#### Code signing (before wider distribution)

Unsigned builds work for your own testing but scare non-technical users:

- **macOS:** Apple Developer ID + notarization
- **Windows:** Authenticode / code-signing certificate

Add signing secrets and Tauri signing config when you are ready to ship publicly. After that, the same Release workflow can produce trusted installers.

## Project layout

| Path | Role |
|------|------|
| `src/lib/dkbParser.ts` | DKB CSV parsing |
| `src/lib/categorize.ts` / `defaultRules.ts` | Rule engine + German defaults |
| `src/lib/store.ts` | Load/save + merge/dedupe (Tauri FS or Vite `/api/store`) |
| `vite-plugin-json-store.ts` | Dev-server `GET/POST /api/store` |
| `data/store.json` | Browser/dev persistence |
| `src-tauri/` | Tauri 2 desktop shell (Mac/Windows installers) |

## Scripts

```bash
npm run dev          # browser + JSON persistence
npm run build        # frontend production build
npm run preview      # preview build (persistence middleware included)
npm run tauri:dev    # desktop app (dev)
npm run tauri:build  # desktop installers
```

## Notes

- **Visa card** exports use a different CSV layout — not supported yet (Girokonto only).
- PayPal / Amazon / Klarna often hide the real merchant; purpose text sometimes helps, or set a manual rule.
- Refunds (positive amounts at merchants) are netted within their category.
