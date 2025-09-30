export function createTerrainMesh({
  chunkX,
  chunkY,
  chunkSize,
  generatorConfig,
  sampleHeight,
  sampleColor,
  volcano,
  noise,
  THREE,
}){
  const detailScale = generatorConfig?.perf?.meshDetail ?? 1.0;
  const baseRes = 64;
  const resolution = Math.max(8, Math.round(baseRes * detailScale));
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, resolution, resolution);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const positions = geometry.attributes.position;
  const chunkOriginX = chunkX * chunkSize;
  const chunkOriginY = chunkY * chunkSize;

  for (let i = 0; i < positions.count; i += 1){
    const localX = positions.getX(i);
    const localY = positions.getY(i);
    const worldX = chunkOriginX + localX;
    const worldY = chunkOriginY + localY;
    const height = sampleHeight(worldX, worldY);
    positions.setZ(i, height);

    const colorIndex = i * 3;
    const color = sampleColor(worldX, worldY, height);
    colors[colorIndex] = color.r;
    colors[colorIndex + 1] = color.g;
    colors[colorIndex + 2] = color.b;
  }

  if (volcano?.enabled && Array.isArray(volcano.center) && volcano.center.length >= 2){
    const cx = volcano.center[0] ?? 0;
    const cy = volcano.center[1] ?? 0;
    const rc = volcano.craterRadius ?? 220;
    const band = rc * 0.18;
    const f = volcano.noise?.frequency ?? 0.0028;
    const amp = (volcano.noise?.amplitude ?? 65) * 0.5;
    for (let i = 0; i < positions.count; i += 1){
      const lx = positions.getX(i);
      const ly = positions.getY(i);
      const wx = chunkOriginX + lx;
      const wy = chunkOriginY + ly;
      const r = Math.hypot(wx - cx, wy - cy);
      const d = Math.abs(r - rc);
      if (d < band){
        const k = 1 - d / band;
        const jag = (noise.perlin2(wx * f, wy * f) * 2 - 1) * amp * k;
        positions.setZ(i, positions.getZ(i) + jag);
      }
    }
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.rotation.x = 0;

  return { mesh, geometry, material };
}
