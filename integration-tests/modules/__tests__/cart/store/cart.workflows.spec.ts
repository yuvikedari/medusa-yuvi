import {
  addShippingMethodToCartWorkflow,
  addToCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  deleteLineItemsStepId,
  deleteLineItemsWorkflow,
  findOrCreateCustomerStepId,
  listShippingOptionsForCartWorkflow,
  refreshPaymentCollectionForCartWorkflow,
  updateLineItemInCartWorkflow,
  updateLineItemsStepId,
  updatePaymentCollectionStepId,
  updateTaxLinesWorkflow,
} from "@medusajs/core-flows"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ICartModuleService,
  ICustomerModuleService,
  IFulfillmentModuleService,
  IInventoryService,
  IPaymentModuleService,
  IPricingModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/types"
import {
  ContainerRegistrationKeys,
  Modules,
  RuleOperator,
} from "@medusajs/utils"
import {
  adminHeaders,
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"
import { seedStorefrontDefaults } from "../../../../helpers/seed-storefront-defaults"
import { createAuthenticatedCustomer } from "../../../helpers/create-authenticated-customer"

jest.setTimeout(200000)

const env = { MEDUSA_FF_MEDUSA_V2: true }

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api }) => {
    describe("Carts workflows", () => {
      let appContainer
      let cartModuleService: ICartModuleService
      let regionModuleService: IRegionModuleService
      let scModuleService: ISalesChannelModuleService
      let customerModule: ICustomerModuleService
      let productModule: IProductModuleService
      let pricingModule: IPricingModuleService
      let paymentModule: IPaymentModuleService
      let stockLocationModule: IStockLocationService
      let inventoryModule: IInventoryService
      let fulfillmentModule: IFulfillmentModuleService
      let remoteLink, remoteQuery, storeHeaders
      let salesChannel
      let defaultRegion
      let customer, storeHeadersWithCustomer

      beforeAll(async () => {
        appContainer = getContainer()
        cartModuleService = appContainer.resolve(Modules.CART)
        regionModuleService = appContainer.resolve(Modules.REGION)
        scModuleService = appContainer.resolve(Modules.SALES_CHANNEL)
        customerModule = appContainer.resolve(Modules.CUSTOMER)
        productModule = appContainer.resolve(Modules.PRODUCT)
        pricingModule = appContainer.resolve(Modules.PRICING)
        paymentModule = appContainer.resolve(Modules.PAYMENT)
        fulfillmentModule = appContainer.resolve(Modules.FULFILLMENT)
        inventoryModule = appContainer.resolve(Modules.INVENTORY)
        stockLocationModule = appContainer.resolve(Modules.STOCK_LOCATION)
        remoteLink = appContainer.resolve(ContainerRegistrationKeys.REMOTE_LINK)
        remoteQuery = appContainer.resolve(
          ContainerRegistrationKeys.REMOTE_QUERY
        )
      })

      beforeEach(async () => {
        const publishableKey = await generatePublishableKey(appContainer)
        storeHeaders = generateStoreHeaders({ publishableKey })
        await createAdminUser(dbConnection, adminHeaders, appContainer)

        const result = await createAuthenticatedCustomer(api, storeHeaders, {
          first_name: "tony",
          last_name: "stark",
          email: "tony@test-industries.com",
        })

        customer = result.customer
        storeHeadersWithCustomer = {
          headers: {
            ...storeHeaders.headers,
            authorization: `Bearer ${result.jwt}`,
          },
        }

        const { region } = await seedStorefrontDefaults(appContainer, "dkk")

        defaultRegion = region

        salesChannel = (
          await api.post(
            "/admin/sales-channels",
            { name: "test sales channel", description: "channel" },
            adminHeaders
          )
        ).data.sales_channel
      })

      describe("CreateCartWorkflow", () => {
        it("should create a cart", async () => {
          const region = await regionModuleService.createRegions({
            name: "US",
            currency_code: "usd",
          })

          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          const location = await stockLocationModule.createStockLocations({
            name: "Warehouse",
          })

          const [product] = await productModule.createProducts([
            {
              title: "Test product",
              variants: [
                {
                  title: "Test variant",
                },
              ],
            },
          ])

          const inventoryItem = await inventoryModule.createInventoryItems({
            sku: "inv-1234",
          })

          await inventoryModule.createInventoryLevels([
            {
              inventory_item_id: inventoryItem.id,
              location_id: location.id,
              stocked_quantity: 2,
              reserved_quantity: 0,
            },
          ])

          const priceSet = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          await pricingModule.createPricePreferences({
            attribute: "currency_code",
            value: "usd",
            is_tax_inclusive: true,
          })

          await remoteLink.create([
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSet.id,
              },
            },
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: location.id,
              },
            },
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.INVENTORY]: {
                inventory_item_id: inventoryItem.id,
              },
            },
          ])

          const { result } = await createCartWorkflow(appContainer).run({
            input: {
              email: "tony@stark.com",
              currency_code: "usd",
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                },
              ],
            },
          })

          const cart = await cartModuleService.retrieveCart(result.id, {
            relations: ["items"],
          })

          expect(cart).toEqual(
            expect.objectContaining({
              currency_code: "usd",
              email: "tony@stark.com",
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              customer_id: expect.any(String),
              items: expect.arrayContaining([
                expect.objectContaining({
                  quantity: 1,
                  unit_price: 3000,
                  is_tax_inclusive: true,
                }),
              ]),
            })
          )
        })

        it("should revert if the cart creation fails", async () => {
          const region = await regionModuleService.createRegions({
            name: "US",
            currency_code: "usd",
          })

          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          const location = await stockLocationModule.createStockLocations({
            name: "Warehouse",
          })

          const [product] = await productModule.createProducts([
            {
              title: "Test product",
              variants: [
                {
                  title: "Test variant",
                },
              ],
            },
          ])

          const inventoryItem = await inventoryModule.createInventoryItems({
            sku: "inv-1234",
          })

          await inventoryModule.createInventoryLevels([
            {
              inventory_item_id: inventoryItem.id,
              location_id: location.id,
              stocked_quantity: 2,
              reserved_quantity: 0,
            },
          ])

          const priceSet = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          await remoteLink.create([
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSet.id,
              },
            },
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: location.id,
              },
            },
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.INVENTORY]: {
                inventory_item_id: inventoryItem.id,
              },
            },
          ])

          const workflow = createCartWorkflow(appContainer)

          workflow.addAction(
            "throw",
            {
              invoke: async function failStep() {
                throw new Error(`Failed to create cart`)
              },
            },
            {
              noCompensation: true,
            }
          )

          const { transaction } = await workflow.run({
            throwOnError: false,
            input: {
              email: "tony@stark.com",
              currency_code: "usd",
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                },
              ],
            },
          })

          expect(transaction.flow.state).toEqual("reverted")
        })

        it("should throw when no regions exist", async () => {
          await regionModuleService.deleteRegions(defaultRegion.id)

          const { errors } = await createCartWorkflow(appContainer).run({
            input: {
              email: "tony@stark.com",
              currency_code: "usd",
            },
            throwOnError: false,
          })

          expect(errors).toEqual([
            expect.objectContaining({
              error: expect.objectContaining({ message: "No regions found" }),
            }),
          ])
        })

        it("should throw if variants are out of stock", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          const location = await stockLocationModule.createStockLocations({
            name: "Warehouse",
          })

          const [product] = await productModule.createProducts([
            {
              title: "Test product",
              variants: [
                {
                  title: "Test variant",
                },
              ],
            },
          ])

          const inventoryItem = (
            await api.post(
              `/admin/inventory-items`,
              {
                sku: "inv-1234",
                location_levels: [
                  {
                    location_id: location.id,
                    stocked_quantity: 2,
                  },
                ],
              },
              adminHeaders
            )
          ).data.inventory_item

          await api.post(
            `/admin/reservations`,
            {
              line_item_id: "line-item-id-1",
              inventory_item_id: inventoryItem.id,
              location_id: location.id,
              description: "test description",
              quantity: 2,
            },
            adminHeaders
          )

          const region = await regionModuleService.createRegions({
            name: "US",
            currency_code: "usd",
          })

          const priceSet = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          await remoteLink.create([
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSet.id,
              },
            },
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: location.id,
              },
            },
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.INVENTORY]: {
                inventory_item_id: inventoryItem.id,
              },
            },
          ])

          const { errors } = await createCartWorkflow(appContainer).run({
            input: {
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                },
              ],
            },
            throwOnError: false,
          })

          expect(errors).toEqual([
            {
              action: "confirm-item-inventory-as-step",
              handlerType: "invoke",
              error: expect.objectContaining({
                message: expect.stringContaining(
                  "Some variant does not have the required inventory"
                ),
              }),
            },
          ])
        })

        it("should pass if variants are out of stock but allow_backorder is true", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          const location = await stockLocationModule.createStockLocations({
            name: "Warehouse",
          })

          const [product] = await productModule.createProducts([
            {
              title: "Test product",
              variants: [
                {
                  title: "Test variant",
                  allow_backorder: true,
                },
              ],
            },
          ])

          const inventoryItem = (
            await api.post(
              `/admin/inventory-items`,
              {
                sku: "inv-1234",
                location_levels: [
                  {
                    location_id: location.id,
                    stocked_quantity: 2,
                  },
                ],
              },
              adminHeaders
            )
          ).data.inventory_item

          await api.post(
            `/admin/reservations`,
            {
              line_item_id: "line-item-id-1",
              inventory_item_id: inventoryItem.id,
              location_id: location.id,
              description: "test description",
              quantity: 2,
            },
            adminHeaders
          )

          const region = await regionModuleService.createRegions({
            name: "US",
            currency_code: "usd",
          })

          const priceSet = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          await remoteLink.create([
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSet.id,
              },
            },
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: location.id,
              },
            },
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.INVENTORY]: {
                inventory_item_id: inventoryItem.id,
              },
            },
          ])

          const { errors, result } = await createCartWorkflow(appContainer).run(
            {
              input: {
                region_id: region.id,
                sales_channel_id: salesChannel.id,
                items: [
                  {
                    variant_id: product.variants[0].id,
                    quantity: 1,
                  },
                ],
              },
              throwOnError: false,
            }
          )
          expect(errors).toEqual([])

          const cart = await cartModuleService.retrieveCart(result.id, {
            relations: ["items"],
          })

          expect(cart.items).toEqual([
            expect.objectContaining({
              quantity: 1,
              variant_id: product.variants[0].id,
            }),
          ])
        })

        it("should throw if sales channel is disabled", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
            is_disabled: true,
          })

          const { errors } = await createCartWorkflow(appContainer).run({
            input: {
              sales_channel_id: salesChannel.id,
            },
            throwOnError: false,
          })

          expect(errors).toEqual([
            {
              action: "find-sales-channel",
              handlerType: "invoke",
              error: expect.objectContaining({
                message: `Unable to assign cart to disabled Sales Channel: Webshop`,
              }),
            },
          ])
        })

        describe("compensation", () => {
          it("should delete created customer if cart-creation fails", async () => {
            expect.assertions(2)
            const workflow = createCartWorkflow(appContainer)

            workflow.appendAction("throw", findOrCreateCustomerStepId, {
              invoke: async function failStep() {
                throw new Error(`Failed to create cart`)
              },
            })

            const { errors } = await workflow.run({
              input: {
                currency_code: "usd",
                email: "tony@stark-industries.com",
              },
              throwOnError: false,
            })

            expect(errors).toEqual([
              {
                action: "throw",
                handlerType: "invoke",
                error: expect.objectContaining({
                  message: `Failed to create cart`,
                }),
              },
            ])

            const customers = await customerModule.listCustomers({
              email: "tony@stark-industries.com",
            })

            expect(customers).toHaveLength(0)
          })

          it("should not delete existing customer if cart-creation fails", async () => {
            expect.assertions(2)
            const workflow = createCartWorkflow(appContainer)

            workflow.appendAction("throw", findOrCreateCustomerStepId, {
              invoke: async function failStep() {
                throw new Error(`Failed to create cart`)
              },
            })

            const customer = await customerModule.createCustomers({
              email: "tony@stark-industries.com",
            })

            const { errors } = await workflow.run({
              input: {
                currency_code: "usd",
                customer_id: customer.id,
              },
              throwOnError: false,
            })

            expect(errors).toEqual([
              {
                action: "throw",
                handlerType: "invoke",
                error: expect.objectContaining({
                  message: `Failed to create cart`,
                }),
              },
            ])

            const customers = await customerModule.listCustomers({
              email: "tony@stark-industries.com",
            })

            expect(customers).toHaveLength(1)
          })
        })
      })

      describe("AddToCartWorkflow", () => {
        it("should add item to cart", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          const location = await stockLocationModule.createStockLocations({
            name: "Warehouse",
          })

          let cart = await cartModuleService.createCarts({
            currency_code: "usd",
            sales_channel_id: salesChannel.id,
          })

          const [product] = await productModule.createProducts([
            {
              title: "Test product",
              variants: [
                {
                  title: "Test variant",
                },
              ],
            },
          ])

          const inventoryItem = await inventoryModule.createInventoryItems({
            sku: "inv-1234",
          })

          await inventoryModule.createInventoryLevels([
            {
              inventory_item_id: inventoryItem.id,
              location_id: location.id,
              stocked_quantity: 2,
              reserved_quantity: 0,
            },
          ])

          const priceSet = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          await pricingModule.createPricePreferences({
            attribute: "currency_code",
            value: "usd",
            is_tax_inclusive: true,
          })

          await remoteLink.create([
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSet.id,
              },
            },
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: location.id,
              },
            },
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.INVENTORY]: {
                inventory_item_id: inventoryItem.id,
              },
            },
          ])

          cart = await cartModuleService.retrieveCart(cart.id, {
            select: ["id", "region_id", "currency_code", "sales_channel_id"],
          })

          await addToCartWorkflow(appContainer).run({
            input: {
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                },
              ],
              cart,
            },
          })

          cart = await cartModuleService.retrieveCart(cart.id, {
            relations: ["items"],
          })

          expect(cart).toEqual(
            expect.objectContaining({
              id: cart.id,
              currency_code: "usd",
              items: expect.arrayContaining([
                expect.objectContaining({
                  unit_price: 3000,
                  is_tax_inclusive: true,
                  quantity: 1,
                  title: "Test variant",
                }),
              ]),
            })
          )
        })

        it("should throw if no price sets for variant exist", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          const location = await stockLocationModule.createStockLocations({
            name: "Warehouse",
          })

          let cart = await cartModuleService.createCarts({
            currency_code: "usd",
            sales_channel_id: salesChannel.id,
          })

          const [product] = await productModule.createProducts([
            {
              title: "Test product",
              variants: [
                {
                  title: "Test variant",
                },
              ],
            },
          ])

          const inventoryItem = await inventoryModule.createInventoryItems({
            sku: "inv-1234",
          })

          await inventoryModule.createInventoryLevels([
            {
              inventory_item_id: inventoryItem.id,
              location_id: location.id,
              stocked_quantity: 2,
              reserved_quantity: 0,
            },
          ])

          await remoteLink.create([
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: location.id,
              },
            },
            {
              [Modules.PRODUCT]: {
                variant_id: product.variants[0].id,
              },
              [Modules.INVENTORY]: {
                inventory_item_id: inventoryItem.id,
              },
            },
          ])

          const { errors } = await addToCartWorkflow(appContainer).run({
            input: {
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                },
              ],
              cart,
            },
            throwOnError: false,
          })

          expect(errors).toEqual([
            {
              action: "validate-variant-prices",
              handlerType: "invoke",
              error: expect.objectContaining({
                message: expect.stringContaining(
                  `Variants with IDs ${product.variants[0].id} do not have a price`
                ),
              }),
            },
          ])
        })

        it("should throw if variant does not exist", async () => {
          const cart = await cartModuleService.createCarts({
            currency_code: "usd",
          })

          const { errors } = await addToCartWorkflow(appContainer).run({
            input: {
              items: [
                {
                  variant_id: "prva_foo",
                  quantity: 1,
                },
              ],
              cart,
            },
            throwOnError: false,
          })

          expect(errors).toEqual([
            {
              action: "use-remote-query",
              handlerType: "invoke",
              error: expect.objectContaining({
                message: `ProductVariant id not found: prva_foo`,
              }),
            },
          ])
        })
      })

      describe("updateLineItemInCartWorkflow", () => {
        describe("compensation", () => {
          it("should revert line item update to original state", async () => {
            expect.assertions(2)
            const workflow = updateLineItemInCartWorkflow(appContainer)

            workflow.appendAction("throw", updateLineItemsStepId, {
              invoke: async function failStep() {
                throw new Error(`Failed to update something after line items`)
              },
            })

            const salesChannel = await scModuleService.createSalesChannels({
              name: "Webshop",
            })

            const location = await stockLocationModule.createStockLocations({
              name: "Warehouse",
            })

            const [product] = await productModule.createProducts([
              {
                title: "Test product",
                variants: [
                  {
                    title: "Test variant",
                  },
                ],
              },
            ])

            const inventoryItem = await inventoryModule.createInventoryItems({
              sku: "inv-1234",
            })

            await inventoryModule.createInventoryLevels([
              {
                inventory_item_id: inventoryItem.id,
                location_id: location.id,
                stocked_quantity: 2,
                reserved_quantity: 0,
              },
            ])

            const priceSet = await pricingModule.createPriceSets({
              prices: [
                {
                  amount: 3000,
                  currency_code: "usd",
                },
              ],
            })

            await remoteLink.create([
              {
                [Modules.PRODUCT]: {
                  variant_id: product.variants[0].id,
                },
                [Modules.PRICING]: {
                  price_set_id: priceSet.id,
                },
              },
              {
                [Modules.SALES_CHANNEL]: {
                  sales_channel_id: salesChannel.id,
                },
                [Modules.STOCK_LOCATION]: {
                  stock_location_id: location.id,
                },
              },
              {
                [Modules.PRODUCT]: {
                  variant_id: product.variants[0].id,
                },
                [Modules.INVENTORY]: {
                  inventory_item_id: inventoryItem.id,
                },
              },
            ])

            let cart = await cartModuleService.createCarts({
              currency_code: "usd",
              items: [
                {
                  variant_id: product.variants[0].id,
                  quantity: 1,
                  unit_price: 3000,
                  title: "Test item",
                },
              ],
            })

            cart = await cartModuleService.retrieveCart(cart.id, {
              select: ["id", "region_id", "currency_code"],
              relations: ["items", "items.variant_id", "items.metadata"],
            })

            const item = cart.items?.[0]!

            const { errors } = await workflow.run({
              input: {
                cart,
                item,
                update: {
                  metadata: {
                    foo: "bar",
                  },
                  title: "Test item updated",
                  quantity: 2,
                },
              },
              throwOnError: false,
            })

            expect(errors).toEqual([
              {
                action: "throw",
                handlerType: "invoke",
                error: expect.objectContaining({
                  message: `Failed to update something after line items`,
                }),
              },
            ])

            const updatedItem = await cartModuleService.retrieveLineItem(
              item.id
            )

            expect(updatedItem).toEqual(
              expect.objectContaining({
                id: item.id,
                unit_price: 3000,
                quantity: 1,
                title: "Test item",
              })
            )
          })
        })
      })

      describe("deleteLineItems", () => {
        it("should delete items in cart", async () => {
          const cart = await cartModuleService.createCarts({
            currency_code: "usd",
            items: [
              {
                quantity: 1,
                unit_price: 5000,
                title: "Test item",
              },
            ],
          })

          const items = await cartModuleService.listLineItems({
            cart_id: cart.id,
          })

          await deleteLineItemsWorkflow(appContainer).run({
            input: {
              cart_id: cart.id,
              ids: items.map((i) => i.id),
            },
            throwOnError: false,
          })

          const [deletedItem] = await cartModuleService.listLineItems({
            id: items.map((i) => i.id),
          })

          expect(deletedItem).toBeUndefined()
        })

        describe("compensation", () => {
          it("should restore line item if delete fails", async () => {
            const workflow = deleteLineItemsWorkflow(appContainer)

            workflow.appendAction("throw", deleteLineItemsStepId, {
              invoke: async function failStep() {
                throw new Error(
                  `Failed to do something after deleting line items`
                )
              },
            })

            const cart = await cartModuleService.createCarts({
              currency_code: "usd",
              items: [
                {
                  quantity: 1,
                  unit_price: 3000,
                  title: "Test item",
                },
              ],
            })

            const items = await cartModuleService.listLineItems({
              cart_id: cart.id,
            })

            const { errors } = await workflow.run({
              input: {
                cart_id: cart.id,
                ids: items.map((i) => i.id),
              },
              throwOnError: false,
            })

            expect(errors).toEqual([
              {
                action: "throw",
                handlerType: "invoke",
                error: expect.objectContaining({
                  message: `Failed to do something after deleting line items`,
                }),
              },
            ])

            const updatedItem = await cartModuleService.retrieveLineItem(
              items[0].id
            )

            expect(updatedItem).not.toBeUndefined()
          })
        })
      })

      describe("createPaymentCollectionForCart", () => {
        it("should create a payment collection and link it to cart", async () => {
          const cart = await cartModuleService.createCarts({
            currency_code: "dkk",
            region_id: defaultRegion.id,
            items: [
              {
                quantity: 1,
                unit_price: 5000,
                title: "Test item",
              },
            ],
          })

          await createPaymentCollectionForCartWorkflow(appContainer).run({
            input: {
              cart_id: cart.id,
            },
            throwOnError: false,
          })

          const result = await remoteQuery(
            {
              cart: {
                fields: ["id"],
                payment_collection: {
                  fields: ["id", "amount", "currency_code"],
                },
              },
            },
            {
              cart: {
                id: cart.id,
              },
            }
          )

          expect(result).toEqual([
            expect.objectContaining({
              id: cart.id,
              payment_collection: expect.objectContaining({
                amount: 5000,
                currency_code: "dkk",
              }),
            }),
          ])
        })

        describe("compensation", () => {
          it("should dismiss cart <> payment collection link and delete created payment collection", async () => {
            const workflow =
              createPaymentCollectionForCartWorkflow(appContainer)

            workflow.addAction("throw", {
              invoke: async function failStep() {
                throw new Error(
                  `Failed to do something after linking cart and payment collection`
                )
              },
            })

            const region = await regionModuleService.createRegions({
              name: "US",
              currency_code: "usd",
            })

            const cart = await cartModuleService.createCarts({
              currency_code: "usd",
              region_id: region.id,
              items: [
                {
                  quantity: 1,
                  unit_price: 5000,
                  title: "Test item",
                },
              ],
            })

            const { errors } = await workflow.run({
              input: {
                cart_id: cart.id,
              },
              throwOnError: false,
            })

            expect(errors).toEqual([
              {
                action: "throw",
                handlerType: "invoke",
                error: expect.objectContaining({
                  message: `Failed to do something after linking cart and payment collection`,
                }),
              },
            ])

            const carts = await remoteQuery(
              {
                cart: {
                  fields: ["id"],
                  payment_collection: {
                    fields: ["id", "amount", "currency_code"],
                  },
                },
              },
              {
                cart: {
                  id: cart.id,
                },
              }
            )

            const payCols = await remoteQuery({
              payment_collection: {
                fields: ["id"],
              },
            })

            expect(carts).toEqual([
              expect.objectContaining({
                id: cart.id,
                payment_collection: undefined,
              }),
            ])
            expect(payCols.length).toEqual(0)
          })
        })
      })

      describe("refreshPaymentCollectionForCart", () => {
        it("should refresh a payment collection for a cart", async () => {
          const cart = await cartModuleService.createCarts({
            currency_code: "dkk",
            region_id: defaultRegion.id,
            items: [
              {
                quantity: 1,
                unit_price: 5000,
                title: "Test item",
              },
            ],
          })

          const paymentCollection =
            await paymentModule.createPaymentCollections({
              amount: 5001,
              currency_code: "dkk",
              region_id: defaultRegion.id,
            })

          const paymentSession = await paymentModule.createPaymentSession(
            paymentCollection.id,
            {
              amount: 5001,
              currency_code: "dkk",
              data: {},
              provider_id: "pp_system_default",
            }
          )

          await remoteLink.create([
            {
              [Modules.CART]: {
                cart_id: cart.id,
              },
              [Modules.PAYMENT]: {
                payment_collection_id: paymentCollection.id,
              },
            },
          ])

          await refreshPaymentCollectionForCartWorkflow(appContainer).run({
            input: {
              cart_id: cart.id,
            },
            throwOnError: false,
          })

          const updatedPaymentCollection =
            await paymentModule.retrievePaymentCollection(paymentCollection.id)

          expect(updatedPaymentCollection).toEqual(
            expect.objectContaining({
              id: paymentCollection.id,
              amount: 5000,
            })
          )

          const sessionShouldNotExist = await paymentModule.listPaymentSessions(
            { id: paymentSession.id },
            { withDeleted: true }
          )

          expect(sessionShouldNotExist).toHaveLength(0)
        })

        describe("compensation", () => {
          it("should revert payment collection amount and create a new payment session", async () => {
            const region = await regionModuleService.createRegions({
              name: "US",
              currency_code: "usd",
            })

            const testCart = await cartModuleService.createCarts({
              currency_code: "usd",
              region_id: region.id,
              items: [
                {
                  quantity: 1,
                  unit_price: 5000,
                  title: "Test item",
                },
              ],
            })

            const paymentCollection =
              await paymentModule.createPaymentCollections({
                amount: 5000,
                currency_code: "dkk",
                region_id: defaultRegion.id,
              })

            const paymentSession = await paymentModule.createPaymentSession(
              paymentCollection.id,
              {
                amount: 5000,
                currency_code: "dkk",
                data: {},
                provider_id: "pp_system_default",
              }
            )

            await remoteLink.create([
              {
                [Modules.CART]: {
                  cart_id: testCart.id,
                },
                [Modules.PAYMENT]: {
                  payment_collection_id: paymentCollection.id,
                },
              },
            ])

            const workflow =
              refreshPaymentCollectionForCartWorkflow(appContainer)

            workflow.appendAction("throw", updatePaymentCollectionStepId, {
              invoke: async function failStep() {
                throw new Error(
                  `Failed to do something after updating payment collections`
                )
              },
            })

            const { errors } = await workflow.run({
              input: {
                cart_id: testCart.id,
              },
              throwOnError: false,
            })

            expect(errors).toEqual([
              {
                action: "throw",
                handlerType: "invoke",
                error: expect.objectContaining({
                  message: `Failed to do something after updating payment collections`,
                }),
              },
            ])

            const updatedPaymentCollection =
              await paymentModule.retrievePaymentCollection(
                paymentCollection.id,
                {
                  relations: ["payment_sessions"],
                }
              )

            const sessions = await paymentModule.listPaymentSessions({
              payment_collection_id: paymentCollection.id,
            })

            expect(sessions).toHaveLength(1)
            expect(sessions[0].id).not.toEqual(paymentSession.id)
            expect(sessions[0]).toEqual(
              expect.objectContaining({
                id: expect.any(String),
                amount: 5000,
                currency_code: "dkk",
              })
            )
            expect(updatedPaymentCollection).toEqual(
              expect.objectContaining({
                id: paymentCollection.id,
                amount: 5000,
              })
            )
          })
        })
      })

      describe("AddShippingMethodToCartWorkflow", () => {
        let cart
        let shippingProfile
        let fulfillmentSet
        let priceSet
        let region
        let stockLocation

        beforeEach(async () => {
          region = (
            await api.post(
              "/admin/regions",
              {
                name: "test-region",
                currency_code: "usd",
                countries: ["us"],
              },
              adminHeaders
            )
          ).data.region

          stockLocation = (
            await api.post(
              `/admin/stock-locations`,
              { name: "test location" },
              adminHeaders
            )
          ).data.stock_location

          await api.post(
            `/admin/stock-locations/${stockLocation.id}/sales-channels`,
            { add: [salesChannel.id] },
            adminHeaders
          )

          shippingProfile = (
            await api.post(
              `/admin/shipping-profiles`,
              { name: "Test", type: "default" },
              adminHeaders
            )
          ).data.shipping_profile

          const fulfillmentSets = (
            await api.post(
              `/admin/stock-locations/${stockLocation.id}/fulfillment-sets?fields=*fulfillment_sets`,
              {
                name: "Test",
                type: "test-type",
              },
              adminHeaders
            )
          ).data.stock_location.fulfillment_sets

          fulfillmentSet = (
            await api.post(
              `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
              {
                name: "Test",
                geo_zones: [{ type: "country", country_code: "us" }],
              },
              adminHeaders
            )
          ).data.fulfillment_set

          await api.post(
            `/admin/stock-locations/${stockLocation.id}/fulfillment-providers`,
            { add: ["manual_test-provider"] },
            adminHeaders
          )

          cart = (
            await api.post(
              `/store/carts`,
              {
                currency_code: "usd",
                region_id: region.id,
                sales_channel_id: salesChannel.id,
              },
              storeHeaders
            )
          ).data.cart

          await api.post(
            "/admin/price-preferences",
            {
              attribute: "currency_code",
              value: "usd",
              is_tax_inclusive: true,
            },
            adminHeaders
          )
        })

        it("should add shipping method to cart", async () => {
          const shippingOption = (
            await api.post(
              `/admin/shipping-options`,
              {
                name: "Test shipping option",
                service_zone_id: fulfillmentSet.service_zones[0].id,
                shipping_profile_id: shippingProfile.id,
                provider_id: "manual_test-provider",
                fulfillment_option_id: "manual-fulfillment",
                price_type: "flat",
                type: {
                  label: "Test type",
                  description: "Test description",
                  code: "test-code",
                },
                prices: [{ amount: 3000, currency_code: "usd" }],
                rules: [
                  {
                    operator: RuleOperator.EQ,
                    attribute: "is_return",
                    value: "false",
                  },
                  {
                    operator: RuleOperator.EQ,
                    attribute: "enabled_in_store",
                    value: "true",
                  },
                ],
              },
              adminHeaders
            )
          ).data.shipping_option

          await addShippingMethodToCartWorkflow(appContainer).run({
            input: {
              options: [{ id: shippingOption.id }],
              cart_id: cart.id,
            },
          })

          cart = (await api.get(`/store/carts/${cart.id}`, storeHeaders)).data
            .cart

          expect(cart).toEqual(
            expect.objectContaining({
              id: cart.id,
              currency_code: "usd",
              shipping_methods: [
                expect.objectContaining({
                  amount: 3000,
                  is_tax_inclusive: true,
                }),
              ],
            })
          )
        })

        it("should throw error when shipping option is not valid", async () => {
          const shippingOption = (
            await api.post(
              `/admin/shipping-options`,
              {
                name: "Test shipping option",
                service_zone_id: fulfillmentSet.service_zones[0].id,
                shipping_profile_id: shippingProfile.id,
                fulfillment_option_id: "manual-fulfillment",
                provider_id: "manual_test-provider",
                price_type: "flat",
                type: {
                  label: "Test type",
                  description: "Test description",
                  code: "test-code",
                },
                rules: [
                  {
                    operator: RuleOperator.EQ,
                    attribute: "shipping_address.city",
                    value: "sf",
                  },
                ],
                prices: [{ amount: 3000, currency_code: "usd" }],
              },
              adminHeaders
            )
          ).data.shipping_option

          const { errors } = await addShippingMethodToCartWorkflow(
            appContainer
          ).run({
            input: { options: [{ id: shippingOption.id }], cart_id: cart.id },
            throwOnError: false,
          })

          // Rules are setup only for Germany, this should throw an error
          expect(errors).toEqual([
            expect.objectContaining({
              error: expect.objectContaining({
                message: `Shipping Options are invalid for cart.`,
                type: "invalid_data",
              }),
            }),
          ])
        })

        it("should throw error when shipping option is not present in the db", async () => {
          const { errors } = await addShippingMethodToCartWorkflow(
            appContainer
          ).run({
            input: {
              options: [{ id: "does-not-exist" }],
              cart_id: cart.id,
            },
            throwOnError: false,
          })

          // Rules are setup only for Berlin, this should throw an error
          expect(errors).toEqual([
            expect.objectContaining({
              error: expect.objectContaining({
                message: "Shipping Options are invalid for cart.",
                type: "invalid_data",
              }),
            }),
          ])
        })

        it("should add shipping method with custom data", async () => {
          const shippingOption = (
            await api.post(
              `/admin/shipping-options`,
              {
                name: "Test shipping option",
                service_zone_id: fulfillmentSet.service_zones[0].id,
                shipping_profile_id: shippingProfile.id,
                provider_id: "manual_test-provider",
                fulfillment_option_id: "manual-fulfillment",
                price_type: "flat",
                type: {
                  label: "Test type",
                  description: "Test description",
                  code: "test-code",
                },
                rules: [
                  {
                    operator: RuleOperator.EQ,
                    attribute: "is_return",
                    value: "false",
                  },
                  {
                    operator: RuleOperator.EQ,
                    attribute: "enabled_in_store",
                    value: "true",
                  },
                ],
                prices: [{ amount: 3000, currency_code: "usd" }],
              },
              adminHeaders
            )
          ).data.shipping_option

          await addShippingMethodToCartWorkflow(appContainer).run({
            input: {
              options: [{ id: shippingOption.id, data: { test: "test" } }],
              cart_id: cart.id,
            },
          })

          cart = (
            await api.get(
              `/store/carts/${cart.id}?fields=+shipping_methods.data`,
              storeHeaders
            )
          ).data.cart

          expect(cart).toEqual(
            expect.objectContaining({
              id: cart.id,
              shipping_methods: [
                expect.objectContaining({
                  amount: 3000,
                  is_tax_inclusive: true,
                  data: { test: "test" },
                  shipping_option_id: shippingOption.id,
                }),
              ],
            })
          )
        })
      })

      describe("listShippingOptionsForCartWorkflow", () => {
        let cart
        let shippingProfile
        let fulfillmentSet
        let region
        let stockLocation

        beforeEach(async () => {
          region = (
            await api.post(
              "/admin/regions",
              {
                name: "test-region",
                currency_code: "usd",
                countries: ["us"],
              },
              adminHeaders
            )
          ).data.region

          stockLocation = (
            await api.post(
              `/admin/stock-locations`,
              { name: "test location" },
              adminHeaders
            )
          ).data.stock_location

          await api.post(
            `/admin/stock-locations/${stockLocation.id}/sales-channels`,
            { add: [salesChannel.id] },
            adminHeaders
          )

          shippingProfile = (
            await api.post(
              `/admin/shipping-profiles`,
              { name: "Test", type: "default" },
              adminHeaders
            )
          ).data.shipping_profile

          const fulfillmentSets = (
            await api.post(
              `/admin/stock-locations/${stockLocation.id}/fulfillment-sets?fields=*fulfillment_sets`,
              {
                name: "Test",
                type: "test-type",
              },
              adminHeaders
            )
          ).data.stock_location.fulfillment_sets

          fulfillmentSet = (
            await api.post(
              `/admin/fulfillment-sets/${fulfillmentSets[0].id}/service-zones`,
              {
                name: "Test",
                geo_zones: [{ type: "country", country_code: "us" }],
              },
              adminHeaders
            )
          ).data.fulfillment_set

          await api.post(
            `/admin/stock-locations/${stockLocation.id}/fulfillment-providers`,
            { add: ["manual_test-provider"] },
            adminHeaders
          )

          cart = (
            await api.post(
              `/store/carts`,
              {
                currency_code: "usd",
                region_id: region.id,
                sales_channel_id: salesChannel.id,
              },
              storeHeaders
            )
          ).data.cart

          await api.post(
            "/admin/price-preferences",
            {
              attribute: "currency_code",
              value: "usd",
              is_tax_inclusive: true,
            },
            adminHeaders
          )
        })

        it("should list shipping options for cart", async () => {
          const shippingOption = (
            await api.post(
              `/admin/shipping-options`,
              {
                name: "Test shipping option",
                service_zone_id: fulfillmentSet.service_zones[0].id,
                shipping_profile_id: shippingProfile.id,
                provider_id: "manual_test-provider",
                fulfillment_option_id: "manual-fulfillment",
                price_type: "flat",
                type: {
                  label: "Test type",
                  description: "Test description",
                  code: "test-code",
                },
                prices: [
                  {
                    amount: 3000,
                    currency_code: "usd",
                  },
                ],
                rules: [
                  {
                    operator: RuleOperator.EQ,
                    attribute: "is_return",
                    value: "false",
                  },
                  {
                    operator: RuleOperator.EQ,
                    attribute: "enabled_in_store",
                    value: "true",
                  },
                ],
              },
              adminHeaders
            )
          ).data.shipping_option

          cart = (await api.get(`/store/carts/${cart.id}`, storeHeaders)).data
            .cart

          const { result } = await listShippingOptionsForCartWorkflow(
            appContainer
          ).run({ input: { cart_id: cart.id } })

          expect(result).toEqual([
            expect.objectContaining({
              amount: 3000,
              id: shippingOption.id,
            }),
          ])
        })

        it("should exclude return shipping options for cart by default", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          let cart = await cartModuleService.createCarts({
            currency_code: "usd",
            region_id: region.id,
            sales_channel_id: salesChannel.id,
            shipping_address: {
              country_code: "us",
            },
          })

          const shippingOption = await fulfillmentModule.createShippingOptions([
            {
              name: "Return shipping option",
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_test-provider",
              rules: [
                {
                  operator: RuleOperator.EQ,
                  attribute: "is_return",
                  value: "true",
                },
              ],
              price_type: "flat",
              type: {
                label: "Test type",
                description: "Test description",
                code: "test-code",
              },
            },
            {
              name: "Test shipping option",
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_test-provider",
              price_type: "flat",
              type: {
                label: "Test type",
                description: "Test description",
                code: "test-code",
              },
            },
          ])

          const priceSet = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          const priceSetTwo = await pricingModule.createPriceSets({
            prices: [
              {
                amount: 3000,
                currency_code: "usd",
              },
            ],
          })

          await remoteLink.create([
            {
              [Modules.SALES_CHANNEL]: {
                sales_channel_id: salesChannel.id,
              },
              [Modules.STOCK_LOCATION]: {
                stock_location_id: stockLocation.id,
              },
            },
            {
              [Modules.STOCK_LOCATION]: {
                stock_location_id: stockLocation.id,
              },
              [Modules.FULFILLMENT]: {
                fulfillment_set_id: fulfillmentSet.id,
              },
            },
            {
              [Modules.FULFILLMENT]: {
                shipping_option_id: shippingOption.find(
                  (o) => o.name === "Test shipping option"
                )?.id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSet.id,
              },
            },
            {
              [Modules.FULFILLMENT]: {
                shipping_option_id: shippingOption.find(
                  (o) => o.name === "Return shipping option"
                )?.id,
              },
              [Modules.PRICING]: {
                price_set_id: priceSetTwo.id,
              },
            },
          ])

          cart = await cartModuleService.retrieveCart(cart.id, {
            select: ["id"],
            relations: ["shipping_address"],
          })

          const { result } = await listShippingOptionsForCartWorkflow(
            appContainer
          ).run({
            input: {
              cart_id: cart.id,
            },
          })

          expect(result.length).toEqual(1)
          expect(result).toEqual([
            expect.objectContaining({
              name: "Test shipping option",
            }),
          ])
        })

        it("should list no shipping options for cart, if sales channel is not associated with location", async () => {
          const salesChannel = await scModuleService.createSalesChannels({
            name: "Webshop",
          })

          await api.post(
            `/store/carts/${cart.id}`,
            { sales_channel_id: salesChannel.id },
            storeHeaders
          )

          await api.post(
            `/admin/shipping-options`,
            {
              name: "Test shipping option",
              service_zone_id: fulfillmentSet.service_zones[0].id,
              shipping_profile_id: shippingProfile.id,
              provider_id: "manual_test-provider",
              fulfillment_option_id: "manual-fulfillment",
              price_type: "flat",
              type: {
                label: "Test type",
                description: "Test description",
                code: "test-code",
              },
              prices: [
                {
                  amount: 3000,
                  currency_code: "usd",
                },
              ],
              rules: [
                {
                  operator: RuleOperator.EQ,
                  attribute: "is_return",
                  value: "false",
                },
                {
                  operator: RuleOperator.EQ,
                  attribute: "enabled_in_store",
                  value: "true",
                },
              ],
            },
            adminHeaders
          )

          cart = (await api.get(`/store/carts/${cart.id}`, storeHeaders)).data
            .cart

          const { result } = await listShippingOptionsForCartWorkflow(
            appContainer
          ).run({
            input: { cart_id: cart.id },
          })

          expect(result).toEqual([])
        })
      })

      describe("updateTaxLinesWorkflow", () => {
        it("should include shipping address metadata in tax calculation context", async () => {
          const cart = await cartModuleService.createCarts({
            currency_code: "dkk",
            region_id: defaultRegion.id,
            shipping_address: {
              metadata: {
                testing_tax: true,
              },
            },
            items: [
              {
                quantity: 1,
                unit_price: 5000,
                title: "Test item",
              },
            ],
          })

          const { transaction } = await updateTaxLinesWorkflow(
            appContainer
          ).run({
            input: {
              cart_id: cart.id,
            },
            throwOnError: false,
          })

          expect(
            // @ts-ignore
            transaction.context.invoke["use-remote-query"].output.output
              .shipping_address.metadata
          ).toEqual({
            testing_tax: true,
          })
        })
      })
    })
  },
})
