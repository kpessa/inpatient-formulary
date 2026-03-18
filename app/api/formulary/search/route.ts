import { NextRequest, NextResponse } from "next/server"
import { parseFormulary } from "@/lib/parseFormulary"
import type { FormularyItem } from "@/lib/types"

export interface SearchResult {
  groupId: string
  description: string
  genericName: string
  strength: string
  strengthUnit: string
  dosageForm: string
  mnemonic: string
  status: "Active" | "Inactive"
  chargeNumber: string
  brandName: string
  formularyStatus: string
  pyxisId: string
  activeFacilities: string[]
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = (searchParams.get("q") ?? "").toLowerCase()
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 200)
  const facilitiesParam = searchParams.get("facilities")
  const showInactive = searchParams.get("showInactive") !== "false"

  const all = await parseFormulary()

  let filtered = all as FormularyItem[]

  // 1. Active filter
  if (!showInactive) {
    filtered = filtered.filter((item) => item.status === "Active")
  }

  // 2. Facility filter
  if (facilitiesParam) {
    const facs = facilitiesParam.split(",").map((f) => f.trim()).filter(Boolean)
    if (facs.length > 0) {
      filtered = filtered.filter(
        (item) =>
          item.inventory.allFacilities ||
          facs.some((f) => item.inventory.facilities[f])
      )
    }
  }

  // 3. Search term — "*" is a wildcard matching any sequence of characters
  if (q) {
    const pattern = q.includes("*")
      ? new RegExp(q.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"), "i")
      : null

    const matches = (s: string) =>
      pattern ? pattern.test(s) : s.toLowerCase().includes(q)

    filtered = filtered.filter((item) => {
      const id = item.identifiers
      return (
        matches(item.description) ||
        matches(item.genericName) ||
        matches(item.mnemonic) ||
        matches(id.chargeNumber) ||
        matches(id.brandName) ||
        matches(id.brandName2) ||
        matches(id.brandName3) ||
        matches(id.pyxisId)
      )
    })
  }

  const total = filtered.length
  const results: SearchResult[] = filtered.slice(0, limit).map((item) => ({
    groupId: item.groupId,
    description: item.description,
    genericName: item.genericName,
    strength: item.strength,
    strengthUnit: item.strengthUnit,
    dosageForm: item.dosageForm,
    mnemonic: item.mnemonic,
    status: item.status,
    chargeNumber: item.identifiers.chargeNumber,
    brandName: item.identifiers.brandName,
    formularyStatus: item.dispense.formularyStatus,
    pyxisId: item.identifiers.pyxisId,
    activeFacilities: Object.keys(item.inventory.facilities).filter(
      (k) => item.inventory.facilities[k]
    ),
  }))

  return NextResponse.json({ results, total })
}
