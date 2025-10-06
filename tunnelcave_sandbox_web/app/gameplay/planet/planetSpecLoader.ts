export interface PlanetSpec {
  readonly seed: number
  readonly radii: readonly number[]
  readonly frequencies: readonly number[]
  readonly amplitudes: readonly number[]
  readonly lodThresholds: readonly number[]
}

export interface PlanetNoiseLayer {
  readonly frequency: number
  readonly amplitude: number
}

export interface PlanetConfiguration {
  readonly seed: number
  readonly radii: readonly number[]
  readonly noiseLayers: readonly PlanetNoiseLayer[]
  readonly lodThresholds: readonly number[]
}

export interface FetchResponseLike {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<FetchResponseLike>

export class PlanetSpecValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PlanetSpecValidationError'
  }
}

function ensureRecord(value: unknown): Record<string, unknown> {
  //1.- Confirm the payload is an object literal before attempting to read its properties.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlanetSpecValidationError('PlanetSpec must be a JSON object')
  }
  return value as Record<string, unknown>
}

function ensureNumber(value: unknown, field: string): number {
  //1.- Promote numeric fields into deterministic floating point values.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PlanetSpecValidationError(`${field} must be a finite number`)
  }
  return value
}

function ensureNumberArray(value: unknown, field: string): number[] {
  //1.- Validate that the provided collection is an array of finite numbers ready for GPU uploads.
  if (!Array.isArray(value)) {
    throw new PlanetSpecValidationError(`${field} must be an array of numbers`)
  }
  //2.- Copy elements into a fresh list so downstream callers cannot mutate the source reference.
  const numbers = value.map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new PlanetSpecValidationError(`${field}[${index}] must be a finite number`)
    }
    return entry
  })
  if (numbers.length === 0) {
    throw new PlanetSpecValidationError(`${field} requires at least one value`)
  }
  return numbers
}

export function parsePlanetSpec(raw: unknown): PlanetSpec {
  //1.- Convert untyped JSON into a strongly-typed record for validation.
  const record = ensureRecord(raw)
  const seed = ensureNumber(record.seed, 'seed')
  const radii = ensureNumberArray(record.radii, 'radii')
  const frequencies = ensureNumberArray(record.frequencies, 'frequencies')
  const amplitudes = ensureNumberArray(record.amplitudes, 'amplitudes')
  const lodThresholds = ensureNumberArray(record.lodThresholds, 'lodThresholds')
  //2.- Guarantee that noise parameters remain paired by length to avoid runtime mismatches during FBM evaluation.
  if (frequencies.length !== amplitudes.length) {
    throw new PlanetSpecValidationError('frequencies and amplitudes must have matching lengths')
  }
  return {
    seed,
    radii: Object.freeze([...radii]),
    frequencies: Object.freeze([...frequencies]),
    amplitudes: Object.freeze([...amplitudes]),
    lodThresholds: Object.freeze([...lodThresholds]),
  }
}

export function createPlanetConfiguration(spec: PlanetSpec): PlanetConfiguration {
  //1.- Bundle paired noise parameters into ready-to-sample layers for the displacement pipeline.
  const noiseLayers = spec.frequencies.map((frequency, index) =>
    Object.freeze({
      frequency,
      amplitude: spec.amplitudes[index],
    })
  )
  //2.- Freeze each slice so consumers receive immutable views across render and worker threads.
  return {
    seed: spec.seed,
    radii: spec.radii,
    noiseLayers: Object.freeze(noiseLayers),
    lodThresholds: spec.lodThresholds,
  }
}

export function loadPlanetConfigurationFromJson(json: string): PlanetConfiguration {
  //1.- Parse the text payload so syntax errors surface as validation feedback.
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new PlanetSpecValidationError('Unable to parse PlanetSpec JSON', { cause: error })
  }
  //2.- Delegate to the typed conversion routines to reuse the validation rules.
  const spec = parsePlanetSpec(parsed)
  return createPlanetConfiguration(spec)
}

export async function loadPlanetConfiguration(
  url: string,
  fetcher?: FetchLike
): Promise<PlanetConfiguration> {
  //1.- Resolve the fetch implementation from the caller or fall back to the runtime global.
  const activeFetcher = fetcher ?? (globalThis.fetch as FetchLike | undefined)
  if (!activeFetcher) {
    throw new PlanetSpecValidationError('A fetch implementation is required to load a PlanetSpec')
  }
  //2.- Retrieve the JSON file and bubble up HTTP failures with contextual diagnostics.
  const response = await activeFetcher(url)
  if (!response.ok) {
    throw new PlanetSpecValidationError(
      `Failed to load PlanetSpec from ${url}: ${response.status} ${response.statusText}`
    )
  }
  //3.- Convert the remote payload into the immutable configuration bundle shared by the planet systems.
  const raw = await response.json()
  const spec = parsePlanetSpec(raw)
  return createPlanetConfiguration(spec)
}
