"use client"

import { useState, type ReactNode } from "react"

// Win95-styled window chrome for full-tab admin routes (Extract Changes,
// Standardization Backlog, etc.). Matches the visual language of the
// floating windows on the main desktop (TaskManagerWindow, the Formulary
// Manager) so admin pages don't feel disconnected.
//
// Caveat: these admin pages are SEPARATE BROWSER TABS, not floating windows
// on the desktop, so minimize / maximize semantics differ from a real
// window manager:
//   - ─ Minimize: closes the tab (the "minimize" of a tab is closing it)
//   - □ Maximize: toggles a centered max-width vs full-width content layout
//   - ✕ Close:    closes the tab (window.close())
//
// `window.close()` only works when the tab was opened via window.open()
// from another tab — which is how the Start menu links operate. Direct
// URL visits won't be closeable; the buttons still render but the close
// action becomes a no-op (browsers swallow it silently).

interface Props {
  icon: string
  title: string
  /** Optional small text after the title — e.g. "(architect+)" */
  subtitle?: string
  children: ReactNode
}

export function AdminWindowFrame({ icon, title, subtitle, children }: Props) {
  // Default state: content is maximized (full width inside the frame). Click
  // the maximize button to "restore" to a centered max-width layout.
  // Convention matches TaskManagerWindow: ❐ icon when currently maximized
  // (click to restore), □ when restored (click to maximize).
  const [maximized, setMaximized] = useState(true)

  return (
    <div className="min-h-screen bg-[#808080] p-2 font-sans text-xs">
      <div className={`bg-[#D4D0C8] border border-white border-r-[#808080] border-b-[#808080] ${maximized ? '' : 'max-w-[1280px] mx-auto'}`}
           style={{ boxShadow: '2px 2px 0 #000' }}>
        {/* Title bar */}
        <div className="flex items-center justify-between text-white px-2 h-7 shrink-0 bg-[#316AC5]">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">
              {icon}
            </div>
            <span className="text-sm font-bold font-mono tracking-tight">{title}</span>
            {subtitle && <span className="text-[10px] font-normal opacity-90 ml-1">{subtitle}</span>}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => window.close()}
              className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E0DBD0]"
              title="Minimize (browser tab — closes the tab)"
              aria-label="Minimize"
            >─</button>
            <button
              onClick={() => setMaximized(m => !m)}
              className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E0DBD0]"
              title={maximized ? 'Restore (centered, max width)' : 'Maximize (full width)'}
              aria-label={maximized ? 'Restore' : 'Maximize'}
            >{maximized ? '❐' : '□'}</button>
            <button
              onClick={() => window.close()}
              className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E5A0A0]"
              title="Close tab"
              aria-label="Close"
            >✕</button>
          </div>
        </div>

        {/* Content */}
        <div className="p-3">
          {children}
        </div>
      </div>
    </div>
  )
}
