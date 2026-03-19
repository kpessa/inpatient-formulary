import { NextRequest, NextResponse } from "next/server"
import { searchFormulary } from "@/lib/db"
import type { SearchResult } from "@/lib/db"

export type { SearchResult }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = (searchParams.get("q") ?? "").toLowerCase()
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 200)
  const facilitiesParam = searchParams.get("facilities")
  const showInactive = searchParams.get("showInactive") !== "false"
  const region = searchParams.get("region") ?? undefined
  const environment = searchParams.get("environment") ?? undefined

  const { results, total } = await searchFormulary({
    q,
    limit,
    region,
    environment,
    showInactive,
    facilities: facilitiesParam,
  })

  return NextResponse.json({ results, total })
}
