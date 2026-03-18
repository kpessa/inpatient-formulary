import { NextRequest, NextResponse } from "next/server"
import { getFormularyItem } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const groupId = searchParams.get("groupId") ?? ""
  const domain = searchParams.get("domain") ?? undefined
  const item = await getFormularyItem(groupId, domain)
  return NextResponse.json({ item })
}
