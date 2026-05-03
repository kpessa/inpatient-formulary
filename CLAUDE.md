# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start development server (foreground)
pnpm build      # Build for production
pnpm start      # Start production server
pnpm lint       # Run ESLint
```

No test framework is configured.

## Always-on dev server (launchd)

A `launchd` LaunchAgent at `scripts/launchd/com.kurtpessa.inpatient-formulary.dev.plist` runs `next dev` automatically on login. The agent stays up across crashes (KeepAlive on non-zero exit, throttled 30s) and writes logs to `~/Library/Logs/InpatientFormulary/dev-{stdout,stderr}.log`.

```bash
pnpm dev:install    # one-time setup: symlink plist into ~/Library/LaunchAgents and bootstrap
pnpm dev:restart    # SIGTERM + auto-relaunch (use after env/config/dep changes)
pnpm dev:logs       # tail both log files
pnpm dev:status     # launchctl print summary
pnpm dev:uninstall  # bootout + remove agent (logs preserved)
```

**When to restart vs. trust HMR.** Most code edits (components, libs, route handlers, types, styles) are picked up by Next.js HMR — *do not restart*. Restart only when:

- `next.config.*` changes
- `.env*` files change (Next.js reads them at boot)
- Package install / removal (`pnpm add`, `pnpm remove`)
- The dev server has visibly wedged (HMR errors not clearing, port stuck)
- A new API route's TypeScript fails to register without a rebuild

If Claude is editing from a sandboxed environment that can't reach `launchctl` directly, instruct the user to run `pnpm dev:restart` themselves rather than trying to spawn a host shell.

## Architecture

**PharmNet Inpatient Formulary Manager** — a clinical pharmacy formulary management web app with a retro Windows 95/2000 UI aesthetic. Built with Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, and shadcn/ui components.

### Structure

- `app/page.tsx` — Main application shell: title bar, menu bar, toolbar, global drug fields, and tabbed interface
- `app/layout.tsx` — Root layout with Vercel Analytics
- `components/formulary/` — Domain tab components (OEDefaultsTab, DispenseTab, InventoryTab, ClinicalTab, SupplyTab, IdentifiersTab)
- `components/ui/` — 59 shadcn/ui components (Radix UI + Tailwind); do not edit these
- `lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- `data/c152e_extract.csv` — 75MB+ source formulary data from the C152E system
- `data/formulary.db` — local SQLite file; **no longer used** — app is fully migrated to Turso

### Database

The app uses **Turso** (libsql) exclusively. `DATABASE_URL` points to `libsql://inpatient-formulary-kpessa.aws-us-east-1.turso.io`. The local `data/formulary.db` file is stale and should be ignored. Schema is in `lib/schema.sql`; data was loaded via `scripts/migrate_to_turso.ts`.

### Key patterns

- All components use `"use client"` — this is a fully client-side app despite using App Router
- State is local (useState); there is no global state manager or API layer
- Forms use react-hook-form + zod via shadcn/ui form primitives
- Facilities, locations, and supply data are hardcoded in the tab components (no backend)

### UI theme

The retro clinical aesthetic uses CSS variables defined in `app/globals.css`:
- Header: `#C85A00`, toolbar/workspace: `#D4D0C8`, borders: `#808080`
- Active selection: `#316AC5`, required fields: `#CC0000`

When adding new UI, match this color scheme and the existing Windows-desktop visual style rather than modern design conventions.
