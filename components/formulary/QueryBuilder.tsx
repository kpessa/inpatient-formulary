"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ClauseToken = {
  id: string
  type: 'clause'
  field: string | null
  fieldLabel: string
  value: string
  negated: boolean
}
export type OpToken     = { id: string; type: 'op'; op: 'AND' | 'OR' }
export type LParenToken = { id: string; type: 'lparen' }
export type RParenToken = { id: string; type: 'rparen' }
export type QueryToken  = ClauseToken | OpToken | LParenToken | RParenToken
export type QueryState  = { tokens: QueryToken[]; isAdvanced: boolean; parensValid: boolean }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mkId(): string { return Math.random().toString(36).slice(2, 10) }

export function validateParens(tokens: QueryToken[]): boolean {
  let depth = 0
  for (const t of tokens) {
    if (t.type === 'lparen') depth++
    else if (t.type === 'rparen') { depth--; if (depth < 0) return false }
  }
  return depth === 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

export function parseQueryToState(
  raw: string,
  fieldAliases: Record<string, string>,
  catalogFields: { key: string; label: string }[]
): QueryState {
  const tokens: QueryToken[] = []
  const input = raw.trim()
  if (!input) return { tokens: [], isAdvanced: false, parensValid: true }

  let i = 0

  function skipWs() { while (i < input.length && /\s/.test(input[i])) i++ }

  function labelFor(key: string): string {
    return catalogFields.find(f => f.key === key)?.label ?? key
  }
  function resolveAlias(alias: string): string | null {
    return fieldAliases[alias.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null
  }

  function ensureOp(op: 'OR' | 'AND' = 'OR') {
    const last = tokens[tokens.length - 1]
    if (last && (last.type === 'clause' || last.type === 'rparen')) {
      tokens.push({ id: mkId(), type: 'op', op })
    }
  }

  function pushClause(field: string | null, value: string, negated = false) {
    ensureOp()
    tokens.push({
      id: mkId(), type: 'clause',
      field, fieldLabel: field ? labelFor(field) : 'All fields',
      value, negated,
    })
  }

  while (i < input.length) {
    skipWs()
    if (i >= input.length) break
    const rest = input.slice(i)

    // NOT keyword
    if (/^NOT\b/i.test(rest)) {
      i += 3; skipWs()
      const r2 = input.slice(i)
      // angle bracket
      const am = r2.match(/^<(\w+):\s*([^>]*)>/)
      if (am) { i += am[0].length; ensureOp(); tokens.push({ id: mkId(), type: 'clause', field: resolveAlias(am[1]), fieldLabel: resolveAlias(am[1]) ? labelFor(resolveAlias(am[1])!) : 'All fields', value: am[2].trim(), negated: true }); continue }
      // field:value
      const fm = r2.match(/^(\w+):"([^"]*)"/) ?? r2.match(/^(\w+):(\S+)/)
      if (fm) { i += fm[0].length; const f = resolveAlias(fm[1]); ensureOp(); tokens.push({ id: mkId(), type: 'clause', field: f, fieldLabel: f ? labelFor(f) : 'All fields', value: fm[2], negated: true }); continue }
      // plain text
      const pm = r2.match(/^[^\s<>()+|]+/)
      if (pm) { i += pm[0].length; ensureOp(); tokens.push({ id: mkId(), type: 'clause', field: null, fieldLabel: 'All fields', value: pm[0], negated: true }); continue }
      continue
    }

    // AND
    if (/^AND\b/i.test(rest)) {
      i += 3
      const last = tokens[tokens.length - 1]
      if (last?.type === 'op') (tokens[tokens.length - 1] as OpToken).op = 'AND'
      else tokens.push({ id: mkId(), type: 'op', op: 'AND' })
      continue
    }

    // OR
    if (/^OR\b/i.test(rest)) {
      i += 2
      const last = tokens[tokens.length - 1]
      if (last?.type === 'op') (tokens[tokens.length - 1] as OpToken).op = 'OR'
      else tokens.push({ id: mkId(), type: 'op', op: 'OR' })
      continue
    }

    // Left paren
    if (rest[0] === '(') { ensureOp(); tokens.push({ id: mkId(), type: 'lparen' }); i++; continue }
    // Right paren
    if (rest[0] === ')') { tokens.push({ id: mkId(), type: 'rparen' }); i++; continue }

    // Angle-bracket clause
    const am = rest.match(/^<(\w+):\s*([^>]*)>/)
    if (am) { i += am[0].length; pushClause(resolveAlias(am[1]), am[2].trim()); continue }

    // field:"value" or field:value
    const fm = rest.match(/^(\w+):"([^"]*)"/) ?? rest.match(/^(\w+):(\S+)/)
    if (fm) { i += fm[0].length; pushClause(resolveAlias(fm[1]), fm[2]); continue }

    // Plain text
    const pm = rest.match(/^[^\s<>(]+/)
    if (pm) { i += pm[0].length; pushClause(null, pm[0]); continue }

    i++ // skip unknown char
  }

  // Strip leading/trailing ops
  while (tokens.length && tokens[0].type === 'op') tokens.shift()
  while (tokens.length && tokens[tokens.length - 1].type === 'op') tokens.pop()

  const clauses = tokens.filter((t): t is ClauseToken => t.type === 'clause')
  const isAdvanced = clauses.length > 1 || clauses.some(c => c.field !== null || c.negated) ||
    tokens.some(t => t.type === 'op' && (t as OpToken).op === 'AND') ||
    tokens.some(t => t.type === 'lparen')

  return { tokens, isAdvanced, parensValid: validateParens(tokens) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

export function serializeQueryCompact(tokens: QueryToken[]): string {
  return tokens.map(t => {
    if (t.type === 'clause') {
      const c = t as ClauseToken
      const not = c.negated ? 'NOT ' : ''
      return c.field ? `${not}<${c.field}: ${c.value}>` : `${not}${c.value}`
    }
    if (t.type === 'op') return (t as OpToken).op
    if (t.type === 'lparen') return '('
    if (t.type === 'rparen') return ')'
    return ''
  }).join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation — recursive descent with AND/OR/NOT/groups
// ─────────────────────────────────────────────────────────────────────────────

type AnyResult = { groupId: string; region: string; environment: string }

export async function evaluateQueryState<T extends AnyResult>(
  state: QueryState,
  fetchClause: (field: string | null, value: string) => Promise<T[]>
): Promise<T[]> {
  const tokens = state.tokens
  const clauses = tokens.filter((t): t is ClauseToken => t.type === 'clause')
  if (clauses.length === 0) return []

  // Fire all fetches in parallel
  const resultMap = new Map<string, T[]>()
  await Promise.all(clauses.map(async c => { resultMap.set(c.id, await fetchClause(c.field, c.value)) }))

  function semKey(r: AnyResult) { return `${r.groupId}|${r.region}|${r.environment}` }
  function union(a: T[], b: T[]): T[] { const s = new Set(a.map(semKey)); return [...a, ...b.filter(r => !s.has(semKey(r)))] }
  function intersect(a: T[], b: T[]): T[] { const s = new Set(b.map(semKey)); return a.filter(r => s.has(semKey(r))) }
  function subtract(a: T[], b: T[]): T[] { const s = new Set(b.map(semKey)); return a.filter(r => !s.has(semKey(r))) }

  let pos = 0
  const peek = () => tokens[pos]
  const consume = () => tokens[pos++]

  function parseExpr(): T[] {
    let left = parseAnd()
    while (peek()?.type === 'op' && (peek() as OpToken).op === 'OR') {
      consume()
      left = union(left, parseAnd())
    }
    return left
  }

  function parseAnd(): T[] {
    let left = parseAtom()
    while (peek()?.type === 'op' && (peek() as OpToken).op === 'AND') {
      consume()
      const next = peek()
      // AND NOT → subtract
      if (next?.type === 'clause' && (next as ClauseToken).negated) {
        consume()
        left = subtract(left, resultMap.get((next as ClauseToken).id) ?? [])
      } else {
        left = intersect(left, parseAtom())
      }
    }
    return left
  }

  function parseAtom(): T[] {
    const t = peek()
    if (!t) return []
    if (t.type === 'lparen') {
      consume()
      const r = parseExpr()
      if (peek()?.type === 'rparen') consume()
      return r
    }
    if (t.type === 'clause') {
      consume()
      const c = t as ClauseToken
      return c.negated ? [] : (resultMap.get(c.id) ?? [])
    }
    consume()
    return []
  }

  return parseExpr()
}

// ─────────────────────────────────────────────────────────────────────────────
// QueryBuilder Component
// ─────────────────────────────────────────────────────────────────────────────

interface QueryBuilderProps {
  state: QueryState
  mode: 'compact' | 'visual'
  onTokensChange: (tokens: QueryToken[]) => void
  onEditClause: (clause: ClauseToken) => void
}

export function QueryBuilder({ state, mode, onTokensChange, onEditClause }: QueryBuilderProps) {
  const { tokens } = state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; clauseId: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null)

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu])

  function toggleOp(opId: string) {
    onTokensChange(tokens.map(t =>
      t.id === opId && t.type === 'op'
        ? { ...t, op: (t as OpToken).op === 'AND' ? 'OR' : 'AND' }
        : t
    ))
  }

  function toggleNot(clauseId: string) {
    onTokensChange(tokens.map(t =>
      t.id === clauseId && t.type === 'clause'
        ? { ...t, negated: !(t as ClauseToken).negated }
        : t
    ))
  }

  function deleteClause(clauseId: string) {
    const idx = tokens.findIndex(t => t.id === clauseId)
    if (idx === -1) return
    const newTokens = [...tokens]
    // Remove the clause and the adjacent op (prefer removing the one before, else after)
    if (idx > 0 && newTokens[idx - 1].type === 'op') {
      newTokens.splice(idx - 1, 2)
    } else if (idx < newTokens.length - 1 && newTokens[idx + 1].type === 'op') {
      newTokens.splice(idx, 2)
    } else {
      newTokens.splice(idx, 1)
    }
    // Strip orphaned leading/trailing ops
    while (newTokens.length && newTokens[0].type === 'op') newTokens.shift()
    while (newTokens.length && newTokens[newTokens.length - 1].type === 'op') newTokens.pop()
    onTokensChange(newTokens)
  }

  function handleDragStart(id: string) { setDragId(id) }
  function handleDragOver(e: React.DragEvent, beforeId: string | null) {
    e.preventDefault()
    setDropBeforeId(beforeId)
  }
  function handleDrop(beforeId: string | null) {
    if (!dragId || dragId === beforeId) { setDragId(null); setDropBeforeId(null); return }
    const fromIdx = tokens.findIndex(t => t.id === dragId)
    if (fromIdx === -1) { setDragId(null); setDropBeforeId(null); return }

    // Only move clause tokens; also move the adjacent op (if any)
    const newTokens = tokens.filter(t => t.id !== dragId)
    // Remove the op that was adjacent to the dragged clause
    const opBefore = fromIdx > 0 && tokens[fromIdx - 1]?.type === 'op' ? tokens[fromIdx - 1] : null
    const opAfter = fromIdx < tokens.length - 1 && tokens[fromIdx + 1]?.type === 'op' ? tokens[fromIdx + 1] : null
    const removeOpId = opBefore?.id ?? opAfter?.id
    const cleaned = removeOpId ? newTokens.filter(t => t.id !== removeOpId) : newTokens

    const clause = tokens[fromIdx]
    const toIdx = beforeId ? cleaned.findIndex(t => t.id === beforeId) : cleaned.length

    const result = [...cleaned]
    if (toIdx === 0) {
      result.splice(0, 0, clause)
    } else {
      // Insert op before the clause
      result.splice(toIdx, 0, { id: mkId(), type: 'op', op: 'OR' } as OpToken, clause)
    }
    // Ensure no double ops
    const final: QueryToken[] = []
    for (const t of result) {
      const last = final[final.length - 1]
      if (t.type === 'op' && last?.type === 'op') continue
      final.push(t)
    }
    while (final.length && final[0].type === 'op') final.shift()
    while (final.length && final[final.length - 1].type === 'op') final.pop()

    onTokensChange(final)
    setDragId(null)
    setDropBeforeId(null)
  }

  if (tokens.length === 0) return null

  // ── Compact mode: flat pills row ──────────────────────────────────────────
  if (mode === 'compact') {
    return (
      <div className="flex items-center gap-0.5 flex-wrap px-1 py-0.5 min-h-[20px]">
        {tokens.map(t => {
          if (t.type === 'clause') {
            const c = t as ClauseToken
            return (
              <span
                key={c.id}
                className="group relative flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-px border cursor-pointer select-none"
                style={{
                  background: c.negated ? '#FFF0F0' : '#E8F0FF',
                  borderColor: c.negated ? '#CC0000' : '#316AC5',
                  color: c.negated ? '#CC0000' : '#316AC5',
                }}
                onClick={() => onEditClause(c)}
                title="Click to edit"
              >
                {c.negated && <span className="font-bold text-[#CC0000] mr-0.5">NOT</span>}
                {c.field && <span className="font-bold">{c.fieldLabel}:</span>}
                {/^IN\(/i.test(c.value)
                  ? <span className="ml-0.5">{c.value}</span>
                  : <span className="ml-0.5">&quot;{c.value}&quot;</span>}
                <button
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); deleteClause(c.id) }}
                  className="ml-0.5 opacity-0 group-hover:opacity-70 hover:!opacity-100 text-inherit leading-none"
                  tabIndex={-1}
                >×</button>
              </span>
            )
          }
          if (t.type === 'op') {
            const op = t as OpToken
            return (
              <button
                key={op.id}
                onClick={() => toggleOp(op.id)}
                className="text-[9px] font-bold px-1 py-px border cursor-pointer select-none"
                style={{
                  background: op.op === 'AND' ? '#FFF3F3' : '#F5F5F5',
                  borderColor: op.op === 'AND' ? '#CC0000' : '#808080',
                  color: op.op === 'AND' ? '#CC0000' : '#606060',
                }}
                title="Click to toggle AND/OR"
              >{op.op}</button>
            )
          }
          if (t.type === 'lparen') return <span key={t.id} className="text-[10px] text-[#808080] font-mono font-bold">(</span>
          if (t.type === 'rparen') return <span key={t.id} className="text-[10px] text-[#808080] font-mono font-bold">)</span>
          return null
        })}
        {!state.parensValid && (
          <span className="text-[9px] text-[#CC0000] font-bold ml-1">⚠ unbalanced parens</span>
        )}
      </div>
    )
  }

  // ── Visual mode: expanded blocks ──────────────────────────────────────────
  const clauseTokens = tokens.filter((t): t is ClauseToken => t.type === 'clause')
  let depth = 0

  return (
    <div className="px-1 py-1 flex flex-col gap-0.5 min-h-[40px]">
      {tokens.map((t) => {
        if (t.type === 'lparen') {
          depth++
          return (
            <div key={t.id} style={{ marginLeft: (depth - 1) * 16 }} className="text-[11px] text-[#808080] font-mono font-bold select-none">(</div>
          )
        }
        if (t.type === 'rparen') {
          depth = Math.max(0, depth - 1)
          return (
            <div key={t.id} style={{ marginLeft: depth * 16 }} className="text-[11px] text-[#808080] font-mono font-bold select-none">)</div>
          )
        }
        if (t.type === 'op') {
          const op = t as OpToken
          return (
            <div key={op.id} style={{ marginLeft: depth * 16 + 8 }} className="flex items-center gap-1">
              <button
                onClick={() => toggleOp(op.id)}
                className="text-[9px] font-bold px-2 py-px border"
                style={{
                  background: op.op === 'AND' ? '#FFF3F3' : '#F5F5F5',
                  borderColor: op.op === 'AND' ? '#CC0000' : '#808080',
                  color: op.op === 'AND' ? '#CC0000' : '#606060',
                }}
                title="Click to toggle AND/OR"
              >{op.op}</button>
            </div>
          )
        }
        if (t.type === 'clause') {
          const c = t as ClauseToken
          const isBeingDragged = dragId === c.id
          const showDropIndicator = dropBeforeId === c.id

          return (
            <div
              key={c.id}
              style={{ marginLeft: depth * 16 }}
              onDragOver={e => handleDragOver(e, c.id)}
              onDrop={() => handleDrop(c.id)}
            >
              {showDropIndicator && (
                <div className="h-0.5 bg-[#316AC5] my-0.5 rounded" />
              )}
              <div
                className={`group relative flex items-center gap-1.5 border bg-white px-2 py-1 cursor-pointer ${isBeingDragged ? 'opacity-40' : ''}`}
                style={{ borderColor: c.negated ? '#CC0000' : '#808080' }}
                draggable
                onDragStart={() => handleDragStart(c.id)}
                onDragEnd={() => { setDragId(null); setDropBeforeId(null) }}
                onClick={() => onEditClause(c)}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, clauseId: c.id }) }}
                title="Click to edit · right-click for options"
              >
                {/* Drag handle */}
                <span className="text-[#B0B0B0] cursor-grab text-[10px] select-none" onMouseDown={e => e.stopPropagation()}>⠿</span>
                {/* NOT badge */}
                {c.negated && (
                  <span className="text-[9px] font-bold bg-[#CC0000] text-white px-1 py-px select-none">NOT</span>
                )}
                {/* Field label */}
                {c.field && (
                  <span className="text-[11px] font-bold text-[#316AC5] select-none">{c.fieldLabel}:</span>
                )}
                {/* Value */}
                <span className="text-[11px] text-black flex-1 truncate select-none">
                  {/^IN\(/i.test(c.value) ? c.value : `"${c.value}"`}
                </span>
                {/* Delete button (hover) */}
                <button
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); deleteClause(c.id) }}
                  className="absolute top-0.5 right-0.5 text-[10px] text-[#808080] opacity-0 group-hover:opacity-100 hover:text-[#CC0000] leading-none w-4 h-4 flex items-center justify-center"
                  tabIndex={-1}
                  title="Delete"
                >✕</button>
              </div>
            </div>
          )
        }
        return null
      })}

      {/* Drop zone at end */}
      <div
        className="h-4"
        onDragOver={e => handleDragOver(e, null)}
        onDrop={() => handleDrop(null)}
      >
        {dropBeforeId === null && dragId && (
          <div className="h-0.5 bg-[#316AC5] rounded" />
        )}
      </div>

      {!state.parensValid && (
        <div className="text-[9px] text-[#CC0000] font-bold px-1">⚠ Unbalanced parentheses</div>
      )}

      {/* Hidden drop handlers on clause blocks (already handled inline above) */}
      {clauseTokens.map(c => (
        <span key={`drop-${c.id}`} style={{ display: 'none' }} />
      ))}

      {/* Context menu */}
      {ctxMenu && createPortal(
        <div
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 99999 }}
          className="bg-white border-2 border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.3)] py-0.5 min-w-[140px]"
          onMouseDown={e => e.stopPropagation()}
        >
          {(() => {
            const c = tokens.find(t => t.id === ctxMenu.clauseId) as ClauseToken | undefined
            if (!c) return null
            return <>
              <button
                onClick={() => { toggleNot(ctxMenu.clauseId); setCtxMenu(null) }}
                className="w-full text-left px-3 py-0.5 text-xs hover:bg-[#316AC5] hover:text-white"
              >
                {c.negated ? 'Remove NOT' : 'Add NOT'}
              </button>
              <button
                onClick={() => { onEditClause(c); setCtxMenu(null) }}
                className="w-full text-left px-3 py-0.5 text-xs hover:bg-[#316AC5] hover:text-white"
              >
                Edit…
              </button>
              <div className="border-t border-[#C0C0C0] my-0.5" />
              <button
                onClick={() => { deleteClause(ctxMenu.clauseId); setCtxMenu(null) }}
                className="w-full text-left px-3 py-0.5 text-xs text-[#CC0000] hover:bg-[#CC0000] hover:text-white"
              >
                Delete
              </button>
            </>
          })()}
        </div>,
        document.body
      )}
    </div>
  )
}
