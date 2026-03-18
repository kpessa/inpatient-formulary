import { NextRequest, NextResponse } from "next/server"
import { parseFormulary } from "@/lib/parseFormulary"

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get("groupId") ?? ""
  const all = await parseFormulary()
  const item = all.find((i) => i.groupId === groupId) ?? null
  return NextResponse.json({ item })
}
