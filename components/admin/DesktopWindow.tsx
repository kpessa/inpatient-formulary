'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'

// Generic floating-window chrome for admin views (Extract Changeset Viewer,
// Standardization Backlog, etc) — extracted from the TaskManagerWindow
// pattern in components/formulary/TaskManagerWindow.tsx so multiple admin
// windows can share the move/resize/min/max boilerplate without copy-paste.
//
// Caller passes the content as `children`; this component owns:
//   - rect state (x, y, w, h)
//   - drag-to-move + resize-from-edges handlers
//   - title bar with min/max/close buttons
//   - focused/blurred styling
//
// Window title bar uses #316AC5 (the project's "active selection" / Win95
// blue) when focused and gray when blurred — matches TaskManagerWindow.

interface Props {
  open: boolean
  minimized?: boolean
  focused?: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  icon: string
  title: string
  subtitle?: string
  initialSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  zIndex?: number
  children: ReactNode
}

type Rect = { x: number; y: number; w: number; h: number }

export function DesktopWindow({
  open,
  minimized = false,
  focused = true,
  onClose,
  onMinimize,
  onFocus,
  icon,
  title,
  subtitle,
  initialSize = { w: 1100, h: 720 },
  minSize = { w: 600, h: 400 },
  zIndex = 100,
  children,
}: Props) {
  const [rect, setRect] = useState<Rect | null>(null)
  const [maximized, setMaximized] = useState(false)
  const preMaxRect = useRef<Rect | null>(null)
  const isDragging = useRef<{ dir: string; startX: number; startY: number; startRect: Rect } | null>(null)

  useEffect(() => {
    if (rect) return
    setRect({
      x: Math.max(0, (window.innerWidth  - initialSize.w) / 2),
      y: Math.max(0, (window.innerHeight - initialSize.h) / 2),
      w: initialSize.w,
      h: initialSize.h,
    })
  }, [rect, initialSize.w, initialSize.h])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return
      const { dir, startX, startY, startRect } = isDragging.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dir === 'move') {
        setRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy })
        return
      }
      let { x, y, w, h } = startRect
      if (dir.includes('e')) w = Math.max(minSize.w, startRect.w + dx)
      if (dir.includes('w')) {
        const nw = Math.max(minSize.w, startRect.w - dx)
        x = startRect.x + (startRect.w - nw)
        w = nw
      }
      if (dir.includes('s')) h = Math.max(minSize.h, startRect.h + dy)
      if (dir.includes('n')) {
        const nh = Math.max(minSize.h, startRect.h - dy)
        y = startRect.y + (startRect.h - nh)
        h = nh
      }
      setRect({ x, y, w, h })
    }
    const onUp = () => { isDragging.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [minSize.w, minSize.h])

  const handlePointerDown = (dir: string) => (e: React.PointerEvent) => {
    if (!rect || maximized) return
    if (dir === 'move' && (e.target as HTMLElement).closest('button')) return  // don't drag from buttons
    e.preventDefault()
    isDragging.current = { dir, startX: e.clientX, startY: e.clientY, startRect: rect }
    onFocus?.()
  }

  const toggleMaximize = () => {
    if (maximized) {
      if (preMaxRect.current) setRect(preMaxRect.current)
      setMaximized(false)
    } else {
      preMaxRect.current = rect
      setMaximized(true)
    }
  }

  if (!open || !rect) return null

  // Use opacity + scale + pointer-events instead of display:none when
  // minimized — gives a small fade/shrink animation when admin views are
  // minimized to bring Formulary Manager to front.
  const baseStyle = maximized
    ? { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 32, zIndex }
    : { position: 'fixed' as const, left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex }

  const style = {
    ...baseStyle,
    opacity: minimized ? 0 : 1,
    transform: minimized ? 'scale(0.95)' : undefined,
    pointerEvents: minimized ? 'none' as const : undefined,
    visibility: minimized ? 'hidden' as const : 'visible' as const,
    transitionProperty: 'opacity, transform, visibility',
    transitionDuration: '160ms',
    transitionTimingFunction: 'ease-out',
    // Delay visibility so opacity transition can run before vanishing.
    transitionDelay: minimized ? '0ms, 0ms, 160ms' : '0ms',
  }

  return (
    <div
      onPointerDown={() => onFocus?.()}
      className="bg-[#D4D0C8] flex flex-col font-mono text-xs select-none border border-white border-r-[#808080] border-b-[#808080] shadow-2xl"
      style={style}
    >
      {/* Resize handles (only when not maximized) */}
      {!maximized && <>
        <div onPointerDown={handlePointerDown('n')}  className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-10" />
        <div onPointerDown={handlePointerDown('s')}  className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-10" />
        <div onPointerDown={handlePointerDown('e')}  className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-10" />
        <div onPointerDown={handlePointerDown('w')}  className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-10" />
        <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-10" />
        <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-10" />
        <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-10" />
        <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-10" />
      </>}

      {/* Title bar */}
      <div
        onPointerDown={handlePointerDown('move')}
        onDoubleClick={toggleMaximize}
        className={`flex items-center justify-between text-white px-2 h-7 shrink-0 cursor-default transition-colors duration-150 ${focused ? 'bg-[#316AC5]' : 'bg-[#808080]'}`}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">{icon}</div>
          <span className="text-sm font-bold font-mono tracking-tight">{title}</span>
          {subtitle && <span className="text-[10px] font-normal opacity-90 ml-1">{subtitle}</span>}
        </div>
        <div className="flex gap-1">
          {onMinimize && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onMinimize}
              className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E0DBD0]"
              title="Minimize"
            >─</button>
          )}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={toggleMaximize}
            className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E0DBD0]"
            title={maximized ? 'Restore' : 'Maximize'}
          >{maximized ? '❐' : '□'}</button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={onClose}
            className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E5A0A0]"
            title="Close"
          >✕</button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto bg-[#D4D0C8] p-2">
        {children}
      </div>
    </div>
  )
}
