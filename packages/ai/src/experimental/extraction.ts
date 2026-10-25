import { Effect, Schema } from "effect"
import { ExtractionClient, Service } from "./extraction-client.js"
import { MediaModel, tryRequest } from "../media-model.js"
import type { MediaRoute } from "../route/media.js"
import { AIError, HttpOptions, ProviderMetadata, ProviderOptions, Usage } from "../schema/index.js"

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const FieldBase = {
  instructions: Schema.optional(Schema.String),
  /** Probability of null above which the value is null; the host's default is 0.5. */
  nullThreshold: Schema.optional(Schema.Number),
}

/** An ISO date bounds a date estimate; anything else is numeric. */
const NumberOrDate = Schema.Union([Schema.Number, Schema.String])

const RangeBase = {
  ...FieldBase,
  min: NumberOrDate,
  max: NumberOrDate,
  unit: Schema.optional(Schema.String),
  /** Grid step: a number (days for date estimates), `"month"` or `"year"`. */
  step: Schema.optional(NumberOrDate),
  scale: Schema.optional(Schema.Literals(["linear", "log"])),
}

const TextField = Schema.Struct({ type: Schema.Literal("text"), ...FieldBase })
const NumberField = Schema.Struct({
  type: Schema.Literal("number"),
  ...FieldBase,
  unit: Schema.optional(Schema.String),
  integer: Schema.optional(Schema.Boolean),
  decimals: Schema.optional(Schema.Int),
})
const DateField = Schema.Struct({ type: Schema.Literal("date"), ...FieldBase })
const TimeField = Schema.Struct({ type: Schema.Literal("time"), ...FieldBase })
const DateTimeField = Schema.Struct({ type: Schema.Literal("datetime"), ...FieldBase })
const DurationField = Schema.Struct({
  type: Schema.Literal("duration"),
  ...FieldBase,
  /** `seconds` (the default), `minutes`, `hours`, `days`, `weeks`, `months` or `years`. */
  unit: Schema.optional(Schema.String),
  integer: Schema.optional(Schema.Boolean),
  decimals: Schema.optional(Schema.Int),
})
const ListField = Schema.Struct({
  type: Schema.Literal("list"),
  ...FieldBase,
  items: Schema.Literals(["text", "number", "date"]),
  decimals: Schema.optional(Schema.Int),
})
/** A distribution over a range, such as days until an invoice is paid. */
const EstimateField = Schema.Struct({ type: Schema.Literal("estimate"), ...RangeBase })
/** One estimate per step of a series. */
const ForecastField = Schema.Struct({
  type: Schema.Literal("forecast"),
  ...RangeBase,
  horizon: Schema.optional(Schema.Int),
  interval: Schema.optional(Schema.String),
})

export const ExtractionField = Schema.Union([
  TextField,
  NumberField,
  DateField,
  TimeField,
  DateTimeField,
  DurationField,
  ListField,
  EstimateField,
  ForecastField,
]).pipe(Schema.toTaggedUnion("type"))
export type ExtractionField = Schema.Schema.Type<typeof ExtractionField>
export type ExtractionFields = Readonly<Record<string, ExtractionField>>

const ExtractionFieldMap = Schema.Record(Schema.String, ExtractionField).pipe(
  Schema.refine((x): x is typeof x => Object.keys(x).length > 0, { message: "Extraction fields must not be empty" }),
)

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** `[start, end)` character offsets into `input`. */
const Span = Schema.Tuple([Schema.Int, Schema.Int])

/** `value` is null when the input does not determine it; `guess` is the most likely value either way. */
const ValueAnswerBase = <Value extends Schema.Top>(value: Value) => ({
  value: Schema.NullOr(value),
  guess: Schema.optional(value),
  nullProbability: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
})

