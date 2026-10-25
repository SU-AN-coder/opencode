import { Context, Effect, Layer } from "effect"
import type {
  ExtractionAnswer,
  ExtractionFields,
  ExtractionOptions,
  ExtractionRequestFor,
  ExtractionResponseFor,
} from "./extraction.js"
import { RequestExecutor } from "../route/executor.js"
import { AIError, InvalidProviderOutputError } from "../schema/index.js"

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

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    return Service.of({
      generate: Effect.fnUntraced(function* (request) {
        const route = request.model.route
        const response = yield* route.generate(request, executor.execute)
        if (answersMatch(request.fields, response.answers))
          return response as ExtractionResponseFor<typeof request.fields>
        return yield* new AIError({
          reason: new InvalidProviderOutputError({
            route: route.id,
            message: "Extraction answers do not match the requested fields",
            cause: response.answers,
          }),
        })
      }),
    })
  }),
)
export const fetchLayer = layer.pipe(Layer.provideMerge(RequestExecutor.fetchLayer))

/** Host bugs (a missing answer, an answer of another type, list items of another type) fail the whole call. */
const answersMatch = (fields: ExtractionFields, answers: Readonly<Record<string, ExtractionAnswer>>) =>
  Object.entries(fields).every(([name, field]) => {
    const answer = answers[name]
    if (answer?.type !== field.type) return false
    if (field.type !== "list" || answer.type !== "list" || answer.value === null) return true
    const item = field.items === "number" ? "number" : "string"
    return answer.value.every((value) => typeof value === item)
  })

export const ExtractionClient = {
  Service,
  layer,
  fetchLayer,
  generate,
} as const
