"use client"

import { use, useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { AdminWindowFrame } from "@/components/admin/AdminWindowFrame"
import type {
  FacilityDetail,
  ContactRow,
} from "@/app/api/admin/facilities/[mnemonic]/route"

const ROLES = [
  { value: 'pharmacy_director',   label: 'Pharmacy Director' },
  { value: 'operations_manager',  label: 'Operations Manager' },
  { value: 'clinical_manager',    label: 'Clinical Manager' },
  { value: 'ip_pharmacist',       label: 'IP Pharmacist' },
  { value: 'is_director',         label: 'IS Director' },
  { value: 'main_pharmacy_phone', label: 'Main Pharmacy (phone only)' },
] as const

/**
 * Facility detail/edit page — `/admin/facilities/[mnemonic]`.
 *
 * Lets a pharmacy admin curate the contact list for one facility. Three
 * sections are editable (facility metadata, contacts, aliases); Cerner
 * code mappings are read-only since they're derived from the Cerner
 * FACILITY code-set dump.
 *
 * Edits are eager — Save buttons hit the API immediately, refetch on
 * success. Any change to a contact also flips its `source` from 'seed'
 * to 'manual' on the server side.
 */
export default function FacilityDetailPage({
  params,
}: {
  params: Promise<{ mnemonic: string }>
}) {
  const { mnemonic } = use(params)
  const [detail, setDetail] = useState<FacilityDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    setError(null)
    fetch(`/api/admin/facilities/${encodeURIComponent(mnemonic)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<FacilityDetail>
      })
      .then(setDetail)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [mnemonic, reloadKey])

  return (
    <AdminWindowFrame
      icon="🏥"
      title={detail ? `${detail.mnemonic} · ${detail.longName}` : `Loading ${mnemonic}…`}
      subtitle="(facility admin)"
    >
      <div className="p-3 space-y-3 font-mono text-xs">
        <div className="text-[11px]">
          <Link href="/admin/facilities" className="text-[#0000FF] hover:underline">
            ← Back to all facilities
          </Link>
        </div>

        {error && (
          <div className="border border-red-600 bg-red-50 text-red-900 px-2 py-1.5">
            {error}
          </div>
        )}

        {!detail && !error && <div className="text-[#404040] italic">Loading…</div>}

        {detail && (
          <>
            <FacilityMetadata detail={detail} onSaved={refetch} onError={setError} />
            <ContactsSection detail={detail} onChange={refetch} onError={setError} />
            <AliasesSection detail={detail} onChange={refetch} onError={setError} />
            <CernerCodesSection detail={detail} />
          </>
        )}
      </div>
    </AdminWindowFrame>
  )
}

// ---------------------------------------------------------------------------
// Metadata section
// ---------------------------------------------------------------------------

function FacilityMetadata({
  detail, onSaved, onError,
}: { detail: FacilityDetail; onSaved: () => void; onError: (e: string) => void }) {
  const [longName, setLongName] = useState(detail.longName)
  const [region, setRegion]     = useState(detail.region ?? "")
  const [isAcute, setIsAcute]   = useState(detail.isAcute)
  const [notes, setNotes]       = useState(detail.notes ?? "")
  const [saving, setSaving]     = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const dirty =
    longName !== detail.longName ||
    region !== (detail.region ?? "") ||
    isAcute !== detail.isAcute ||
    notes !== (detail.notes ?? "")

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/admin/facilities/${detail.mnemonic}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ longName, region: region || null, isAcute, notes: notes || null }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      onSaved()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteFacility() {
    setDeleting(true)
    try {
      const r = await fetch(`/api/admin/facilities/${detail.mnemonic}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      // Navigate back to the list so the user sees the deletion took effect.
      window.location.href = '/admin/facilities'
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <Section title="Facility metadata">
      <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 items-center">
        <label className="text-[#606060]">Mnemonic</label>
        <span className="font-bold">{detail.mnemonic}</span>

        <label className="text-[#606060]">Long Name</label>
        <input
          value={longName} onChange={e => setLongName(e.target.value)}
          className="border border-[#808080] bg-white px-1 py-0.5"
        />

        <label className="text-[#606060]">Region</label>
        <input
          value={region} onChange={e => setRegion(e.target.value)}
          className="border border-[#808080] bg-white px-1 py-0.5 w-24"
          placeholder="East / Central / West"
        />

        <label className="text-[#606060]">Type</label>
        <label className="flex gap-2 items-center">
          <input type="checkbox" checked={isAcute} onChange={e => setIsAcute(e.target.checked)} />
          <span>Acute care hospital (uncheck for BH)</span>
        </label>

        <label className="text-[#606060]">Notes</label>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          rows={2}
          className="border border-[#808080] bg-white px-1 py-0.5 font-mono text-xs"
          placeholder="Internal notes (optional)"
        />
      </div>
      <div className="mt-2 flex gap-2 items-center">
        {dirty && (
          <>
            <button
              onClick={save} disabled={saving}
              className="border border-[#808080] bg-[#316AC5] text-white px-2 py-0.5 text-xs hover:bg-[#2456A5] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save metadata'}
            </button>
            <button
              onClick={() => { setLongName(detail.longName); setRegion(detail.region ?? ""); setIsAcute(detail.isAcute); setNotes(detail.notes ?? "") }}
              className="border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-2 py-0.5 text-xs"
            >
              Cancel
            </button>
          </>
        )}

        {/* Delete is a destructive action — two-step confirmation, with a
            warning that lists what will cascade. */}
        <div className="ml-auto">
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="border border-[#808080] bg-[#D4D0C8] hover:bg-[#FFE0E0] text-black px-2 py-0.5 text-xs"
            >
              Delete facility…
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#CC0000]">
                Permanently delete {detail.mnemonic}?
                {' '}({detail.contacts.length} contacts, {detail.aliases.length} aliases,
                {' '}{detail.cernerCodes.length} Cerner mappings will cascade)
              </span>
              <button
                onClick={deleteFacility} disabled={deleting}
                className="border border-[#000] bg-[#CC0000] hover:bg-[#A00000] text-white px-2 py-0.5 text-xs disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)} disabled={deleting}
                className="border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-2 py-0.5 text-xs"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Contacts section — full CRUD
// ---------------------------------------------------------------------------

function ContactsSection({
  detail, onChange, onError,
}: { detail: FacilityDetail; onChange: () => void; onError: (e: string) => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <Section
      title={`Contacts (${detail.contacts.length})`}
      action={
        !adding && !editingId ? (
          <button
            onClick={() => setAdding(true)}
            className="border border-[#808080] bg-[#0F8C5C] text-white px-2 py-0.5 text-[11px] hover:bg-[#0A6E48]"
          >
            + Add contact
          </button>
        ) : null
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs font-mono">
          <thead className="bg-[#E8E8E8]">
            <tr className="border-b border-[#C0C0C0]">
              <th className="px-2 py-1 text-left w-44">Role</th>
              <th className="px-2 py-1 text-left w-44">Name</th>
              <th className="px-2 py-1 text-left">Email</th>
              <th className="px-2 py-1 text-left w-36">Phone</th>
              <th className="px-2 py-1 text-left w-16">Source</th>
              <th className="px-2 py-1 text-right w-24"></th>
            </tr>
          </thead>
          <tbody>
            {detail.contacts.map(c => (
              <ContactRowDisplay
                key={c.id}
                row={c}
                isEditing={editingId === c.id}
                disabled={(adding || editingId !== null) && editingId !== c.id}
                onStartEdit={() => setEditingId(c.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); onChange() }}
                onError={onError}
                mnemonic={detail.mnemonic}
              />
            ))}
            {adding && (
              <ContactRowEdit
                mnemonic={detail.mnemonic}
                onCancel={() => setAdding(false)}
                onSaved={() => { setAdding(false); onChange() }}
                onError={onError}
              />
            )}
            {detail.contacts.length === 0 && !adding && (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-center text-[#808080] italic">
                  No contacts. Click "+ Add contact" above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function ContactRowDisplay({
  row, isEditing, disabled, onStartEdit, onCancelEdit, onSaved, onError, mnemonic,
}: {
  row: ContactRow
  isEditing: boolean
  disabled: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaved: () => void
  onError: (e: string) => void
  mnemonic: string
}) {
  if (isEditing) {
    return (
      <ContactRowEdit
        existing={row}
        mnemonic={mnemonic}
        onCancel={onCancelEdit}
        onSaved={onSaved}
        onError={onError}
      />
    )
  }
  const roleLabel = ROLES.find(r => r.value === row.role)?.label ?? row.role
  return (
    <tr className={`border-b border-[#E0E0E0] ${disabled ? 'opacity-50' : 'hover:bg-[#F4F4F4]'}`}>
      <td className="px-2 py-0.5">{roleLabel}</td>
      <td className="px-2 py-0.5">{row.name || <span className="text-[#A0A0A0]">—</span>}</td>
      <td className="px-2 py-0.5">
        {row.email ? (
          <a href={`mailto:${row.email}`} className="text-[#0000FF] hover:underline">{row.email}</a>
        ) : <span className="text-[#A0A0A0]">—</span>}
      </td>
      <td className="px-2 py-0.5">{row.phone ?? <span className="text-[#A0A0A0]">—</span>}</td>
      <td className="px-2 py-0.5 text-[10px]">
        <span style={{ color: row.source === 'manual' ? '#0F8C5C' : '#606060' }}>
          {row.source}
        </span>
      </td>
      <td className="px-2 py-0.5 text-right whitespace-nowrap">
        <button
          onClick={onStartEdit} disabled={disabled}
          className="text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] px-1.5 py-0.5 disabled:opacity-30"
        >
          Edit
        </button>
        <DeleteButton row={row} mnemonic={mnemonic} disabled={disabled} onSaved={onSaved} onError={onError} />
      </td>
    </tr>
  )
}

function ContactRowEdit({
  existing, mnemonic, onCancel, onSaved, onError,
}: {
  existing?: ContactRow
  mnemonic: string
  onCancel: () => void
  onSaved: () => void
  onError: (e: string) => void
}) {
  const [role, setRole]   = useState<typeof ROLES[number]['value']>(existing?.role as typeof ROLES[number]['value'] ?? 'pharmacy_director')
  const [name, setName]   = useState(existing?.name ?? "")
  const [email, setEmail] = useState(existing?.email ?? "")
  const [phone, setPhone] = useState(existing?.phone ?? "")
  const [notes, setNotes] = useState(existing?.notes ?? "")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name && !email && !phone) {
      onError('At least one of name / email / phone must be set.')
      return
    }
    setSaving(true)
    try {
      const url = existing
        ? `/api/admin/facilities/${mnemonic}/contacts/${existing.id}`
        : `/api/admin/facilities/${mnemonic}/contacts`
      const method = existing ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, name, email: email || null, phone: phone || null, notes: notes || null }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      onSaved()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b border-[#E0E0E0] bg-[#FFFAE5]">
      <td className="px-2 py-1">
        <select
          value={role} onChange={e => setRole(e.target.value as typeof role)}
          className="border border-[#808080] bg-white text-xs font-mono w-full px-0.5 py-0"
        >
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name"
          className="border border-[#808080] bg-white text-xs font-mono w-full px-1 py-0" />
      </td>
      <td className="px-2 py-1">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@uhsinc.com"
          className="border border-[#808080] bg-white text-xs font-mono w-full px-1 py-0" type="email" />
      </td>
      <td className="px-2 py-1">
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(xxx) xxx-xxxx"
          className="border border-[#808080] bg-white text-xs font-mono w-full px-1 py-0" />
      </td>
      <td className="px-2 py-1 text-[10px] text-[#0F8C5C]">
        {existing ? 'edit→manual' : 'manual'}
      </td>
      <td className="px-2 py-1 text-right whitespace-nowrap">
        <button
          onClick={save} disabled={saving}
          className="text-[10px] border border-[#000] bg-[#316AC5] hover:bg-[#2456A5] text-white px-1.5 py-0.5 disabled:opacity-50"
        >
          {saving ? '…' : 'Save'}
        </button>
        <button
          onClick={onCancel} disabled={saving}
          className="text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-1.5 py-0.5 ml-1"
        >
          Cancel
        </button>
        {/* Notes editor — sits below the inline row when editing existing.
            For brevity we don't show it for new contacts (rarely needed
            on initial create). */}
        {existing && (
          <div className="text-left mt-1 col-span-6">
            <input
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="notes…"
              className="border border-[#808080] bg-white text-[10px] font-mono w-full px-1 py-0"
            />
          </div>
        )}
      </td>
    </tr>
  )
}

function DeleteButton({
  row, mnemonic, disabled, onSaved, onError,
}: {
  row: ContactRow
  mnemonic: string
  disabled: boolean
  onSaved: () => void
  onError: (e: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  async function doDelete() {
    try {
      const r = await fetch(`/api/admin/facilities/${mnemonic}/contacts/${row.id}`, {
        method: 'DELETE',
      })
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      onSaved()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setConfirming(false)
    }
  }
  if (confirming) {
    return (
      <span className="ml-1 inline-flex gap-1">
        <button onClick={doDelete}
          className="text-[10px] border border-[#000] bg-[#CC0000] hover:bg-[#A00000] text-white px-1.5 py-0.5">
          Confirm
        </button>
        <button onClick={() => setConfirming(false)}
          className="text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] px-1.5 py-0.5">
          ×
        </button>
      </span>
    )
  }
  return (
    <button
      onClick={() => setConfirming(true)} disabled={disabled}
      className="ml-1 text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#FFE0E0] disabled:opacity-30 px-1.5 py-0.5"
    >
      Delete
    </button>
  )
}

// ---------------------------------------------------------------------------
// Aliases section — add manual / delete
// ---------------------------------------------------------------------------

function AliasesSection({
  detail, onChange, onError,
}: { detail: FacilityDetail; onChange: () => void; onError: (e: string) => void }) {
  const [newAlias, setNewAlias] = useState("")
  const [adding, setAdding] = useState(false)

  async function addAlias() {
    if (!newAlias.trim()) return
    setAdding(true)
    try {
      const r = await fetch(`/api/admin/facilities/${detail.mnemonic}/aliases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alias: newAlias.trim() }),
      })
      if (!r.ok) {
        const body = await r.json()
        if (r.status === 409 && body.mappedTo) {
          throw new Error(`Already mapped to ${body.mappedTo}`)
        }
        throw new Error(body.error ?? `HTTP ${r.status}`)
      }
      setNewAlias("")
      onChange()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  async function deleteAlias(alias: string) {
    try {
      const r = await fetch(
        `/api/admin/facilities/${detail.mnemonic}/aliases/${encodeURIComponent(alias)}`,
        { method: 'DELETE' },
      )
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      onChange()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Section title={`Aliases (${detail.aliases.length})`}>
      <div className="text-[10px] text-[#606060] mb-1">
        Lowercased strings that resolve to this facility — Service Desk variants,
        colloquial spellings, sub-clinics. Add new aliases when the seed loader misses them.
      </div>
      <div className="flex gap-1 mb-2">
        <input
          value={newAlias} onChange={e => setNewAlias(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addAlias() }}
          placeholder="add alias (e.g. 'aiken hospital')"
          className="flex-1 border border-[#808080] bg-white px-1 py-0.5 text-xs"
        />
        <button
          onClick={addAlias} disabled={adding || !newAlias.trim()}
          className="border border-[#808080] bg-[#0F8C5C] text-white text-[11px] px-2 py-0.5 hover:bg-[#0A6E48] disabled:opacity-50"
        >
          + Add
        </button>
      </div>
      <div className="border border-[#C0C0C0] bg-white max-h-48 overflow-y-auto">
        <table className="w-full border-collapse text-xs font-mono">
          <tbody>
            {detail.aliases.map(a => (
              <tr key={a.alias} className="border-b border-[#E8E8E8] hover:bg-[#F4F4F4]">
                <td className="px-2 py-0.5">{a.alias}</td>
                <td className="px-2 py-0.5 text-[10px] text-[#606060] w-32">{a.source}</td>
                <td className="px-2 py-0.5 text-right w-16">
                  <button
                    onClick={() => deleteAlias(a.alias)}
                    className="text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#FFE0E0] px-1.5 py-0.5"
                    title="Remove this alias"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {detail.aliases.length === 0 && (
              <tr><td className="px-2 py-2 text-center text-[#808080] italic">No aliases.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Cerner codes — read-only
// ---------------------------------------------------------------------------

function CernerCodesSection({ detail }: { detail: FacilityDetail }) {
  return (
    <Section title={`Cerner code mappings (${detail.cernerCodes.length})`}>
      <div className="text-[10px] text-[#606060] mb-1">
        Read-only. Sourced from the Cerner FACILITY code-set dump. Maps the
        canonical mnemonic to the integer <code>loc_facility_cd</code> the
        admin-scan CCL query returns.
      </div>
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="bg-[#E8E8E8]">
          <tr>
            <th className="px-2 py-0.5 text-left w-20">Domain</th>
            <th className="px-2 py-0.5 text-left w-24">Code Value</th>
            <th className="px-2 py-0.5 text-left w-44">Display</th>
            <th className="px-2 py-0.5 text-left">Description</th>
          </tr>
        </thead>
        <tbody>
          {detail.cernerCodes.map(c => (
            <tr key={c.domain} className="border-t border-[#E8E8E8]">
              <td className="px-2 py-0.5 font-bold">{c.domain}</td>
              <td className="px-2 py-0.5">{c.codeValue}</td>
              <td className="px-2 py-0.5">{c.display ?? '—'}</td>
              <td className="px-2 py-0.5">{c.description ?? '—'}</td>
            </tr>
          ))}
          {detail.cernerCodes.length === 0 && (
            <tr><td colSpan={4} className="px-2 py-2 text-center text-[#808080] italic">No Cerner mappings.</td></tr>
          )}
        </tbody>
      </table>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Layout helper
// ---------------------------------------------------------------------------

function Section({
  title, action, children,
}: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-[#C0C0C0] bg-white">
      <div className="flex items-center px-2 py-1 bg-[#E8E8E8] border-b border-[#C0C0C0]">
        <div className="text-[11px] uppercase font-bold tracking-wide text-[#404040]">
          {title}
        </div>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}
