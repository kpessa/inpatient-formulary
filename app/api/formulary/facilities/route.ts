import { NextResponse } from "next/server"
import { getDistinctFacilities } from "@/lib/db"

export async function GET() {
  const facilities = await getDistinctFacilities()
  return NextResponse.json({ facilities })
}
