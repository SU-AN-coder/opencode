import { describe, expect, test } from "bun:test"
import { connectedToast } from "./connected-toast"

const translate = (key: string, params: { provider: string }) =>
  key.endsWith("title") ? `${params.provider} connected` : `${params.provider} models are now available to use.`

describe("connected toast", () => {
  test("does not talk about models when the integration offers none", () => {
    expect(connectedToast({ provider: "Firecrawl", models: 0, translate })).toEqual({ title: "Firecrawl connected" })
  })

  test("keeps the models line for an integration that offers them", () => {
    expect(connectedToast({ provider: "Anthropic", models: 12, translate })).toEqual({
      title: "Anthropic connected",
      description: "Anthropic models are now available to use.",
    })
  })
})
