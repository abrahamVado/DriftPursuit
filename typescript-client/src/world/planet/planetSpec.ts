export interface NoiseLayerSpec {
  //1.- Describe the spectral characteristics for a single fractal octave.
  frequency: number;
  //2.- Amplitude scales the contribution of this octave to the displacement field.
  amplitude: number;
}

export interface PlanetSpec {
  //1.- Core planet radius forming the base sphere before displacements.
  radius: number;
  //2.- Height of the atmosphere shell above the reference radius.
  atmosphereHeight: number;
  //3.- Elevation below which points are flooded and rendered as ocean.
  seaLevel: number;
  //4.- Seed ensures reproducible noise sampling and streaming layout.
  seed: number;
  //5.- Fractal noise layers used to compute the radial displacement.
  displacementLayers: NoiseLayerSpec[];
  //6.- Low frequency temperature field controls biome selection.
  temperatureFrequency: number;
  //7.- Low frequency moisture field controls biome selection.
  moistureFrequency: number;
  //8.- Screen space error thresholds for quadtree refinement per LOD.
  lodScreenError: number[];
  //9.- Desired number of blue-noise instances per tile at each LOD.
  scatterBudgetPerLod: number[];
}

export function parsePlanetSpec(json: unknown): PlanetSpec {
  //1.- Validate the runtime structure to guard against malformed configuration blobs.
  if (typeof json !== "object" || json === null) {
    throw new Error("Planet spec must be an object");
  }
  const spec = json as Record<string, unknown>;
  const radius = Number(spec.radius);
  const atmosphereHeight = Number(spec.atmosphereHeight);
  const seaLevel = Number(spec.seaLevel);
  const seed = Number(spec.seed);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error("Planet radius must be a positive number");
  }
  if (!Number.isFinite(atmosphereHeight) || atmosphereHeight <= 0) {
    throw new Error("Atmosphere height must be a positive number");
  }
  if (!Number.isFinite(seaLevel)) {
    throw new Error("Sea level must be a finite number");
  }
  if (!Number.isFinite(seed)) {
    throw new Error("Seed must be a finite number");
  }
  const displacementLayers = Array.isArray(spec.displacementLayers)
    ? spec.displacementLayers.map((layer) => {
        if (typeof layer !== "object" || layer === null) {
          throw new Error("Displacement layer must be an object");
        }
        const frequency = Number((layer as Record<string, unknown>).frequency);
        const amplitude = Number((layer as Record<string, unknown>).amplitude);
        if (!Number.isFinite(frequency) || frequency <= 0) {
          throw new Error("Displacement frequency must be a positive number");
        }
        if (!Number.isFinite(amplitude)) {
          throw new Error("Displacement amplitude must be finite");
        }
        return { frequency, amplitude } satisfies NoiseLayerSpec;
      })
    : [];
  if (displacementLayers.length === 0) {
    throw new Error("At least one displacement layer is required");
  }
  const temperatureFrequency = Number(spec.temperatureFrequency);
  const moistureFrequency = Number(spec.moistureFrequency);
  if (!Number.isFinite(temperatureFrequency) || temperatureFrequency <= 0) {
    throw new Error("Temperature frequency must be positive");
  }
  if (!Number.isFinite(moistureFrequency) || moistureFrequency <= 0) {
    throw new Error("Moisture frequency must be positive");
  }
  const lodScreenError = Array.isArray(spec.lodScreenError)
    ? spec.lodScreenError.map((value) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) {
          throw new Error("LOD screen error values must be positive numbers");
        }
        return num;
      })
    : [];
  if (lodScreenError.length === 0) {
    throw new Error("At least one LOD screen error threshold is required");
  }
  const scatterBudgetPerLod = Array.isArray(spec.scatterBudgetPerLod)
    ? spec.scatterBudgetPerLod.map((value) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          throw new Error("Scatter budget values must be non-negative numbers");
        }
        return num;
      })
    : [];
  if (scatterBudgetPerLod.length !== lodScreenError.length) {
    throw new Error("Scatter budget entries must match LOD thresholds");
  }
  return {
    radius,
    atmosphereHeight,
    seaLevel,
    seed,
    displacementLayers,
    temperatureFrequency,
    moistureFrequency,
    lodScreenError,
    scatterBudgetPerLod,
  } satisfies PlanetSpec;
}
