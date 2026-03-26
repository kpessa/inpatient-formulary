import { NextResponse } from "next/server"
import { getOldestProdExtractDate } from "@/lib/db"

export async function GET() {
  const extractedAt = await getOldestProdExtractDate()
  return NextResponse.json({ extractedAt })
}
