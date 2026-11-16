/**
 * Crowd Control Company demo: UK store setup and product import.
 *
 * Safe to run on every start. Each step looks for what it would create
 * and skips it when it already exists, so nothing is duplicated.
 *
 * - Store currency GBP, one region "United Kingdom" (GB), UK VAT 20%
 * - UK stock location, delivery zone and a free UK delivery option
 * - Sales channel and publishable key for the storefront (key is logged)
 * - Products from /app/src/data/ccc-products.json, matched by handle
 */
import fs from "node:fs"
import path from "node:path"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  batchPriceListPricesWorkflow,
  batchVariantImagesWorkflow,
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createPriceListsWorkflow,
  createProductTagsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  deleteProductsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

type ImportVariant = {
  title: string
  sku?: string
  source_sku?: string
  source_id?: number
  options: Record<string, string>
  price: number
  sale_price?: number | null
  in_stock?: boolean
  backorder?: boolean
  low_stock?: number | null
  stock_text?: string | null
  image?: string | null
}
type ImportImage = string | { url: string; alt?: string | null }
type ImportProduct = {
  handle: string
  title: string
  subtitle?: string
  description?: string
  description_html?: string | null
  short_description_html?: string | null
  thumbnail?: string
  images?: ImportImage[]
  categories?: { handle: string; name: string }[]
  tags?: string[]
  brands?: string[]
  specs?: { name: string; value: string }[]
  weight_g?: number | null
  length_cm?: number | null
  width_cm?: number | null
  height_cm?: number | null
  weight_text?: string | null
  dimensions_text?: string | null
  source_id?: number
  source_slug?: string
  source_url?: string
  source_type?: string
  extras?: Record<string, unknown>
  options?: { title: string; values: string[] }[]
  variants: ImportVariant[]
}
type ImportCategory = { handle: string; name: string; parent_handle?: string | null; description?: string | null; image?: string | null }
type ImportFile = { products: ImportProduct[]; categories?: ImportCategory[]; prices_include_vat?: boolean | null }

const REGION_NAME = "United Kingdom"
const LOCATION_NAME = "UK Warehouse"
const FULFILMENT_SET_NAME = "UK delivery"
const SHIPPING_NAME = "Free UK Delivery"
const KEY_TITLE = "CCC Storefront"
const SALE_LIST_TITLE = "CCC sale prices"
// Sample products from Medusa's demo seed, removed so only real products show
const MEDUSA_SAMPLE_HANDLES = ["t-shirt", "sweatshirt", "sweatpants", "shorts"]

const imageUrl = (i: ImportImage) => (typeof i === "string" ? i : i.url)
const imageAlt = (i: ImportImage) => (typeof i === "string" ? null : i.alt || null)

