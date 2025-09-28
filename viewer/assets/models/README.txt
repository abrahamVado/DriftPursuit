The viewer ships with a lightweight stylized aircraft at `high_fidelity_aircraft.gltf`.
Replace it with your own glTF or GLB asset (and update the `MODEL_SETS` entry in `viewer/app.js` if you
rename it) to customize the display. The viewer will fall back to a simple box if no model can be loaded.

You can also try the built-in procedural "stylized_lowpoly" model set by appending `?modelSet=stylized_lowpoly`
to the viewer URL. That model is assembled in code (no glTF needed) and is a good starting point for quick
experiments without needing to create a full asset pipeline.
