'use client'

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react'

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
// Mode persistence — module-level singleton store.
//
// The previous implementation kept admin/maintainer flags in a per-component
// `useState`, so each consumer of `useEasterEggModes()` (page.tsx title bar,
// ScannerWindow, etc.) had its own copy. Toggling in one component didn't
// notify the others, and they each hydrated independently from localStorage
// at mount — so a window that mounted while admin=true could keep showing it
// long after another window toggled admin=false.
//
// The store below lives at module scope. Consumers subscribe via
// `useSyncExternalStore`, so any toggle propagates to every mounted window
// in the same render tick. Only one localStorage read (at module load) and
// one write per toggle.
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'pharmnet-modes'

interface ModeState {
  administrator: boolean
  maintainer: boolean
}

let adminState = false
let maintainerState = false
const listeners = new Set<() => void>()

// Eager hydration on first import on the client. Server-side imports are a
// no-op (typeof window check), and `getServerSnapshot` returns false to keep
// SSR + first-paint hydration consistent — the real value swaps in after
// `useSyncExternalStore` mounts and starts using `getSnapshot`.
if (typeof window !== 'undefined') {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<ModeState>
    adminState = !!stored.administrator
    maintainerState = !!stored.maintainer
  } catch {
    // localStorage unavailable / parse failed — leave defaults.
  }
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ administrator: adminState, maintainer: maintainerState }),
    )
  } catch {
    // localStorage unavailable — drop silently.
  }
}

function notify() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getAdminSnapshot() {
  return adminState
}

function getMaintainerSnapshot() {
  return maintainerState
}

function getServerSnapshot() {
  return false
}

const toggleAdmin = () => {
  adminState = !adminState
  persist()
  notify()
}

const toggleMaintainer = () => {
  maintainerState = !maintainerState
  persist()
  notify()
}

const deactivateAdmin = () => {
  if (!adminState) return
  adminState = false
  persist()
  notify()
}

const deactivateMaintainer = () => {
  if (!maintainerState) return
  maintainerState = false
  persist()
  notify()
}

export function useEasterEggModes() {
  const isAdminMode = useSyncExternalStore(
    subscribe,
    getAdminSnapshot,
    getServerSnapshot,
  )
  const isMaintainerMode = useSyncExternalStore(
    subscribe,
    getMaintainerSnapshot,
    getServerSnapshot,
  )

  return {
    isAdminMode,
    isMaintainerMode,
    toggleAdmin,
    toggleMaintainer,
    deactivateAdmin,
    deactivateMaintainer,
  }
}
