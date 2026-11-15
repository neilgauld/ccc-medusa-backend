import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Private demo: tell every crawler to stay out.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive")
  res.send("User-agent: *\nDisallow: /\n")
}

export const AUTHENTICATE = false
