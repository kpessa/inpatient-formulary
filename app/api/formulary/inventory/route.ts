import { NextRequest } from 'next/server'
import { fetchInventoryByGroupIds } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const groupIds = (searchParams.get('groupIds') ?? '').split(',').filter(Boolean)
  const region      = searchParams.get('region')      ?? undefined
  const environment = searchParams.get('environment') ?? undefined
  const data = await fetchInventoryByGroupIds(groupIds, region, environment)
  return Response.json(data)
}