export default async function setupCcc({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeService = container.resolve(Modules.STORE)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const regionService = container.resolve(Modules.REGION)
  const taxService = container.resolve(Modules.TAX)
  const stockService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const productService = container.resolve(Modules.PRODUCT)
  const pricingService = container.resolve(Modules.PRICING)
  const log = (m: string) => logger.info(`[ccc] ${m}`)

  // Store, currency and sales channel
  const [store] = await storeService.listStores({}, { relations: ["supported_currencies"] })
  let [channel] = await salesChannelService.listSalesChannels({ name: "Default Sales Channel" })
  if (!channel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
    })
    channel = result[0]
    log("sales channel created")
  }
  const hasGbp = (store as any).supported_currencies?.some((c: any) => c.currency_code === "gbp" && c.is_default)
  if (!hasGbp || store.default_sales_channel_id !== channel.id) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          name: "The Crowd Control Company (demo)",
          supported_currencies: [{ currency_code: "gbp", is_default: true }],
          default_sales_channel_id: channel.id,
        } as any,
      },
    })
    log("store set to GBP")
  }

  // Region
  let [region] = await regionService.listRegions({ name: REGION_NAME })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: { regions: [{ name: REGION_NAME, currency_code: "gbp", countries: ["gb"], payment_providers: ["pp_system_default"], automatic_taxes: true }] },
    })
    region = result[0]
    log("UK region created")
  }

  // UK VAT
  const taxRegions = await taxService.listTaxRegions({ country_code: "gb" })
  if (!taxRegions.length) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "gb", provider_id: "tp_system", default_tax_rate: { rate: 20, code: "VAT", name: "UK VAT" } } as any],
    })
    log("UK VAT 20% created")
  }

  // Stock location
  let [location] = await stockService.listStockLocations({ name: LOCATION_NAME })
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: LOCATION_NAME, address: { address_1: "", city: "", country_code: "GB" } }] },
    })
    location = result[0]
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })
    await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: location.id, add: [channel.id] } })
    await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update: { default_location_id: location.id } } })
    log("UK stock location created")
  }

  // Shipping profile, delivery zone and free UK delivery
  let [profile] = await fulfillmentService.listShippingProfiles({ type: "default" })
  if (!profile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    })
    profile = result[0]
  }
  let [fset] = await fulfillmentService.listFulfillmentSets({ name: FULFILMENT_SET_NAME }, { relations: ["service_zones"] })
  if (!fset) {
    fset = await fulfillmentService.createFulfillmentSets({
      name: FULFILMENT_SET_NAME,
      type: "shipping",
      service_zones: [{ name: "United Kingdom", geo_zones: [{ country_code: "gb", type: "country" }] }],
    })
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fset.id },
    })
    log("UK delivery zone created")
  }
  const zoneId = fset.service_zones[0].id
  const existingOptions = await fulfillmentService.listShippingOptions({ name: SHIPPING_NAME })
  if (!existingOptions.length) {
    await createShippingOptionsWorkflow(container).run({
      input: [{
        name: SHIPPING_NAME,
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: zoneId,
        shipping_profile_id: profile.id,
        type: { label: "Free UK Delivery", description: "Free delivery to UK addresses.", code: "free-uk" },
        prices: [{ currency_code: "gbp", amount: 0 }, { region_id: region.id, amount: 0 }],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      }],
    })
    log("free UK delivery option created")
  }

  // Publishable key for the storefront
  const { data: keys } = await query.graph({ entity: "api_key", fields: ["id", "token", "title"], filters: { type: "publishable" } })
  let key = keys.find((k: any) => k.title === KEY_TITLE) ?? keys[0]
  if (!key) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: KEY_TITLE, type: "publishable", created_by: "" }] },
    })
    key = result[0] as any
    await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: key.id, add: [channel.id] } })
    log("publishable key created")
  }
  // Optional fixed key, so the storefront can be configured before the first start.
  // Publishable keys are public by design (every shopper's browser receives one).
  const wantedToken = process.env.CCC_PUBLISHABLE_KEY
  if (wantedToken && /^pk_[a-zA-Z0-9]{20,}$/.test(wantedToken) && (key as any).token !== wantedToken) {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
    await pg("api_key").where({ id: (key as any).id }).update({ token: wantedToken, redacted: wantedToken.slice(0, 6) + "***" + wantedToken.slice(-3) })
    ;(key as any).token = wantedToken
    log("publishable key set to the value of CCC_PUBLISHABLE_KEY")
  }
  log(`PUBLISHABLE_KEY=${(key as any).token}`)

  // Medusa's own sample products, if an earlier demo seed left them
  const samples = await productService.listProducts({ handle: MEDUSA_SAMPLE_HANDLES }, { select: ["id"] })
  if (samples.length) {
    await deleteProductsWorkflow(container).run({ input: { ids: samples.map((p) => p.id) } })
    log(`${samples.length} Medusa sample products removed`)
  }

  // Products
  const file = process.env.CCC_DATA || path.resolve(process.cwd(), "../../src/data/ccc-products.json")
  if (!fs.existsSync(file)) { log(`no product file at ${file}, skipping import`); return }
  const data: ImportFile = JSON.parse(fs.readFileSync(file, "utf8"))
  const wanted = data.products || []
  if (!wanted.length) { log("product file is empty, skipping import"); return }

  // Prices as shown on the source site include VAT unless the file says otherwise
  if (typeof data.prices_include_vat === "boolean" && (region as any).is_tax_inclusive !== data.prices_include_vat) {
    await updateRegionsWorkflow(container).run({
      input: { selector: { id: region.id }, update: { is_tax_inclusive: data.prices_include_vat } as any },
    })
    log(`UK prices set to ${data.prices_include_vat ? "include" : "exclude"} VAT`)
  }

  // CCC_REIMPORT=true replaces products already imported, for a fresh export
  if (process.env.CCC_REIMPORT === "true") {
    const old = await productService.listProducts({ handle: wanted.map((p) => p.handle) }, { select: ["id"], take: wanted.length + 10 })
    if (old.length) {
      for (let i = 0; i < old.length; i += 50) {
        await deleteProductsWorkflow(container).run({ input: { ids: old.slice(i, i + 50).map((p) => p.id) } })
      }
      log(`${old.length} products removed for re-import`)
    }
  }

  const existing = await productService.listProducts({ handle: wanted.map((p) => p.handle) }, { select: ["handle"], take: wanted.length + 10 })
  const have = new Set(existing.map((p) => p.handle))
  const todo = wanted.filter((p) => !have.has(p.handle) && p.variants?.length)
  log(`${wanted.length} products in file, ${have.size} already present, ${todo.length} to create`)
  if (!todo.length) return

  // Categories, parents first, created once by handle
  const catInfo = new Map<string, ImportCategory>()
  for (const c of data.categories || []) catInfo.set(c.handle, c)
  for (const p of todo) for (const c of p.categories || []) if (!catInfo.has(c.handle)) catInfo.set(c.handle, { handle: c.handle, name: c.name })
  const needed = new Set<string>()
  const addWithParents = (h: string, depth = 0) => {
    if (needed.has(h) || depth > 10) return
    needed.add(h)
    const parent = catInfo.get(h)?.parent_handle
    if (parent && catInfo.has(parent)) addWithParents(parent, depth + 1)
  }
  for (const p of todo) for (const c of p.categories || []) addWithParents(c.handle)
  const catExisting = needed.size ? await productService.listProductCategories({ handle: [...needed] }, { select: ["id", "handle"], take: needed.size + 10 }) : []
  const catId = new Map(catExisting.map((c) => [c.handle, c.id]))
  let created = 0
  for (let pass = 0; pass < 12; pass++) {
    const ready = [...needed].filter((h) => !catId.has(h)).filter((h) => {
      const parent = catInfo.get(h)?.parent_handle
      return !parent || !needed.has(parent) || catId.has(parent)
    })
    if (!ready.length) break
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: ready.map((h) => {
          const c = catInfo.get(h)!
          const parent = c.parent_handle && catId.get(c.parent_handle)
          return {
            handle: h,
            name: c.name,
            description: c.description || undefined,
            is_active: true,
            ...(parent ? { parent_category_id: parent } : {}),
            metadata: c.image ? { image: c.image } : undefined,
          }
        }),
      },
    })
    for (const c of result) catId.set(c.handle, c.id)
    created += result.length
  }
  if (created) log(`${created} categories created`)

  // Tags, created once by name
  const tagNames = [...new Set(todo.flatMap((p) => p.tags || []))]
  const tagId = new Map<string, string>()
  if (tagNames.length) {
    const found = await productService.listProductTags({ value: tagNames }, { select: ["id", "value"], take: tagNames.length + 10 })
    for (const t of found) tagId.set(t.value, t.id)
    const missing = tagNames.filter((t) => !tagId.has(t))
    if (missing.length) {
      const { result } = await createProductTagsWorkflow(container).run({ input: { product_tags: missing.map((value) => ({ value })) } })
      for (const t of result) tagId.set(t.value, t.id)
      log(`${missing.length} tags created`)
    }
  }

  const salePrices: { variant_id: string; amount: number; currency_code: string }[] = []
  const stockLevels: { sku: string; handle: string; title: string; qty: number }[] = []
  const batch = 20
  for (let i = 0; i < todo.length; i += batch) {
    const slice = todo.slice(i, i + batch)
    const { result: made } = await createProductsWorkflow(container).run({
      input: {
        products: slice.map((p) => {
          const options = p.options?.length ? p.options : [{ title: "Default", values: ["Standard"] }]
          const images = p.images || []
          return {
            title: p.title,
            subtitle: p.subtitle,
            handle: p.handle,
            description: p.description,
            status: ProductStatus.PUBLISHED,
            thumbnail: p.thumbnail || (images[0] ? imageUrl(images[0]) : undefined),
            images: images.map((img) => ({ url: imageUrl(img), metadata: imageAlt(img) ? { alt: imageAlt(img) } : undefined })),
            category_ids: (p.categories || []).map((c) => catId.get(c.handle)).filter(Boolean) as string[],
            tag_ids: (p.tags || []).map((t) => tagId.get(t)).filter(Boolean) as string[],
            weight: p.weight_g ?? undefined,
            length: p.length_cm ?? undefined,
            width: p.width_cm ?? undefined,
            height: p.height_cm ?? undefined,
            shipping_profile_id: profile.id,
            options,
            metadata: {
              source_id: p.source_id,
              source_slug: p.source_slug,
              source_url: p.source_url,
              source_type: p.source_type,
              description_html: p.description_html || null,
              short_description_html: p.short_description_html || null,
              specs: p.specs?.length ? p.specs : null,
              brands: p.brands?.length ? p.brands : null,
              weight_text: p.weight_text || null,
              dimensions_text: p.dimensions_text || null,
              extras: p.extras || null,
            },
            variants: p.variants.map((v) => {
              // Stock: in stock with no count shown is treated as always available.
              // Out of stock, or a "only N left" count, is tracked at the UK warehouse.
              const tracked = v.in_stock === false || (typeof v.low_stock === "number" && v.low_stock >= 0)
              return {
                title: v.title,
                sku: v.sku || undefined,
                options: Object.keys(v.options || {}).length ? v.options : { [options[0].title]: options[0].values[0] },
                manage_inventory: tracked,
                allow_backorder: !!v.backorder,
                prices: [{ amount: v.price, currency_code: "gbp" }],
                metadata: {
                  source_id: v.source_id,
                  source_sku: v.source_sku || v.sku || null,
                  image: v.image || null,
                  stock_text: v.stock_text || null,
                  sale_price: v.sale_price ?? null,
                },
              }
            }),
            sales_channels: [{ id: channel.id }],
          } as any
        }),
      },
    })

    // Per-combination photos, sale prices and stock counts need the new IDs
    const { data: rows } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "images.id", "images.url", "variants.id", "variants.title", "variants.sku", "variants.metadata", "variants.manage_inventory"],
      filters: { id: made.map((p: any) => p.id) },
    })
    for (const prod of rows as any[]) {
      const src = slice.find((p) => p.handle === prod.handle)
      if (!src) continue
      for (const variant of prod.variants || []) {
        const sv = src.variants.find((v) => v.title === variant.title)
        if (!sv) continue
        if (sv.image) {
          const img = (prod.images || []).find((im: any) => im.url === sv.image)
          if (img) await batchVariantImagesWorkflow(container).run({ input: { variant_id: variant.id, add: [img.id] } })
        }
        if (sv.sale_price != null && sv.sale_price < sv.price) {
          salePrices.push({ variant_id: variant.id, amount: sv.sale_price, currency_code: "gbp" })
        }
        if (variant.manage_inventory) {
          stockLevels.push({ sku: variant.sku, handle: prod.handle, title: variant.title, qty: sv.in_stock === false ? 0 : Math.max(0, sv.low_stock ?? 0) })
        }
      }
    }
    log(`created products ${i + 1} to ${i + slice.length}`)
  }

  // Stock counts at the UK warehouse for tracked combinations
  if (stockLevels.length) {
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "title", "product.handle", "inventory_items.inventory_item_id"],
      filters: { manage_inventory: true },
    })
    const levels: { inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
    for (const s of stockLevels) {
      const v = (variants as any[]).find((x) => x.product?.handle === s.handle && x.title === s.title)
      const itemId = v?.inventory_items?.[0]?.inventory_item_id
      if (itemId) levels.push({ inventory_item_id: itemId, location_id: location.id, stocked_quantity: s.qty })
    }
    for (let i = 0; i < levels.length; i += 100) {
      await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: levels.slice(i, i + 100) } })
    }
    log(`${levels.length} stock counts set`)
  }

  // Sale prices as one active sale price list, so the shop shows was and now prices
  if (salePrices.length) {
    const [list] = await pricingService.listPriceLists({ title: [SALE_LIST_TITLE] } as any)
    if (list) {
      await batchPriceListPricesWorkflow(container).run({ input: { data: { id: list.id, create: salePrices, update: [], delete: [] } } as any })
    } else {
      await createPriceListsWorkflow(container).run({
        input: {
          price_lists_data: [{
            title: SALE_LIST_TITLE,
            description: "Sale prices copied from the live site",
            type: "sale",
            status: "active",
            prices: salePrices,
          }],
        } as any,
      })
    }
    log(`${salePrices.length} sale prices set`)
  }
}
