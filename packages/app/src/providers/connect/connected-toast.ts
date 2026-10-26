// The connect dialog used to end with "{{provider}} models are now available to use." for every integration. A
// non-inference integration (Firecrawl, Exa, a search or scraping tool) offers no models, so that line was wrong
// there; the ones that do offer models keep it. The rest of the dialog is unchanged (#59141).
export type ConnectedKey =
  | "provider.connect.toast.connected.title"
  | "provider.connect.toast.connected.description"

export function connectedToast(input: {
  readonly provider: string
  readonly models: number
  readonly translate: (key: ConnectedKey, params: { provider: string }) => string
}) {
  const title = input.translate("provider.connect.toast.connected.title", { provider: input.provider })

  if (input.models === 0) return { title }

  return { title, description: input.translate("provider.connect.toast.connected.description", { provider: input.provider }) }
}
