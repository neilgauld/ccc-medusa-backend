import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Private demo: every response carries a noindex header.
function noIndex(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive")
  next()
}

export default defineMiddlewares({
  routes: [{ matcher: "/*", middlewares: [noIndex] }],
})
