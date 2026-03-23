import { NextRequest, NextResponse } from "next/server"
import { getFormularyItemsForKey } from "@/lib/db"

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const pyxisId        = searchParams.get("pyxisId")        ?? undefined
  const chargeNumber   = searchParams.get("chargeNumber")   ?? undefined
  const groupId        = searchParams.get("groupId")        ?? ""
  const showRawExtract = searchParams.get("showRawExtract") === "true"
  const items = await getFormularyItemsForKey({ pyxisId, chargeNumber, groupId }, showRawExtract)
  return NextResponse.json({ items })
}
