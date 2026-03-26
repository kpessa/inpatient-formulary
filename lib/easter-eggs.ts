'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Multi-click detection hook
// ---------------------------------------------------------------------------
export function useMultiClick(threshold: number, windowMs: number) {
  const clickTimestamps = useRef<number[]>([])
  const [triggered, setTriggered] = useState(false)

  const handleClick = useCallback(() => {
    const now = Date.now()
    clickTimestamps.current = [
      ...clickTimestamps.current.filter(t => now - t < windowMs),
      now,
    ]
    if (clickTimestamps.current.length >= threshold) {
      clickTimestamps.current = []
      setTriggered(true)
    }
  }, [threshold, windowMs])

  // Reset triggered after one render cycle
  useEffect(() => {
    if (triggered) setTriggered(false)
  }, [triggered])

  return { handleClick, triggered }
}

// ---------------------------------------------------------------------------
// Mode persistence
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'pharmnet-modes'

interface ModeState {
  administrator: boolean
  maintainer: boolean
}

export function useEasterEggModes() {
  const [isAdminMode, setIsAdminMode] = useState(false)
  const [isMaintainerMode, setIsMaintainerMode] = useState(false)

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ModeState>
      if (stored.administrator) setIsAdminMode(true)
      if (stored.maintainer) setIsMaintainerMode(true)
    } catch {}
  }, [])

  const persist = useCallback((admin: boolean, maintainer: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ administrator: admin, maintainer }))
    } catch {}
  }, [])

  const toggleAdmin = useCallback(() => {
    setIsAdminMode(prev => {
      const next = !prev
      setIsMaintainerMode(m => { persist(next, m); return m })
      return next
    })
  }, [persist])

  const toggleMaintainer = useCallback(() => {
    setIsMaintainerMode(prev => {
      const next = !prev
      setIsAdminMode(a => { persist(a, next); return a })
      return next
    })
  }, [persist])

  const deactivateAdmin = useCallback(() => {
    setIsAdminMode(false)
    setIsMaintainerMode(m => { persist(false, m); return m })
  }, [persist])

  const deactivateMaintainer = useCallback(() => {
    setIsMaintainerMode(false)
    setIsAdminMode(a => { persist(a, false); return a })
  }, [persist])

  return {
    isAdminMode,
    isMaintainerMode,
    toggleAdmin,
    toggleMaintainer,
    deactivateAdmin,
    deactivateMaintainer,
  }
}
