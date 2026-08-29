import { NextResponse } from "next/server"
import { buildAppConfig } from "@/lib/server/app-config"

// The app itself gets config inlined by the server layout; this route stays
// for the /docs live tab and any external consumers.
export async function GET() {
  return NextResponse.json(buildAppConfig())
}
