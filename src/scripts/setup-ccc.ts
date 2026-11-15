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
  createApiKeysWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

type ImportVariant = { title: string; sku?: string; options: Record<string, string>; price: number }
type ImportProduct = {
  handle: string
  title: string
  subtitle?: string
  description?: string
  thumbnail?: string
  images?: string[]
  categories?: { handle: string; name: string }[]
  options?: { title: string; values: string[] }[]
  variants: ImportVariant[]
}

const REGION_NAME = "United Kingdom"
const LOCATION_NAME = "UK Warehouse"
const FULFILMENT_SET_NAME = "UK delivery"
const SHIPPING_NAME = "Free UK Delivery"
const KEY_TITLE = "CCC Storefront"

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
  log(`PUBLISHABLE_KEY=${(key as any).token}`)

  // Products
  const file = process.env.CCC_DATA || path.resolve(process.cwd(), "../../src/data/ccc-products.json")
  if (!fs.existsSync(file)) { log(`no product file at ${file}, skipping import`); return }
  const data: { products: ImportProduct[] } = JSON.parse(fs.readFileSync(file, "utf8"))
  const wanted = data.products || []
  if (!wanted.length) { log("product file is empty, skipping import"); return }

  const existing = await productService.listProducts({ handle: wanted.map((p) => p.handle) }, { select: ["handle"], take: wanted.length + 10 })
  const have = new Set(existing.map((p) => p.handle))
  const todo = wanted.filter((p) => !have.has(p.handle))
  log(`${wanted.length} products in file, ${have.size} already present, ${todo.length} to create`)
  if (!todo.length) return

  // Categories, created once by handle
  const catWanted = new Map<string, string>()
  for (const p of todo) for (const c of p.categories || []) catWanted.set(c.handle, c.name)
  const catExisting = catWanted.size ? await productService.listProductCategories({ handle: [...catWanted.keys()] }, { take: catWanted.size + 10 }) : []
  const catId = new Map(catExisting.map((c) => [c.handle, c.id]))
  const catNew = [...catWanted.entries()].filter(([h]) => !catId.has(h))
  if (catNew.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: catNew.map(([handle, name]) => ({ handle, name, is_active: true })) },
    })
    for (const c of result) catId.set(c.handle, c.id)
    log(`${catNew.length} categories created`)
  }

  const batch = 25
  for (let i = 0; i < todo.length; i += batch) {
    const slice = todo.slice(i, i + batch)
    await createProductsWorkflow(container).run({
      input: {
        products: slice.map((p) => {
          const options = p.options?.length ? p.options : [{ title: "Default", values: ["Standard"] }]
          return {
            title: p.title,
            subtitle: p.subtitle,
            handle: p.handle,
            description: p.description,
            status: ProductStatus.PUBLISHED,
            thumbnail: p.thumbnail || p.images?.[0],
            images: (p.images || []).map((url) => ({ url })),
            category_ids: (p.categories || []).map((c) => catId.get(c.handle)).filter(Boolean) as string[],
            shipping_profile_id: profile.id,
            options,
            variants: p.variants.map((v) => ({
              title: v.title,
              sku: v.sku || undefined,
              options: Object.keys(v.options || {}).length ? v.options : { [options[0].title]: options[0].values[0] },
              manage_inventory: false,
              prices: [{ amount: v.price, currency_code: "gbp" }],
            })),
            sales_channels: [{ id: channel.id }],
          }
        }),
      },
    })
    log(`created products ${i + 1} to ${i + slice.length}`)
  }
}
