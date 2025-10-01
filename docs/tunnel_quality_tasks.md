# Tunnel Quality Follow-Up Tasks

The new automated tests help guard against regressions in the tunnel geometry,
but there are still several opportunities to raise overall quality:

1. **Adaptive Filter Kernels** – Experiment with kernels that vary based on the
   local curvature or turbulence of the direction field so that straight
   segments stay crisp while high-curvature areas receive additional smoothing.
2. **Dynamic Radius Floor** – The current fixed ``radius_base * 0.2`` floor is
   conservative. Investigate adaptive rules that consider the profile’s base
   scale and recent roughness variance to better preserve large chambers
   without risking thin passages.
3. **Path Quality Metrics** – Introduce metrics (e.g., integrated curvature,
   jerk, or roll oscillation) and expose them to the tests so we can track the
   impact of future generator tweaks quantitatively.
4. **Chunk Boundary Blending** – Implement blending between neighboring chunk
   meshes or roughness profiles to hide subtle seams when rendering with baked
   lighting or high-contrast shaders.
5. **Stress Testing** – Add soak tests that sweep extreme parameter values to
   ensure the generator remains numerically stable and keeps the skiff inside
   safe radii even during long procedural flights.

These items can guide future improvements once the current safeguards are in
place.
