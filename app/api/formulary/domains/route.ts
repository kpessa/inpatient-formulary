import { NextResponse } from "next/server"
import { getAvailableDomains } from "@/lib/db"

export async function GET() {
  const domains = await getAvailableDomains()
  return NextResponse.json({ domains })
}
