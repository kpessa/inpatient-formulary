'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ProductBuild, BuildDomainProgress } from '@/lib/types'
import { getDomainColor, getDomainBadge } from '@/lib/formulary-diff'

interface DomainInfo {
  domain: string   // e.g. "west_prod"
  region: string   // e.g. "west"
  env: string      // e.g. "prod"
}

interface Props {
  availableDomains: DomainInfo[]
  onClose: () => void
}

const BUILD_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  in_progress: { bg: '#316AC5', text: '#FFFFFF' },
  review:      { bg: '#E8C44C', text: '#5A3C00' },
  complete:    { bg: '#2E7D32', text: '#FFFFFF' },
}

// Derive domain info from a domain string like "west_prod"
function parseDomain(domain: string): { region: string; env: string } {
  const idx = domain.lastIndexOf('_')
  return { region: domain.slice(0, idx), env: domain.slice(idx + 1) }
}

export function BuildChecklist({ availableDomains, onClose }: Props) {
  const [builds, setBuilds] = useState<ProductBuild[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null) // "{buildId}:{domain}"

  // New build form
  const [drugDescription, setDrugDescription] = useState('')
  const [drugKey, setDrugKey] = useState('')
  const [buildNotes, setBuildNotes] = useState('')
  const [selectedEnvs, setSelectedEnvs] = useState<string[]>(() => {
    const envs = [...new Set(availableDomains.map(d => d.env))]
    return envs.includes('prod') ? ['prod'] : envs.slice(0, 1)
  })
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Per-domain note drafts: key = "{buildId}:{domain}"
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  const fetchBuilds = useCallback(() => {
    setLoading(true)
    fetch('/api/builds')
      .then(r => r.json())
      .then((d: { builds: ProductBuild[] }) => setBuilds(d.builds))
      .catch(() => setBuilds([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchBuilds() }, [fetchBuilds])

  const createBuild = async () => {
    if (!drugDescription.trim()) return
    setCreating(true)
    try {
      const domains = availableDomains
        .filter(d => selectedEnvs.includes(d.env))
        .map(d => d.domain)
      const res = await fetch('/api/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drugDescription: drugDescription.trim(),
          drugKey: drugKey.trim() || undefined,
          domains,
          notes: buildNotes.trim() || undefined,
        }),
      })
      const { build } = await res.json() as { build: ProductBuild }
      setBuilds(prev => [build, ...prev])
      setExpanded(build.id)
      setDrugDescription('')
      setDrugKey('')
      setBuildNotes('')
      setShowForm(false)
    } finally {
      setCreating(false)
    }
  }

  const setDomainStatus = async (
    build: ProductBuild,
    progress: BuildDomainProgress,
    newStatus: 'pending' | 'in_progress' | 'done',
  ) => {
    const now = newStatus === 'done' ? new Date().toISOString() : undefined
    await fetch(`/api/builds/${build.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: progress.domain,
        status: newStatus,
        completedAt: now,
        completedBy: newStatus === 'done' ? 'analyst' : undefined,
      }),
    })
    fetchBuilds()
  }

  const saveDomainNote = async (buildId: string, domain: string, note: string) => {
    await fetch(`/api/builds/${buildId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, notes: note }),
    })
    fetchBuilds()
  }

  const updateBuildStatus = async (build: ProductBuild, status: string) => {
    await fetch(`/api/builds/${build.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchBuilds()
  }

  const inputClass = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]'
  const labelClass = 'text-[10px] font-mono text-[#404040] mb-0.5'

  const envGroups = [...new Set(availableDomains.map(d => d.env))]
    .sort((a, b) => (a === 'prod' ? -1 : b === 'prod' ? 1 : a.localeCompare(b)))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none border-2 border-[#808080] bg-[#D4D0C8] p-0 font-mono shadow-[4px_4px_0_#000] max-w-xl w-full">
        <div className="bg-[#316AC5] text-white text-[11px] font-mono font-bold px-2 py-1 flex items-center justify-between">
          <span>Product Build Tracker</span>
          <button onClick={onClose} className="text-white hover:text-white/70 text-[10px]">✕</button>
        </div>
        <DialogHeader className="sr-only">
          <DialogTitle>Product Build Tracker</DialogTitle>
        </DialogHeader>

        <div className="p-3 space-y-2 max-h-[75vh] overflow-y-auto">

          {/* Header row */}
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-mono font-bold text-[#404040]">
              Active Builds ({builds.filter(b => b.status !== 'complete').length})
            </span>
            <button
              onClick={() => setShowForm(v => !v)}
              className="text-[9px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]"
            >
              {showForm ? '− Cancel' : '+ New Build'}
            </button>
          </div>

          {/* New build form */}
          {showForm && (
            <div className="border border-[#808080] bg-[#ECEAE4] p-2 space-y-2">
              <div>
                <div className={labelClass}>Drug description *</div>
                <input
                  className={inputClass}
                  placeholder="e.g. ACETAMINOPHEN TAB 500MG"
                  value={drugDescription}
                  onChange={e => setDrugDescription(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createBuild()}
                />
              </div>
              <div>
                <div className={labelClass}>Pyxis ID / Drug key (optional)</div>
                <input
                  className={inputClass}
                  placeholder="e.g. ACET500"
                  value={drugKey}
                  onChange={e => setDrugKey(e.target.value)}
                />
              </div>
              <div>
                <div className={labelClass}>Notes (optional)</div>
                <input
                  className={inputClass}
                  placeholder="e.g. New formulary addition Q1 2026"
                  value={buildNotes}
                  onChange={e => setBuildNotes(e.target.value)}
                />
              </div>

              {/* Environment selector */}
              {envGroups.length > 1 && (
                <div>
                  <div className={labelClass}>Include environments</div>
                  <div className="flex gap-2">
                    {envGroups.map(env => (
                      <label key={env} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEnvs.includes(env)}
                          onChange={e => setSelectedEnvs(prev =>
                            e.target.checked ? [...prev, env] : prev.filter(x => x !== env)
                          )}
                          className="w-3 h-3"
                        />
                        <span className="text-[10px] font-mono">{env}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={createBuild}
                  disabled={creating || !drugDescription.trim() || selectedEnvs.length === 0}
                  className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create Build'}
                </button>
              </div>
            </div>
          )}

          {/* Build list */}
          {loading ? (
            <div className="text-[10px] font-mono text-[#808080] py-2">Loading…</div>
          ) : builds.length === 0 ? (
            <div className="text-[10px] font-mono text-[#808080] italic py-2">
              No builds yet. Click &quot;+ New Build&quot; to start.
            </div>
          ) : (
            <div className="space-y-1">
              {builds.map(build => {
                const progress = build.domainProgress ?? []
                const done = progress.filter(p => p.status === 'done').length
                const total = progress.length
                const allDone = total > 0 && done === total
                const bsc = BUILD_STATUS_COLORS[build.status] ?? BUILD_STATUS_COLORS.in_progress
                const isExpanded = expanded === build.id

                // Group progress by env
                const progressByEnv: Record<string, BuildDomainProgress[]> = {}
                for (const p of progress) {
                  const { env } = parseDomain(p.domain)
                  if (!progressByEnv[env]) progressByEnv[env] = []
                  progressByEnv[env].push(p)
                }

                return (
                  <div key={build.id} className="border border-[#808080] bg-white">
                    {/* Build header row */}
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-[#F0EEE8]"
                      onClick={() => setExpanded(isExpanded ? null : build.id)}
                    >
                      <span className="text-[9px] font-mono text-[#808080]">
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <span
                        className="text-[8px] font-mono font-bold px-1 whitespace-nowrap"
                        style={{ background: bsc.bg, color: bsc.text }}
                      >
                        {build.status.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] font-mono text-black flex-1 truncate font-bold">
                        {build.drugDescription}
                      </span>
                      {/* Progress fraction */}
                      <span className={`text-[9px] font-mono shrink-0 font-bold ${allDone && build.status !== 'complete' ? 'text-[#2E7D32]' : 'text-[#808080]'}`}>
                        {done}/{total}
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-[#E0DDD6]">
                        {/* Build notes (if any) */}
                        {build.notes && (
                          <div className="px-3 py-1 text-[9px] font-mono text-[#606060] bg-[#F8F6F0] border-b border-[#E0DDD6] italic">
                            {build.notes}
                          </div>
                        )}

                        {/* All-done banner */}
                        {allDone && build.status === 'in_progress' && (
                          <div className="px-3 py-1.5 bg-[#E8F5E9] border-b border-[#C8E6C9] flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-[#2E7D32] font-bold">
                              ✓ All domains complete
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => updateBuildStatus(build, 'review')}
                                className="text-[9px] font-mono px-1.5 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]"
                              >
                                Send for Review
                              </button>
                              <button
                                onClick={() => updateBuildStatus(build, 'complete')}
                                className="text-[9px] font-mono px-1.5 py-0 border border-[#2E7D32] bg-[#E8F5E9] text-[#2E7D32] hover:bg-[#C8E6C9] font-bold"
                              >
                                Mark Complete
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Domain rows grouped by env */}
                        <div className="px-2 py-1.5 space-y-3">
                          {envGroups.filter(env => progressByEnv[env]).map(env => (
                            <div key={env}>
                              {/* Env label */}
                              <div className="text-[9px] font-mono text-[#808080] uppercase tracking-wider mb-1 pl-0.5">
                                {env}
                              </div>
                              <div className="space-y-1">
                                {progressByEnv[env].map(p => {
                                  const { region } = parseDomain(p.domain)
                                  const { bg, text } = getDomainColor(region, env)
                                  const badge = getDomainBadge(region, env)
                                  const domainKey = `${build.id}:${p.domain}`
                                  const isExpandedDomain = expandedDomain === domainKey
                                  const isDone = p.status === 'done'
                                  const isInProgress = p.status === 'in_progress'

                                  return (
                                    <div key={p.domain} className="border border-[#E0DDD6]">
                                      <div className="flex items-center gap-2 px-2 py-1">
                                        {/* Domain badge */}
                                        <span
                                          className="text-[9px] font-mono font-bold w-5 h-5 flex items-center justify-center shrink-0"
                                          style={{ background: bg, color: text }}
                                        >
                                          {badge}
                                        </span>

                                        {/* Domain name */}
                                        <span className={`text-[10px] font-mono flex-1 ${isDone ? 'line-through text-[#808080]' : 'text-black'}`}>
                                          {p.domain}
                                        </span>

                                        {/* Completion info */}
                                        {isDone && p.completedAt && (
                                          <span className="text-[8px] font-mono text-[#808080] shrink-0">
                                            {new Date(p.completedAt).toLocaleDateString()}
                                            {p.completedBy ? ` · ${p.completedBy}` : ''}
                                          </span>
                                        )}

                                        {/* Status cycle buttons */}
                                        <div className="flex gap-0.5 shrink-0">
                                          {!isDone && (
                                            <button
                                              onClick={() => setDomainStatus(build, p, isInProgress ? 'done' : 'in_progress')}
                                              title={isInProgress ? 'Mark done' : 'Start'}
                                              className={`text-[9px] font-mono px-1.5 py-0 border border-[#808080] ${isInProgress ? 'bg-[#E8F5E9] text-[#2E7D32] hover:bg-[#C8E6C9]' : 'bg-[#D4D0C8] hover:bg-[#C8C4BC]'}`}
                                            >
                                              {isInProgress ? '✓ Done' : '▶ Start'}
                                            </button>
                                          )}
                                          {isDone && (
                                            <button
                                              onClick={() => setDomainStatus(build, p, 'pending')}
                                              title="Undo"
                                              className="text-[9px] font-mono px-1.5 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] text-[#808080]"
                                            >
                                              ↩
                                            </button>
                                          )}
                                          {/* Expand for notes */}
                                          <button
                                            onClick={() => setExpandedDomain(isExpandedDomain ? null : domainKey)}
                                            title="Notes"
                                            className={`text-[9px] font-mono px-1 py-0 border border-[#808080] ${isExpandedDomain ? 'bg-[#316AC5] text-white' : 'bg-[#D4D0C8] hover:bg-[#C8C4BC] text-[#808080]'}`}
                                          >
                                            ✎
                                          </button>
                                        </div>
                                      </div>

                                      {/* Notes row */}
                                      {isExpandedDomain && (
                                        <div className="border-t border-[#E0DDD6] px-2 py-1.5 bg-[#F8F6F0] flex items-start gap-2">
                                          <input
                                            className="flex-1 text-[10px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]"
                                            placeholder="Domain notes (e.g. cert skipped — not needed)"
                                            defaultValue={p.notes ?? ''}
                                            onChange={e => setNoteDrafts(d => ({ ...d, [domainKey]: e.target.value }))}
                                          />
                                          <button
                                            onClick={() => saveDomainNote(build.id, p.domain, noteDrafts[domainKey] ?? p.notes ?? '')}
                                            className="text-[9px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] shrink-0"
                                          >
                                            Save
                                          </button>
                                        </div>
                                      )}

                                      {/* Show saved notes when not editing */}
                                      {!isExpandedDomain && p.notes && (
                                        <div className="px-2 pb-1 text-[9px] font-mono text-[#606060] italic">
                                          {p.notes}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Build-level actions (non-complete builds) */}
                        {build.status !== 'complete' && !allDone && (
                          <div className="flex gap-1 px-2 pb-2 border-t border-[#E0DDD6] pt-1.5">
                            {build.status !== 'review' && (
                              <button
                                onClick={() => updateBuildStatus(build, 'review')}
                                className="text-[9px] font-mono px-1.5 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]"
                              >
                                Send for Review
                              </button>
                            )}
                            {build.status === 'review' && (
                              <button
                                onClick={() => updateBuildStatus(build, 'complete')}
                                className="text-[9px] font-mono px-1.5 py-0 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]"
                              >
                                Mark Complete
                              </button>
                            )}
                          </div>
                        )}

                        {/* Completed builds */}
                        {build.status === 'complete' && (
                          <div className="flex justify-end px-2 pb-1.5">
                            <button
                              onClick={() => updateBuildStatus(build, 'in_progress')}
                              className="text-[8px] font-mono px-1.5 py-0 border border-[#808080] bg-[#D4D0C8] text-[#808080] hover:bg-[#C8C4BC]"
                            >
                              Reopen
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