const TextAnswer = Schema.Struct({
  type: Schema.Literal("text"),
  ...ValueAnswerBase(Schema.String),
  span: Schema.optional(Span),
})
const NumberAnswer = Schema.Struct({ type: Schema.Literal("number"), ...ValueAnswerBase(Schema.Number) })
const DateAnswer = Schema.Struct({ type: Schema.Literal("date"), ...ValueAnswerBase(Schema.String) })
const TimeAnswer = Schema.Struct({ type: Schema.Literal("time"), ...ValueAnswerBase(Schema.String) })
const DateTimeAnswer = Schema.Struct({ type: Schema.Literal("datetime"), ...ValueAnswerBase(Schema.String) })
const DurationAnswer = Schema.Struct({
  type: Schema.Literal("duration"),
  ...ValueAnswerBase(Schema.Number),
  unit: Schema.optional(Schema.String),
})
const ListAnswer = Schema.Struct({
  type: Schema.Literal("list"),
  value: Schema.NullOr(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
  spans: Schema.optional(Schema.Array(Span)),
  confidences: Schema.optional(Schema.Array(Schema.Number)),
  confidence: Schema.optional(Schema.Number),
})

/** `value` is the most likely point; `p10` to `p90` is the 80% interval. */
const EstimateStats = Schema.Struct({
  value: NumberOrDate,
  mean: Schema.optional(NumberOrDate),
  median: NumberOrDate,
  p10: NumberOrDate,
  p90: NumberOrDate,
  belowProbability: Schema.optional(Schema.Number),
  aboveProbability: Schema.optional(Schema.Number),
  quantiles: Schema.optional(Schema.Array(NumberOrDate)),
})
const EstimateAnswer = Schema.Struct({ type: Schema.Literal("estimate"), ...EstimateStats.fields })
const ForecastAnswer = Schema.Struct({
  type: Schema.Literal("forecast"),
  value: Schema.Array(NumberOrDate),
  steps: Schema.Array(EstimateStats),
})

export const ExtractionAnswer = Schema.Union([
  TextAnswer,
  NumberAnswer,
  DateAnswer,
  TimeAnswer,
  DateTimeAnswer,
  DurationAnswer,
  ListAnswer,
  EstimateAnswer,
  ForecastAnswer,
]).pipe(Schema.toTaggedUnion("type"))
export type ExtractionAnswer = Schema.Schema.Type<typeof ExtractionAnswer>

type ListAnswerOf<Item> = Omit<typeof ListAnswer.Type, "value"> & { readonly value: ReadonlyArray<Item> | null }

export type ExtractionAnswerFor<Field extends ExtractionField> = Field extends { readonly type: "list" }
  ? ListAnswerOf<Field extends { readonly items: "number" } ? number : string>
  : Extract<ExtractionAnswer, { readonly type: Field["type"] }>

/** One answer per field, keyed by field name. */
export type ExtractionAnswersFor<Fields extends ExtractionFields> = {
  readonly [Name in keyof Fields]: ExtractionAnswerFor<Fields[Name]>
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ExtractionOptions = MediaModel.Options

export type ExtractionRoute = MediaRoute.InlineRoute<ExtractionRequestFor, ExtractionResponse>

export class ExtractionModel<Options extends ExtractionOptions = ExtractionOptions> extends MediaModel<
  ExtractionRoute,
  Options
> {
  declare protected readonly _ExtractionModel: void
}

export const ExtractionModelSchema = Schema.declare(
  (value): value is ExtractionModel => value instanceof ExtractionModel,
  { expected: "Extraction.Model" },
)

export type ExtractionModelOptions<Model> = Model extends ExtractionModel<infer Options> ? Options : never

// ---------------------------------------------------------------------------
// Request and response
// ---------------------------------------------------------------------------

export class ExtractionRequest extends Schema.Class<ExtractionRequest>("Extraction.Request")({
  model: ExtractionModelSchema,
  /** The text to read; text answers carry spans into it. */
  input: Schema.String,
  fields: ExtractionFieldMap,
  /** ISO date that anchors dates written without a year. */
  referenceDate: Schema.optional(Schema.String),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _ExtractionRequest: void
}

export type ExtractionRequestFor<
  Options extends ExtractionOptions = ExtractionOptions,
  Fields extends ExtractionFields = ExtractionFields,
> = Omit<ExtractionRequest, "model" | "fields" | "providerOptions"> & {
  readonly model: ExtractionModel<Options>
  readonly fields: Fields
  readonly providerOptions?: Options
}

export type ExtractionRequestInput<
  Model extends ExtractionModel = ExtractionModel,
  Fields extends ExtractionFields = ExtractionFields,
> = {
  readonly model: Model
  readonly input: string
  readonly fields: Fields
  readonly referenceDate?: string
  readonly providerOptions?: NoInfer<ExtractionModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

export class ExtractionResponse extends Schema.Class<ExtractionResponse>("Extraction.Response")({
  answers: Schema.Record(Schema.String, ExtractionAnswer),
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export type ExtractionResponseFor<Fields extends ExtractionFields> = Omit<ExtractionResponse, "answers"> & {
  readonly answers: ExtractionAnswersFor<Fields>
}

// ---------------------------------------------------------------------------
// Call API
// ---------------------------------------------------------------------------

export function request<const Model extends ExtractionModel, const Fields extends ExtractionFields>(
  input: ExtractionRequestInput<Model, Fields>,
): ExtractionRequestFor<ExtractionModelOptions<Model>, Fields>
export function request(input: ExtractionRequest): ExtractionRequest
export function request(input: ExtractionRequest | ExtractionRequestInput): ExtractionRequest
export function request(input: ExtractionRequest | ExtractionRequestInput) {
  if (input instanceof ExtractionRequest) return input
  return new ExtractionRequest({ ...input, http: HttpOptions.make(input.http) })
}

export function generate<const Model extends ExtractionModel, const Fields extends ExtractionFields>(
  input: ExtractionRequestInput<Model, Fields>,
): Effect.Effect<ExtractionResponseFor<Fields>, AIError, Service>
export function generate(input: ExtractionRequest): Effect.Effect<ExtractionResponse, AIError, Service>
export function generate(input: ExtractionRequest | ExtractionRequestInput) {
  return tryRequest(() => request(input)).pipe(Effect.flatMap(ExtractionClient.generate))
}

export const Extraction = {
  request,
  generate,
} as const
