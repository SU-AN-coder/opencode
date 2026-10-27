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
