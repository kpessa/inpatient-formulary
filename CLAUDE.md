# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start development server
pnpm build      # Build for production
pnpm start      # Start production server
pnpm lint       # Run ESLint
```

No test framework is configured.

## Architecture

**PharmNet Inpatient Formulary Manager** — a clinical pharmacy formulary management web app with a retro Windows 95/2000 UI aesthetic. Built with Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, and shadcn/ui components.

### Structure

- `app/page.tsx` — Main application shell: title bar, menu bar, toolbar, global drug fields, and tabbed interface
- `app/layout.tsx` — Root layout with Vercel Analytics
- `components/formulary/` — Domain tab components (OEDefaultsTab, DispenseTab, InventoryTab, ClinicalTab, SupplyTab, IdentifiersTab)
- `components/ui/` — 59 shadcn/ui components (Radix UI + Tailwind); do not edit these
- `lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- `data/c152e_extract.csv` — 75MB+ source formulary data from the C152E system

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
