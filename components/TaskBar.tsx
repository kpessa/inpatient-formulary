'use client'

import { useState, useEffect } from 'react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export type WindowId = 'formulary' | 'search' | 'categories' | 'patterns'

interface WindowEntry {
  id: WindowId
  label: string
  icon: string
}

interface TaskBarProps {
  openWindows: Set<WindowId>
  minimizedWindows: Set<WindowId>
  focusedWindow: WindowId
  isTaskPanelOpen: boolean
  onFocusWindow: (id: WindowId) => void
  onStartMenuAction: (id: WindowId | 'tasks') => void
}

const WINDOW_DEFS: WindowEntry[] = [
  { id: 'formulary',   label: 'Formulary Manager',  icon: '💊' },
  { id: 'search',      label: 'Product Search',      icon: '🔍' },
  { id: 'categories',  label: 'Category Manager',    icon: '🏷' },
  { id: 'patterns',    label: 'Pattern Manager',     icon: '◈' },
]

const MENU_ITEM_CLASS = 'rounded-none px-3 py-1 cursor-default hover:bg-[#316AC5] hover:text-white focus:bg-[#316AC5] focus:text-white flex items-center gap-2 text-[11px] font-mono'

export function TaskBar({ openWindows, minimizedWindows, focusedWindow, isTaskPanelOpen, onFocusWindow, onStartMenuAction }: TaskBarProps) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    update()
    const id = setInterval(update, 10000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 z-[200] bg-[#D4D0C8] border-t-2 border-white flex items-center gap-1 px-1 select-none"
         style={{ boxShadow: 'inset 0 1px 0 #fff' }}>

      {/* Start button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="h-6 px-2 text-[11px] font-mono font-bold border border-[#808080] bg-[#D4D0C8] flex items-center gap-1 shrink-0"
                  style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            <span className="text-[13px] leading-none">⊞</span>
            PharmNet
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="rounded-none border-[#808080] bg-[#D4D0C8] p-0 font-mono text-xs min-w-[200px] shadow-[2px_2px_0_#000]"
          style={{ zIndex: 210 }}
        >
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => onStartMenuAction('formulary')}>
            <span>💊</span> Formulary Manager
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => onStartMenuAction('search')}>
            <span>🔍</span> Product Search
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => onStartMenuAction('categories')}>
            <span>🏷</span> Category Manager
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => onStartMenuAction('patterns')}>
            <span>◈</span> Pattern Manager
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#808080] my-0" />
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => onStartMenuAction('tasks')}>
            <span className="w-3 text-center">{isTaskPanelOpen ? '✓' : ''}</span> Task Manager
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Separator */}
      <div className="w-px h-5 bg-[#808080] mx-0.5 shrink-0" />

      {/* Window buttons */}
      {WINDOW_DEFS.filter(w => openWindows.has(w.id)).map(w => {
        const isActive = focusedWindow === w.id && !minimizedWindows.has(w.id)
        const isMinimized = minimizedWindows.has(w.id)
        return (
          <button
            key={w.id}
            onClick={() => onFocusWindow(w.id)}
            className={`h-6 px-2 text-[10px] font-mono flex items-center gap-1 min-w-[80px] max-w-[160px] truncate border border-[#808080] ${
              isActive ? 'bg-[#C0C0C0]' : 'bg-[#D4D0C8]'
            } ${isMinimized ? 'italic' : ''}`}
            style={isActive
              ? { boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }
              : { boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }
            }
            title={w.label}
          >
            <span className="text-[11px] leading-none shrink-0">{w.icon}</span>
            <span className="truncate">{w.label}</span>
          </button>
        )
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clock */}
      <div className="h-6 px-2 text-[10px] font-mono flex items-center border border-[#808080] shrink-0"
           style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
           suppressHydrationWarning>
        {time}
      </div>
    </div>
  )
}
