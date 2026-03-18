"use client"

import { useState, useRef } from "react"
import Papa from "papaparse"
import { buildGroupRow, buildSupplyRows } from "@/lib/csvTransform"
import type { Row, GroupRow, SupplyRow } from "@/lib/csvTransform"

interface ImportModalProps {
  onClose: () => void
}

type Region = "west" | "central" | "east"
type Env = "build" | "cert" | "mock" | "prod"
type Status = "idle" | "parsing" | "importing" | "done" | "error"

const BATCH_SIZE = 100

export function ImportModal({ onClose }: ImportModalProps) {
  const [region, setRegion] = useState<Region>("west")
  const [env, setEnv] = useState<Env>("prod")
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [progress, setProgress] = useState({ batch: 0, total: 0 })
  const [message, setMessage] = useState("")
  const abortRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const domain = `${region}_${env}`
  const isRunning = status === "parsing" || status === "importing"

  async function handleImport() {
    if (!file || isRunning) return
    abortRef.current = false
    setStatus("parsing")
    setMessage("Reading file...")
    setProgress({ batch: 0, total: 0 })

    let text: string
    try {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target!.result as string)
        reader.onerror = reject
        reader.readAsText(file, "latin1")
      })
    } catch {
      setStatus("error")
      setMessage("Failed to read file.")
      return
    }

    setMessage("Parsing CSV...")

    const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true })

    // Group by GROUP_ID
    const groups = new Map<string, Row[]>()
    for (const row of data) {
      const gid = row["GROUP_ID"] ?? ""
      if (!gid) continue
      const existing = groups.get(gid)
      if (existing) existing.push(row)
      else groups.set(gid, [row])
    }

    const groupIds = Array.from(groups.keys())
    const totalBatches = Math.ceil(groupIds.length / BATCH_SIZE)
    const extractedAt = new Date().toISOString()

    setStatus("importing")
    setProgress({ batch: 0, total: totalBatches })
    setMessage(`Importing ${groupIds.length} groups in ${totalBatches} batches...`)

    let totalInserted = 0

    for (let i = 0; i < groupIds.length; i += BATCH_SIZE) {
      if (abortRef.current) {
        setStatus("idle")
        setMessage("Import cancelled.")
        return
      }

      const batchIds = groupIds.slice(i, i + BATCH_SIZE)
      const batchGroups: GroupRow[] = []
      const batchSupplies: SupplyRow[] = []

      for (const gid of batchIds) {
        const rows = groups.get(gid)!
        batchGroups.push(buildGroupRow(gid, rows, domain, region, env, extractedAt))
        batchSupplies.push(...buildSupplyRows(gid, rows, domain))
      }

      const batchIndex = Math.floor(i / BATCH_SIZE)

      try {
        const res = await fetch("/api/formulary/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            clearFirst: batchIndex === 0,
            groups: batchGroups,
            supplies: batchSupplies,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          setStatus("error")
          setMessage(`Error on batch ${batchIndex + 1}: ${err.error ?? "Unknown error"}`)
          return
        }

        totalInserted += batchGroups.length
      } catch (err) {
        setStatus("error")
        setMessage(`Network error: ${err instanceof Error ? err.message : String(err)}`)
        return
      }

      setProgress({ batch: batchIndex + 1, total: totalBatches })
    }

    setStatus("done")
    setMessage(`✓ ${totalInserted} groups imported to ${domain}`)
  }

  function handleClose() {
    if (isRunning) abortRef.current = true
    onClose()
  }

  const progressPct =
    progress.total > 0 ? Math.round((progress.batch / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        className="flex flex-col bg-[#D4D0C8] border border-white border-r-[#808080] border-b-[#808080] shadow-2xl font-mono text-xs"
        style={{ width: 420 }}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between bg-[#C85A00] text-white px-2 h-7 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">
              Rx
            </div>
            <span className="text-sm font-bold font-mono tracking-tight">
              Import CSV Extract
            </span>
          </div>
          <button
            onClick={handleClose}
            className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none hover:bg-[#E8E8E0]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          {/* CSV File */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-right shrink-0">CSV File:</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
              className="px-2 h-5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Browse...
            </button>
            <span className="truncate text-[#444] max-w-[180px]">
              {file ? file.name : "No file selected"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                setStatus("idle")
                setMessage("")
                setProgress({ batch: 0, total: 0 })
              }}
            />
          </div>

          {/* Region */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-right shrink-0">Region:</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              disabled={isRunning}
              className="h-5 border border-[#808080] bg-white px-1 font-mono text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="west">west</option>
              <option value="central">central</option>
              <option value="east">east</option>
            </select>
          </div>

          {/* Env */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-right shrink-0">Env:</span>
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as Env)}
              disabled={isRunning}
              className="h-5 border border-[#808080] bg-white px-1 font-mono text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="build">build</option>
              <option value="cert">cert</option>
              <option value="mock">mock</option>
              <option value="prod">prod</option>
            </select>
          </div>

          {/* Domain display */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-right shrink-0">Domain:</span>
            <span className="text-[#316AC5] font-bold">{domain}</span>
          </div>

          {/* Progress bar */}
          <div className="flex flex-col gap-1 mt-1">
            <div className="h-4 border border-[#808080] bg-white relative overflow-hidden">
              <div
                className="absolute left-0 top-0 bottom-0 bg-[#316AC5] transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
              {progress.total > 0 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono mix-blend-difference text-white z-10">
                  {progress.batch}/{progress.total} batches
                </span>
              )}
            </div>
            <div
              className={`h-4 font-mono text-[11px] ${
                status === "error"
                  ? "text-[#CC0000]"
                  : status === "done"
                  ? "text-[#006600]"
                  : "text-[#444]"
              }`}
            >
              {message || "\u00a0"}
            </div>
          </div>
        </div>

        {/* Button bar */}
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            onClick={handleImport}
            disabled={!file || isRunning}
            className="px-4 h-6 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import
          </button>
          <button
            onClick={handleClose}
            className="px-4 h-6 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
