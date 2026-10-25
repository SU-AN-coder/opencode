import { Context, Effect, Layer } from "effect"
import type { ExtractionFields, ExtractionOptions, ExtractionRequestFor, ExtractionResponseFor } from "./extraction.js"
import { RequestExecutor } from "../route/executor.js"
import type { AIError } from "../schema/index.js"

export interface Interface {
  readonly generate: <Options extends ExtractionOptions, const Fields extends ExtractionFields>(
    request: ExtractionRequestFor<Options, Fields>,
  ) => Effect.Effect<ExtractionResponseFor<Fields>, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/ExtractionClient") {}

export const generate = <Options extends ExtractionOptions, const Fields extends ExtractionFields>(
  request: ExtractionRequestFor<Options, Fields>,
): Effect.Effect<ExtractionResponseFor<Fields>, AIError, Service> =>
  Effect.flatMap(Service, (client) => client.generate(request))

// Routes decode one answer per requested field, typed by that field, so the response matches `Fields`.
export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    return Service.of({
      generate: (request) =>
        request.model.route
          .generate(request, executor.execute)
          .pipe(Effect.map((response) => response as ExtractionResponseFor<typeof request.fields>)),
    })
  }),
)
export const fetchLayer = layer.pipe(Layer.provideMerge(RequestExecutor.fetchLayer))

export const ExtractionClient = {
  Service,
  layer,
  fetchLayer,
  generate,
} as const
