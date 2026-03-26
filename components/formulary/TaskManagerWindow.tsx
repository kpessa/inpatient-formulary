'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChangeTask, TaskDomainProgress } from '@/lib/types'
import { getDomainColor, getDomainBadge } from '@/lib/formulary-diff'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: '#E8C44C', text: '#5A3C00' },
  in_progress: { bg: '#316AC5', text: '#FFFFFF' },
  done:        { bg: '#2E7D32', text: '#FFFFFF' },
}

function parseDomain(domain: string): { region: string; env: string } {
  const idx = domain.lastIndexOf('_')
  return { region: domain.slice(0, idx), env: domain.slice(idx + 1) }
}

interface Props {
  open: boolean
  minimized?: boolean
  focused?: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  availableDomains: { region: string; env: string; domain: string }[]
  isAdminMode: boolean
}

type Rect = { x: number; y: number; w: number; h: number }
const MIN_W = 500
const MIN_H = 400

export function TaskManagerWindow({ open, minimized = false, focused = true, onClose, onMinimize, onFocus, availableDomains, isAdminMode }: Props) {
  // Window geometry
  const [rect, setRect] = useState<Rect | null>(null)
  const [maximized, setMaximized] = useState(false)
  const preMaxRect = useRef<Rect | null>(null)
  const isResizing = useRef<{ dir: string; startX: number; startY: number; startRect: Rect } | null>(null)

  useEffect(() => {
    if (rect) return
    setRect({
      x: Math.max(0, (window.innerWidth - 700) / 2),
      y: Math.max(0, (window.innerHeight - 550) / 2),
      w: 700,
      h: 550,
    })
  }, [rect])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      const { dir, startX, startY, startRect } = isResizing.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dir === 'move') { setRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy }); return }
      let { x, y, w, h } = startRect
      if (dir.includes('e')) w = Math.max(MIN_W, startRect.w + dx)
      if (dir.includes('w')) { const nw = Math.max(MIN_W, startRect.w - dx); x = startRect.x + (startRect.w - nw); w = nw }
      if (dir.includes('s')) h = Math.max(MIN_H, startRect.h + dy)
      if (dir.includes('n')) { const nh = Math.max(MIN_H, startRect.h - dy); y = startRect.y + (startRect.h - nh); h = nh }
      setRect({ x, y, w, h })
    }
    const onUp = () => { isResizing.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])

  const handlePointerDown = (dir: string) => (e: React.PointerEvent) => {
    if (!rect || maximized) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = { dir, startX: e.clientX, startY: e.clientY, startRect: rect }
  }

  const toggleMaximize = () => {
    if (maximized) { if (preMaxRect.current) setRect(preMaxRect.current); setMaximized(false) }
    else { preMaxRect.current = rect; setMaximized(true) }
  }

  // Data
  const [tasks, setTasks] = useState<ChangeTask[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<string>('active')

  const fetchTasks = useCallback(() => {
    setLoading(true)
    fetch('/api/tasks?withProgress=true')
      .then(r => r.json())
      .then((d: { tasks: ChangeTask[] }) => setTasks(d.tasks))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (open) fetchTasks() }, [open, fetchTasks])

  const filteredTasks = tasks.filter(t => {
    if (statusFilter === 'active') return t.status !== 'done'
    if (statusFilter === 'all') return true
    return t.status === statusFilter
  })

  // Group by drug
  const tasksByDrug: Record<string, ChangeTask[]> = {}
  for (const t of filteredTasks) {
    const key = t.drugDescription || t.drugKey
    if (!tasksByDrug[key]) tasksByDrug[key] = []
    tasksByDrug[key].push(t)
  }

  const envGroups = [...new Set(availableDomains.map(d => d.env))]
    .sort((a, b) => (a === 'prod' ? -1 : b === 'prod' ? 1 : a.localeCompare(b)))

  // Write override when marking a domain done for a diff task
  const writeOverride = async (task: ChangeTask, domain: string) => {
    if (task.type !== 'diff' || !task.fieldName || !task.targetValue || !task.groupId) return
    await fetch('/api/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        groupId: task.groupId,
        fieldPath: task.fieldName,
        overrideValue: JSON.stringify(task.targetValue),
        taskId: task.id,
        appliedBy: 'analyst',
      }),
    })
  }

  const setDomainStatus = async (task: ChangeTask, progress: TaskDomainProgress, newStatus: 'pending' | 'in_progress' | 'done') => {
    const now = newStatus === 'done' ? new Date().toISOString() : undefined
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domainProgress: {
          domain: progress.domain,
          status: newStatus,
          completedAt: now,
          completedBy: newStatus === 'done' ? 'analyst' : undefined,
        },
      }),
    })
    // Write override when marking done
    if (newStatus === 'done') await writeOverride(task, progress.domain)
    fetchTasks()
  }

  const completeAll = async (task: ChangeTask) => {
    const progress = task.domainProgress ?? []
    const incomplete = progress.filter(p => p.status !== 'done').map(p => p.domain)
    if (incomplete.length === 0) return
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bulkDomainProgress: { domains: incomplete, status: 'done', completedBy: 'analyst' },
      }),
    })
    // Write overrides for all newly-completed domains
    for (const domain of incomplete) await writeOverride(task, domain)
    fetchTasks()
  }

  const saveDomainNote = async (taskId: string, domain: string, note: string) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainProgress: { domain, notes: note } }),
    })
    fetchTasks()
  }

  const deleteTask = async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    fetchTasks()
  }

  // Compute unique regions from available domains for grid columns
  const regionOrder = [...new Set(availableDomains.map(d => d.region))]

  if (!open || !rect) return null

  const zIndex = focused ? 51 : 50
  const style = maximized
    ? { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 32, zIndex, display: minimized ? 'none' as const : undefined }
    : { position: 'fixed' as const, left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex, display: minimized ? 'none' as const : undefined }

  return (
    <div
      className="flex flex-col bg-[#D4D0C8] font-mono text-xs border border-white border-r-[#808080] border-b-[#808080] shadow-2xl select-none"
      style={style}
      onPointerDownCapture={onFocus}
    >
      {/* Resize handles */}
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
        className={`flex items-center justify-between text-white px-2 h-7 shrink-0 cursor-default transition-colors duration-150 ${focused ? 'bg-[#316AC5]' : 'bg-[#808080]'}`}
        onPointerDown={handlePointerDown('move')}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">📋</div>
          <span className="text-sm font-bold font-mono tracking-tight">Task Manager</span>
        </div>
        <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
          <button onPointerDown={e => { e.stopPropagation(); onMinimize?.() }} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
          <button onClick={toggleMaximize} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none" title={maximized ? 'Restore' : 'Maximize'}>{maximized ? '❐' : '□'}</button>
          <button onClick={onClose} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">✕</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[#808080] shrink-0">
        <span className="text-[10px] font-mono text-[#404040]">Show:</span>
        <select
          className="text-[10px] font-mono rounded-none border border-[#808080] px-1 py-0 bg-white h-5"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="active">Active (Pending + In Progress)</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="all">All</option>
        </select>
        <div className="flex-1" />
        <span className="text-[9px] font-mono text-[#808080]">
          {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {loading ? (
          <div className="text-[10px] font-mono text-[#808080] py-4 text-center">Loading tasks…</div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-[10px] font-mono text-[#808080] italic py-4 text-center">
            No tasks found.
          </div>
        ) : (
          Object.entries(tasksByDrug).map(([drugLabel, drugTasks]) => (
            <div key={drugLabel} className="border border-[#808080] bg-white">
              {/* Drug group header */}
              <div className="px-2 py-1 bg-[#ECEAE4] border-b border-[#C8C4BC]">
                <span className="text-[10px] font-mono font-bold text-[#404040]">
                  {drugLabel}
                </span>
                <span className="text-[9px] font-mono text-[#808080] ml-2">
                  ({drugTasks.length} task{drugTasks.length !== 1 ? 's' : ''})
                </span>
              </div>

              {/* Tasks in this drug group */}
              <div className="divide-y divide-[#E0DDD6]">
                {drugTasks.map(task => {
                  const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.pending
                  const isExpanded = expanded === task.id
                  const progress = task.domainProgress ?? []
                  const done = progress.filter(p => p.status === 'done').length
                  const total = progress.length

                  // Group progress by env
                  const progressByEnv: Record<string, TaskDomainProgress[]> = {}
                  for (const p of progress) {
                    const { env } = parseDomain(p.domain)
                    if (!progressByEnv[env]) progressByEnv[env] = []
                    progressByEnv[env].push(p)
                  }

                  return (
                    <div key={task.id}>
                      {/* Task row */}
                      <div
                        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-[#F0EEE8] ${isExpanded ? 'bg-[#F0EEE8]' : ''}`}
                        onClick={() => setExpanded(isExpanded ? null : task.id)}
                      >
                        <span className="text-[9px] font-mono text-[#808080] shrink-0">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <span
                          className="text-[8px] font-mono font-bold px-1 whitespace-nowrap shrink-0"
                          style={{ background: sc.bg, color: sc.text }}
                        >
                          {task.status.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] font-mono text-black flex-1 truncate">
                          {task.fieldLabel ?? task.fieldName ?? task.type}
                          {task.targetValue && (
                            <span className="text-[#316AC5] ml-1">→ {task.targetValue}</span>
                          )}
                        </span>
                        {task.assignedTo && (
                          <span className="text-[8px] font-mono text-[#808080] shrink-0">@{task.assignedTo}</span>
                        )}
                        {total > 0 && (
                          <span className={`text-[9px] font-mono shrink-0 font-bold ${done === total ? 'text-[#2E7D32]' : 'text-[#808080]'}`}>
                            {done}/{total}
                          </span>
                        )}
                        {isAdminMode && (
                          <button
                            onClick={e => { e.stopPropagation(); deleteTask(task.id) }}
                            title="Delete task"
                            className="text-[9px] font-mono px-1 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] text-[#CC0000] shrink-0"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Expanded: domain progress grid */}
                      {isExpanded && (
                        <div className="border-t border-[#E0DDD6]">
                          {/* Task meta */}
                          {task.notes && (
                            <div className="px-3 py-1 text-[9px] font-mono text-[#606060] bg-[#F8F6F0] border-b border-[#E0DDD6] italic">
                              {task.notes}
                            </div>
                          )}

                          {total === 0 ? (
                            <div className="px-3 py-2 text-[9px] font-mono text-[#808080] italic">
                              No domain progress tracking for this task.
                            </div>
                          ) : (() => {
                            const incomplete = progress.filter(p => p.status !== 'done')
                            // Build a lookup: "region_env" → progress
                            const progressMap: Record<string, TaskDomainProgress> = {}
                            for (const p of progress) progressMap[p.domain] = p
                            // Show ALL regions/envs — N/A for domains without progress rows
                            const taskRegions = regionOrder
                            const taskEnvs = envGroups

                            return (
                              <div className="px-2 py-1.5 space-y-1.5">
                                {/* Complete All button */}
                                {incomplete.length > 0 && (
                                  <div className="flex justify-end">
                                    <button
                                      onClick={() => completeAll(task)}
                                      className="text-[9px] font-mono px-2 py-0.5 border border-[#2E7D32] bg-[#E8F5E9] text-[#2E7D32] hover:bg-[#C8E6C9] font-bold"
                                    >
                                      ✓ Complete All ({incomplete.length})
                                    </button>
                                  </div>
                                )}

                                {/* Grid: env rows × region columns */}
                                <div className="border border-[#808080] bg-white">
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr className="bg-[#ECEAE4]">
                                        <th className="text-[8px] font-mono text-[#808080] px-2 py-1 text-left border-b border-r border-[#C8C4BC] w-12"></th>
                                        {taskRegions.map(region => {
                                          const { bg, text } = getDomainColor(region, 'prod')
                                          return (
                                            <th key={region} className="text-[9px] font-mono font-bold px-2 py-1 text-center border-b border-r border-[#C8C4BC] last:border-r-0">
                                              <span className="inline-block px-1" style={{ background: bg, color: text }}>
                                                {region.charAt(0).toUpperCase() + region.slice(1)}
                                              </span>
                                            </th>
                                          )
                                        })}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {taskEnvs.map(env => (
                                        <tr key={env} className="border-b border-[#E0DDD6] last:border-b-0">
                                          <td className="text-[8px] font-mono text-[#808080] uppercase px-2 py-1 border-r border-[#C8C4BC] font-bold">{env}</td>
                                          {taskRegions.map(region => {
                                            const domain = `${region}_${env}`
                                            const p = progressMap[domain]
                                            if (!p) {
                                              return <td key={domain} className="text-center text-[8px] text-[#B8B4AC] border-r border-[#E0DDD6] last:border-r-0 py-1 italic bg-[#F0EDE6]" title="Drug does not exist in this domain">N/A</td>
                                            }
                                            const isDone = p.status === 'done'
                                            const isInProgress = p.status === 'in_progress'
                                            return (
                                              <td key={domain} className="text-center border-r border-[#E0DDD6] last:border-r-0 py-0.5 px-1">
                                                {isDone ? (
                                                  <button
                                                    onClick={() => setDomainStatus(task, p, 'pending')}
                                                    title={`Done${p.completedAt ? ` · ${new Date(p.completedAt).toLocaleDateString()}` : ''} — click to undo`}
                                                    className="text-[9px] font-mono px-1.5 py-0 border border-[#2E7D32] bg-[#E8F5E9] text-[#2E7D32] hover:bg-[#C8E6C9] font-bold w-full"
                                                  >
                                                    ✓
                                                  </button>
                                                ) : (
                                                  <button
                                                    onClick={() => setDomainStatus(task, p, isInProgress ? 'done' : 'in_progress')}
                                                    title={isInProgress ? 'Mark done' : 'Start'}
                                                    className={`text-[9px] font-mono px-1.5 py-0 border border-[#808080] w-full ${isInProgress ? 'bg-[#316AC5] text-white hover:bg-[#2558A5]' : 'bg-[#D4D0C8] hover:bg-[#C8C4BC] text-[#808080]'}`}
                                                  >
                                                    {isInProgress ? '▶' : '·'}
                                                  </button>
                                                )}
                                              </td>
                                            )
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                {/* All-done banner */}
                                {done === total && (
                                  <div className="text-[9px] font-mono text-[#2E7D32] font-bold text-center py-0.5">
                                    ✓ All domains complete
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center h-5 bg-[#D4D0C8] border-t border-[#808080] px-2 shrink-0">
        <span className="text-[9px] font-mono text-[#808080]">
          {tasks.filter(t => t.status !== 'done').length} active · {tasks.filter(t => t.status === 'done').length} done
        </span>
      </div>
    </div>
  )
}
