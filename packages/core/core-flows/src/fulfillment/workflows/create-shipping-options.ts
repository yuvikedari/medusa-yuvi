import { FulfillmentWorkflow } from "@medusajs/framework/types"
import {
  createWorkflow,
  parallelize,
  transform,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import {
  createShippingOptionsPriceSetsStep,
  upsertShippingOptionsStep,
} from "../steps"
import { setShippingOptionsPriceSetsStep } from "../steps/set-shipping-options-price-sets"
import { validateFulfillmentProvidersStep } from "../steps/validate-fulfillment-providers"
import { validateShippingOptionPricesStep } from "../steps/validate-shipping-option-prices"
import { getFulfillmentOptionsForProviderStep } from "../steps/get-fulfillment-options-for-provider"

export const createShippingOptionsWorkflowId =
  "create-shipping-options-workflow"
/**
 * This workflow creates one or more shipping options.
 */
export const createShippingOptionsWorkflow = createWorkflow(
  createShippingOptionsWorkflowId,
  (
    input: WorkflowData<
      FulfillmentWorkflow.CreateShippingOptionsWorkflowInput[]
    >
  ): WorkflowResponse<FulfillmentWorkflow.CreateShippingOptionsWorkflowOutput> => {
    const providerIds = transform(input, (data) => {
      return data.map((option) => option.provider_id)
    })

    const [, , providerOptions] = parallelize(
      validateFulfillmentProvidersStep(input),
      validateShippingOptionPricesStep(input),
      getFulfillmentOptionsForProviderStep(providerIds)
    )

    const data = transform(
      { input, providerOptions },
      ({ input, providerOptions }) => {
        const shippingOptionsIndexToPrices = input.map((option, index) => {
          /**
           * Flat rate ShippingOptions always needs to provide a price array.
           *
           * For calculated pricing we create an "empty" price set
           * so we can have simpler update flow for both cases and allow updating price_type.
           */
          const prices = (option as any).prices ?? []

          const fulfillmentOption = providerOptions
            .find(
              (providerOption) =>
                providerOption.provider_id === option.provider_id
            )
            ?.options.find((o) => o.id === option.fulfillment_option_id)

          if (!fulfillmentOption) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Fulfillment option with id ${option.fulfillment_option_id} not found for provider ${option.provider_id}`
            )
          }

          option.data = {
            ...(option.data ?? {}),
            fulfillment_option_data: fulfillmentOption,
          }

          delete (option as any).fulfillment_option_id

          return {
            shipping_option_index: index,
            prices,
          }
        })

        return {
          shippingOptions: input,
          shippingOptionsIndexToPrices,
        }
      }
    )

    const createdShippingOptions = upsertShippingOptionsStep(
      data.shippingOptions
    )

    const normalizedShippingOptionsPrices = transform(
      {
        shippingOptions: createdShippingOptions,
        shippingOptionsIndexToPrices: data.shippingOptionsIndexToPrices,
      },
      (data) => {
        const shippingOptionsPrices = data.shippingOptionsIndexToPrices.map(
          ({ shipping_option_index, prices }) => {
            return {
              id: data.shippingOptions[shipping_option_index].id,
              prices,
            }
          }
        )

        return {
          shippingOptionsPrices,
        }
      }
    )

    const shippingOptionsPriceSetsLinkData = createShippingOptionsPriceSetsStep(
      normalizedShippingOptionsPrices.shippingOptionsPrices
    )

    const normalizedLinkData = transform(
      {
        shippingOptionsPriceSetsLinkData,
      },
      (data) => {
        return data.shippingOptionsPriceSetsLinkData.map((item) => {
          return {
            id: item.id,
            price_sets: [item.priceSetId],
          }
        })
      }
    )

    setShippingOptionsPriceSetsStep(normalizedLinkData)
    return new WorkflowResponse(createdShippingOptions)
  }
)
