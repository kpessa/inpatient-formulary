'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ChangeTask } from '@/lib/types'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: '#E8C44C', text: '#5A3C00' },
  in_progress: { bg: '#316AC5', text: '#FFFFFF' },
  done:        { bg: '#2E7D32', text: '#FFFFFF' },
}

interface Props {
  drugKey: string
  drugDescription: string
  groupId: string
  isAdminMode?: boolean
  onTaskCountChange?: (pending: number) => void
  onCreateTask?: () => void
  onOverrideApplied?: () => void
}

export function TaskPanel({
  drugKey,
  drugDescription,
  groupId,
  isAdminMode,
  onTaskCountChange,
  onCreateTask,
  onOverrideApplied,
}: Props) {
  const [tasks, setTasks] = useState<ChangeTask[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)

  const fetchTasks = useCallback(() => {
    if (!drugKey) return
    setLoading(true)
    fetch(`/api/tasks?drugKey=${encodeURIComponent(drugKey)}`)
      .then(r => r.json())
      .then((d: { tasks: ChangeTask[] }) => {
        setTasks(d.tasks)
        const pending = d.tasks.filter(t => t.status !== 'done').length
        onTaskCountChange?.(pending)
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false))
  }, [drugKey, onTaskCountChange])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const markDone = async (task: ChangeTask) => {
    setApplying(task.id)
    try {
      const now = new Date().toISOString()
      // Mark the task as done
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', completedAt: now, completedBy: task.assignedTo ?? 'analyst' }),
      })

      // If a diff task with target value + target domain, write the override
      if (task.fieldName && task.targetValue) {
        const domains = task.targetDomain
          ? [task.targetDomain]
          : [] // empty = caller re-fetches all; override applied per-domain on completion

        // Apply override for each target domain (or all prod domains if unspecified)
        // For now apply to the first domain that we can infer from drugKey context
        // The panel's parent re-fetches after override is applied
        if (task.targetDomain) {
          await fetch('/api/overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: task.targetDomain,
              groupId,
              fieldPath: task.fieldName,
              overrideValue: JSON.stringify(task.targetValue),
              taskId: task.id,
              appliedBy: task.assignedTo ?? 'analyst',
            }),
          })
          onOverrideApplied?.()
        }
        void domains // suppress unused warning
      }

      fetchTasks()
    } finally {
      setApplying(null)
    }
  }

  const deleteTask = async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    fetchTasks()
  }

  if (loading) {
    return (
      <div className="px-3 py-1.5 text-[10px] font-mono text-[#808080] border-b border-[#808080]">
        Loading tasks…
      </div>
    )
  }

  return (
    <div className="border-b border-[#808080] bg-[#ECEAE4] shrink-0">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#C8C4BC]">
        <span className="text-[10px] font-mono font-bold text-[#404040]">
          Tasks for {drugDescription || drugKey}
        </span>
        {isAdminMode && (
          <button
            onClick={onCreateTask}
            className="text-[9px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]"
          >
            + Add Task
          </button>
        )}
      </div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="px-3 py-2 text-[10px] font-mono text-[#808080] italic">
          No tasks for this drug.
        </div>
      ) : (
        <div className="divide-y divide-[#C8C4BC] max-h-36 overflow-y-auto">
          {tasks.map(task => {
            const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.pending
            return (
              <div key={task.id} className="flex items-start gap-2 px-3 py-1.5">
                {/* Status chip */}
                <span
                  className="text-[8px] font-mono font-bold px-1 py-0 whitespace-nowrap shrink-0 mt-0.5"
                  style={{ background: sc.bg, color: sc.text }}
                >
                  {task.status.replace('_', ' ')}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-black leading-tight">
                    {task.fieldLabel ?? task.fieldName ?? task.drugDescription}
                    {task.targetDomain && (
                      <span className="text-[#808080] ml-1">→ {task.targetDomain}</span>
                    )}
                  </div>
                  {task.targetValue && (
                    <div className="text-[9px] font-mono text-[#316AC5]">
                      Target: {task.targetValue}
                    </div>
                  )}
                  {task.assignedTo && (
                    <div className="text-[9px] font-mono text-[#808080]">@{task.assignedTo}</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-1 shrink-0">
                  {task.status !== 'done' && (
                    <button
                      onClick={() => markDone(task)}
                      disabled={applying === task.id}
                      title="Mark done"
                      className="text-[9px] font-mono px-1 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] disabled:opacity-50"
                    >
                      {applying === task.id ? '…' : '✓'}
                    </button>
                  )}
                  {isAdminMode && (
                    <button
                      onClick={() => deleteTask(task.id)}
                      title="Delete"
                      className="text-[9px] font-mono px-1 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] text-[#CC0000]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
