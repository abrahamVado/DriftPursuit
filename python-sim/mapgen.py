#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
import random as pyrand


# ----------------------------- RNG Utilities ----------------------------- #

def make_rng(seed: Optional[int]) -> np.random.Generator:
    """
    Create a numpy Generator without polluting global RNG state.
    """
    if seed is None:
        return np.random.default_rng()
    # Accept wide Python int; fold into uint64 for numpy
    return np.random.default_rng(np.uint64(seed & ((1 << 64) - 1)))


def make_tile_rng(world_seed: int, tile_x: int, tile_y: int) -> np.random.Generator:
    """
    Derive a deterministic per-tile RNG from world seed + coords.
    """
    # Simple, stable mixing; avoids Python hash randomization
    mixed = (np.uint64(world_seed) * np.uint64(0x9E3779B185EBCA87) ^
             (np.uint64(tile_x) << np.uint64(32)) ^
             np.uint64(tile_y))
    return np.random.default_rng(mixed)


def mirror_numpy_rng_to_python(rng: np.random.Generator) -> pyrand.Random:
    """
    Build a Python random.Random with a seed derived from numpy RNG
    so both APIs remain deterministic per context.
    """
    # Pull 2x uint64 to form a 128-bit seed for Python Random
    u = rng.integers(0, 2**64, size=2, dtype=np.uint64)
    seed128 = int(u[0]) ^ (int(u[1]) << 1)
    pr = pyrand.Random()
    pr.seed(seed128)
    return pr


# ----------------------------- Noise Utilities --------------------------- #

def _fade(t: np.ndarray) -> np.ndarray:
    # Quintic fade (Perlin)
    return ((6 * t - 15) * t + 10) * t**3


def generate_perlin_noise_2d(
    shape: Tuple[int, int],
    res: Tuple[int, int],
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Perlin noise with exact (H, W) output.
    Requires: (W-1) divisible by res[0] and (H-1) divisible by res[1].
    """
    H, W = map(int, shape)
    rx, ry = map(int, res)
    if H <= 1 or W <= 1:
        raise ValueError("shape must be >= (2,2)")
    if rx <= 0 or ry <= 0:
        raise ValueError("res must be positive")
    if (W - 1) % rx != 0 or (H - 1) % ry != 0:
        raise ValueError(f"(W-1) must be divisible by rx and (H-1) by ry; got shape={shape}, res={res}")

    # Lattice gradients (ry+1 by rx+1)
    angles = rng.random((ry + 1, rx + 1)) * 2 * np.pi
    grad = np.stack([np.cos(angles), np.sin(angles)], axis=-1)  # (ry+1, rx+1, 2)

    # Continuous coordinates across the lattice, including the last edge
    # u in [0, rx], v in [0, ry], lengths W and H respectively
    u = np.linspace(0.0, float(rx), W, endpoint=True)
    v = np.linspace(0.0, float(ry), H, endpoint=True)

    iu = np.floor(u).astype(int)             # (W,)
    iv = np.floor(v).astype(int)             # (H,)
    fu = u - iu                              # (W,)
    fv = v - iv                              # (H,)

    # Clip the +1 indices to stay inside the gradient grid
    iu0 = iu[None, :]                        # (1,W)
    iv0 = iv[:, None]                        # (H,1)
    iu1 = np.clip(iu0 + 1, 0, rx)            # (H,W) after broadcast
    iv1 = np.clip(iv0 + 1, 0, ry)            # (H,W) after broadcast

    # Fancy indexing with broadcasting gives (H,W,2)
    g00 = grad[iv0, iu0]                     # (H,W,2)
    g10 = grad[iv0, iu1]                     # (H,W,2)
    g01 = grad[iv1, iu0]                     # (H,W,2)
    g11 = grad[iv1, iu1]                     # (H,W,2)

    # Displacement vectors to corners
    fu2 = fu[None, :]                         # (1,W)
    fv2 = fv[:, None]                         # (H,1)
    dx = fu2
    dy = fv2

    n00 = g00[..., 0] * dx        + g00[..., 1] * dy
    n10 = g10[..., 0] * (dx - 1.) + g10[..., 1] * dy
    n01 = g01[..., 0] * dx        + g01[..., 1] * (dy - 1.)
    n11 = g11[..., 0] * (dx - 1.) + g11[..., 1] * (dy - 1.)

    # Quintic fade
    tx = ((6 * dx - 15) * dx + 10) * dx**3   # (H,W) via broadcast
    ty = ((6 * dy - 15) * dy + 10) * dy**3   # (H,W) via broadcast

    n0 = n00 * (1 - tx) + tx * n10
    n1 = n01 * (1 - tx) + tx * n11
    out = (1 - ty) * n0 + ty * n1
    return out * math.sqrt(2.0)




def generate_fractal_noise_2d(
    shape: Tuple[int, int],
    res: Tuple[int, int],
    *,
    octaves: int = 1,
    persistence: float = 0.5,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Sum of Perlin octaves. Automatically clamps octaves so that for each octave k,
    (W-1) % (rx * 2^k) == 0 and (H-1) % (ry * 2^k) == 0, ensuring seamless tiles.
    """
    if octaves < 1:
        raise ValueError("octaves must be >= 1")

    H, W = map(int, shape)
    rx, ry = map(int, res)
    if rx <= 0 or ry <= 0:
        raise ValueError("res must be positive")

    Wm1, Hm1 = W - 1, H - 1
    # How many times can we double before we stop dividing W-1 and H-1?
    import math
    def max_doublings(n: int, base: int) -> int:
        if base <= 0: return 0
        q = n // base
        if q <= 0: return 0
        # largest k such that 2^k <= q
        return int(math.floor(math.log2(q)))

    max_kx = max_doublings(Wm1, rx)
    max_ky = max_doublings(Hm1, ry)
    allowed_octaves = 1 + min(max_kx, max_ky)  # k=0 counts as the first octave

    n_oct = max(1, min(int(octaves), allowed_octaves))

    noise = np.zeros(shape, dtype=np.float32)
    amplitude = 1.0
    for k in range(n_oct):
        cur_rx = rx * (1 << k)
        cur_ry = ry * (1 << k)
        # Safety (should be guaranteed by n_oct)
        if (Wm1 % cur_rx) != 0 or (Hm1 % cur_ry) != 0:
            break
        noise += amplitude * generate_perlin_noise_2d(shape, (cur_rx, cur_ry), rng)
        amplitude *= persistence
    return noise



def normalize_to_minus1_1(arr: np.ndarray) -> np.ndarray:
    ptp = np.ptp(arr)
    if ptp == 0:
        return np.zeros_like(arr)
    return ((arr - arr.min()) / ptp) * 2.0 - 1.0


# ----------------------------- Themes & Types ---------------------------- #

@dataclass(frozen=True)
class Theme:
    base_height_range: Tuple[float, float]
    z_scale_range: Tuple[int, int]
    value_multiplier: float
    height_material_color: str
    object_probs: Dict[str, float]
    object_base_colors: Dict[str, Optional[str]]
    num_objects_range: Tuple[int, int]
    special_objects: Optional[dict] = None


THEMES: Dict[str, Theme] = {
    "forest": Theme(
        base_height_range=(0.0, 0.5),
        z_scale_range=(10, 20),
        value_multiplier=1.0,
        height_material_color="#546e4f",
        object_probs={"tree": 0.7, "box": 0.1, "cylinder": 0.1, "plane": 0.1},
        object_base_colors={"plane": "#565e6a", "box": "#9aa7b7", "cylinder": "#d6d0c2", "tree": None},
        num_objects_range=(10, 20),
    ),
    "mountain": Theme(
        base_height_range=(0.5, 1.5),
        z_scale_range=(20, 40),
        value_multiplier=2.0,
        height_material_color="#7d7d7d",
        object_probs={"tree": 0.1, "box": 0.6, "cylinder": 0.2, "plane": 0.1},
        object_base_colors={"plane": "#6a6a6a", "box": "#8f8f8f", "cylinder": "#a0a0a0", "tree": None},
        num_objects_range=(5, 10),
    ),
    "lake": Theme(
        base_height_range=(-0.5, 0.0),
        z_scale_range=(5, 10),
        value_multiplier=0.5,
        height_material_color="#3a5570",
        object_probs={"tree": 0.2, "box": 0.1, "cylinder": 0.3, "plane": 0.4},
        object_base_colors={"plane": "#204060", "box": "#75839a", "cylinder": "#5e7a3f", "tree": None},
        num_objects_range=(3, 8),
        special_objects={
            "type": "plane",
            "size": [700, 700],
            "position": [0, 0, -0.1],
            "material": {"color": "#204060", "roughness": 0.15, "metalness": 0.25},
        },
    ),
    "plains": Theme(
        base_height_range=(0.0, 0.3),
        z_scale_range=(8, 15),
        value_multiplier=0.8,
        height_material_color="#6f8f60",
        object_probs={"tree": 0.3, "box": 0.2, "cylinder": 0.2, "plane": 0.3},
        object_base_colors={"plane": "#8a6f45", "box": "#c1784b", "cylinder": "#d6d0c2", "tree": None},
        num_objects_range=(5, 12),
    ),
}


# ----------------------------- Map Generation ---------------------------- #

def random_color(pr: pyrand.Random) -> str:
    return "#{:02x}{:02x}{:02x}".format(pr.randrange(256), pr.randrange(256), pr.randrange(256))


def random_material(
    pr: pyrand.Random,
    *,
    base_color: Optional[str] = None,
    roughness_range: Tuple[float, float] = (0.5, 0.9),
    metalness_range: Tuple[float, float] = (0.0, 0.3),
) -> dict:
    color = base_color or random_color(pr)
    roughness = round(pr.uniform(*roughness_range), 2)
    metalness = round(pr.uniform(*metalness_range), 2)
    return {"color": color, "roughness": roughness, "metalness": metalness}


def generate_heightfield(
    rows: int,
    cols: int,
    big_noise: np.ndarray,
    tile_coords: Tuple[int, int],
    theme: Theme,
    pr: pyrand.Random,
) -> dict:
    """
    Slice the stitched noise for a tile and turn it into a heightfield payload.
    """
    interval = rows - 1
    sx = tile_coords[0] * interval
    sy = tile_coords[1] * interval
    slice_noise = big_noise[sy: sy + rows, sx: sx + cols]
    data = (normalize_to_minus1_1(slice_noise) * theme.value_multiplier).astype(np.float32)

    z_scale = pr.randint(theme.z_scale_range[0], theme.z_scale_range[1])
    material = random_material(
        pr,
        base_color=theme.height_material_color,
        roughness_range=(0.7, 0.9),
        metalness_range=(0.0, 0.1),
    )
    return {
        "rows": rows,
        "cols": cols,
        "scale": {"z": int(z_scale)},
        "data": data.flatten().tolist(),
        "material": material,
    }


def random_position(pr: pyrand.Random, *, tile_size: int = 900) -> List[float]:
    half = tile_size / 2 - 10.0
    return [
        round(pr.uniform(-half, half), 1),
        round(pr.uniform(-half, half), 1),
        round(pr.uniform(-1.0, 2.0), 1),
    ]


def random_rotation(pr: pyrand.Random) -> List[int]:
    # Clamp to pleasant ranges; ints to match "rotationDegrees"
    return [pr.randint(-15, 15), pr.randint(-15, 15), pr.randint(-30, 30)]


def random_scale(pr: pyrand.Random, *, min_scale=0.8, max_scale=1.2) -> Union[float, List[float]]:
    s = round(pr.uniform(min_scale, max_scale), 2)
    return s if pr.random() < 0.5 else [s, s, s]


def choose_weighted(pr: pyrand.Random, weights_dict: Dict[str, float]) -> str:
    items = list(weights_dict.items())
    labels, weights = zip(*items)
    # Python 3.11+: pr.choices supports weights
    return pr.choices(labels, weights=weights, k=1)[0]

# ----------------------------- Extra Noise / Warp ------------------------ #

def ridgedify(n: np.ndarray) -> np.ndarray:
    """Turn smooth noise into ridged noise in [-1,1]."""
    r = 1.0 - np.abs(n)          # [0,1] peaks are ridges
    r = r * 2.0 - 1.0            # -> [-1,1]
    return np.clip(r, -1.0, 1.0)

def gradient_magnitude(h: np.ndarray, px: float = 1.0) -> np.ndarray:
    """Approx slope proxy from heightfield."""
    gy, gx = np.gradient(h, px)
    return np.sqrt(gx*gx + gy*gy)

def domain_warp2d(
    base: np.ndarray,
    rng: np.random.Generator,
    amount: float,
    cell_res: Tuple[int, int],
) -> np.ndarray:
    """
    Displace sampling coords of `base` using two extra noise fields.
    Keeps output array shape identical.
    """
    H, W = base.shape
    # 2 detail fields used as displacers
    nx = generate_perlin_noise_2d((H, W), cell_res, rng)
    ny = generate_perlin_noise_2d((H, W), cell_res, rng)
    # normalized displacements
    dx = (nx) * amount
    dy = (ny) * amount

    # build sampling grid
    j = np.arange(W)[None, :].repeat(H, axis=0).astype(np.float32)
    i = np.arange(H)[:, None].repeat(W, axis=1).astype(np.float32)

    x = np.clip(j + dx, 0, W - 1)
    y = np.clip(i + dy, 0, H - 1)

    # bilinear sample base at (y, x)
    x0 = np.floor(x).astype(int); x1 = np.clip(x0 + 1, 0, W - 1)
    y0 = np.floor(y).astype(int); y1 = np.clip(y0 + 1, 0, H - 1)
    wx = x - x0; wy = y - y0

    v00 = base[y0, x0]
    v10 = base[y0, x1]
    v01 = base[y1, x0]
    v11 = base[y1, x1]

    top = v00 * (1 - wx) + v10 * wx
    bot = v01 * (1 - wx) + v11 * wx
    return top * (1 - wy) + bot * wy


def generate_random_object(
    theme: Theme,
    pr: pyrand.Random,
    *,
    tile_size: int = 900,
) -> dict:
    obj_type = choose_weighted(pr, theme.object_probs)
    base_color = theme.object_base_colors.get(obj_type)

    if obj_type == "plane":
        return {
            "type": "plane",
            "size": [pr.randint(100, 800), pr.randint(50, 400)],
            "position": random_position(pr, tile_size=tile_size),
            "material": random_material(pr, base_color=base_color),
        }
    if obj_type == "box":
        return {
            "type": "box",
            "size": [pr.randint(30, 150), pr.randint(30, 150), pr.randint(10, 50)],
            "position": random_position(pr, tile_size=tile_size),
            "rotationDegrees": random_rotation(pr),
            "material": random_material(pr, base_color=base_color),
        }
    if obj_type == "cylinder":
        rt = pr.randint(5, 20)
        rb = pr.randint(rt, max(rt, 25))  # ensure bottom >= top
        return {
            "type": "cylinder",
            "radiusTop": rt,
            "radiusBottom": rb,
            "height": pr.randint(20, 80),
            "position": random_position(pr, tile_size=tile_size),
            "material": random_material(pr, base_color=base_color, roughness_range=(0.3, 0.6), metalness_range=(0.1, 0.3)),
        }
    if obj_type == "tree":
        return {
            "type": "tree",
            "position": random_position(pr, tile_size=tile_size),
            "scale": random_scale(pr),
        }
    # Fallback
    return {"type": "debug", "position": [0, 0, 0]}


def pick_theme_from_biome_value(v: float) -> Theme:
    if v < -0.5:
        return THEMES["lake"]
    if v < 0.0:
        return THEMES["plains"]
    if v < 0.5:
        return THEMES["forest"]
    return THEMES["mountain"]


def generate_tile(
    coords: Tuple[int, int],
    big_noise: np.ndarray,
    biome_noise: np.ndarray,
    rows: int,
    cols: int,
    tile_size: int,
    world_seed: int,
    density_scale: float = 1.0,
    crazy: bool = False,
    intensity: float = 1.0,
) -> dict:
    interval = rows - 1
    cx = coords[0] * interval + interval // 2
    cy = coords[1] * interval + interval // 2
    biome_value = biome_noise[cy, cx]
    theme = pick_theme_from_biome_value(biome_value)

    # Per-tile RNG
    tile_rng = make_tile_rng(world_seed, coords[0], coords[1])
    pr = mirror_numpy_rng_to_python(tile_rng)

    # Heightfield slice
    sx = coords[0] * interval
    sy = coords[1] * interval
    hf_slice = big_noise[sy: sy + rows, sx: sx + cols]
    hf_norm = normalize_to_minus1_1(hf_slice) * theme.value_multiplier

    # Risk score: steepness + altitude extremes + water proximity
    slope = gradient_magnitude(hf_norm, px=1.0)            # 0..~something
    slope_n = np.clip(slope / (0.25 + 0.35 * float(intensity)), 0.0, 1.0)
    alt_n = np.clip((hf_norm + 1.0) * 0.5, 0.0, 1.0)
    # proximity to lake biome (sample same tile extent)
    biome_tile = biome_noise[sy: sy + rows, sx: sx + cols]
    water_like = np.clip((-biome_tile - 0.0) * 1.2, 0.0, 1.0)  # higher when biome < 0

    risk = np.clip(0.55 * slope_n + 0.25 * alt_n + 0.20 * water_like, 0.0, 1.0)

    # Base height & zscale/material
    base_height = round(pr.uniform(*theme.base_height_range), 1)
    z_scale = pr.randint(theme.z_scale_range[0], theme.z_scale_range[1])
    material = random_material(
        pr, base_color=theme.height_material_color, roughness_range=(0.7, 0.9), metalness_range=(0.0, 0.1)
    )

    heightfield = {
        "rows": rows,
        "cols": cols,
        "scale": {"z": int(z_scale)},
        "data": hf_norm.astype(np.float32).flatten().tolist(),
        "material": material,
    }

    objects: List[dict] = []

    # Trees: avoid steep slopes & water
    lo, hi = theme.num_objects_range
    base_count = int(round(pr.uniform(lo, hi) * max(0.0, density_scale)))
    tree_boost = 1.0
    if crazy and theme is THEMES.get("forest"):
        tree_boost = 1.4 * float(intensity)
    count = int(max(0, round(base_count * tree_boost)))

    # Precompute allowed mask for trees
    tree_mask = (slope_n < 0.35) & (water_like < 0.55)
    # scatter attempts
    for _ in range(count):
        # bias picks toward lower risk
        for _attempt in range(6):
            ix = pr.randrange(cols)
            iy = pr.randrange(rows)
            if not tree_mask[iy, ix]:
                continue
            if pr.random() < (1.0 - risk[iy, ix]):  # prefer safer spot
                # convert (ix, iy) into local position
                half = tile_size / 2 - 10.0
                # center in tile; jitter within cell
                px = (ix / (cols - 1) - 0.5) * (tile_size) + pr.uniform(-6, 6)
                py = (iy / (rows - 1) - 0.5) * (tile_size) + pr.uniform(-6, 6)
                obj = {"type": "tree", "position": [round(px, 1), round(py, 1), round(pr.uniform(-0.2, 1.8), 1)],
                       "scale": random_scale(pr)}
                objects.append(obj)
                break

    # Other random objects (boxes, cylinders, planes), fewer on very steep tiles
    non_tree_count = max(0, int(round(base_count * (0.6 if slope_n.mean() > 0.45 else 1.0))))
    for _ in range(non_tree_count):
        objects.append(generate_random_object(theme, pr, tile_size=tile_size))

    # Cave entrances (as objects with metadata) — heavier in ridged/steep/mountain zones
    if crazy and (theme is THEMES.get("mountain") or slope_n.mean() > 0.38):
        caves_here = pr.randint(0, 2 + int(2 * float(intensity)))
        for _ in range(caves_here):
            half = tile_size / 2 - 20.0
            px = pr.uniform(-half, half); py = pr.uniform(-half, half)
            radius = pr.uniform(14, 42) * float(intensity)
            depth = pr.uniform(40, 140) * float(intensity)
            objects.append({
                "type": "caveEntrance",
                "position": [round(px, 1), round(py, 1), round(pr.uniform(-0.6, 0.2), 1)],
                "radius": round(radius, 1),
                "depth": round(depth, 1),
                "meta": {
                    "hint": "engine can carve a tunnel here or place a portal",
                    "riskBoost": 0.35
                }
            })

    return {
        "coords": list(coords),
        "baseHeight": base_height,
        "heightfield": heightfield,
        "objects": objects,
        "diagnostics": {
            "avgSlope": float(np.mean(slope)),
            "riskMean": float(np.mean(risk)),
            "biome": "lake" if biome_value < -0.5 else "plains" if biome_value < 0 else "forest" if biome_value < 0.5 else "mountain"
        }
    }



def generate_map(
    *,
    grid_size: Tuple[int, int] = (3, 3),
    tile_size: int = 900,
    rows: int = 33,
    cols: int = 33,
    id: str = "random_map",
    label: str = "Random Beautiful Map",
    seed: Optional[int] = None,
    height_octaves: int = 5,
    height_persistence: float = 0.5,
    biome_octaves: int = 2,
    biome_persistence: float = 0.5,
    base_res_per_tile: Tuple[int, int] = (4, 4),
    biome_res_per_tile: Tuple[int, int] = (2, 2),
    density_scale: float = 1.0,
    visible_radius_pad: int = 1,
    crazy: bool = False,
    intensity: float = 1.0,
) -> dict:

    """
    Generate a stitched tile map with fractal Perlin heightfield + low-freq biome selector.
    The stitched 'big_noise' ensures seamless tile edges.
    """
    if rows < 2 or cols < 2:
        raise ValueError("rows/cols must be >= 2")
    if any(g < 1 for g in grid_size):
        raise ValueError("grid_size must be positive in both dimensions")

    # World RNG
    rng = make_rng(seed)
    pr_world = mirror_numpy_rng_to_python(rng)
    # Backfill seed for output (guarantee int)
    world_seed = int(rng.integers(0, 2**31 - 1)) if seed is None else int(seed)

    interval_r = rows - 1
    interval_c = cols - 1
    # Total stitched field shape (H, W)
    total_shape = (grid_size[1] * interval_r + 1, grid_size[0] * interval_c + 1)

    total_res = (grid_size[0] * base_res_per_tile[0], grid_size[1] * base_res_per_tile[1])
    big_noise = generate_fractal_noise_2d(
        total_shape, total_res, octaves=height_octaves, persistence=height_persistence, rng=rng
    )
    big_noise = normalize_to_minus1_1(big_noise)

    total_biome_res = (grid_size[0] * biome_res_per_tile[0], grid_size[1] * biome_res_per_tile[1])
    biome_noise = generate_fractal_noise_2d(
        total_shape, total_biome_res, octaves=biome_octaves, persistence=biome_persistence, rng=rng
    )
    biome_noise = normalize_to_minus1_1(biome_noise)

    tiles: List[dict] = []
    for x in range(grid_size[0]):
        for y in range(grid_size[1]):
            tiles.append(
                generate_tile(
                    (x, y),
                    big_noise,
                    biome_noise,
                    rows,
                    cols,
                    tile_size,
                    world_seed,
                    density_scale=density_scale,
                    crazy=crazy,
                    intensity=intensity,
                )
            )


    # Simple: pick ground color from weighted dominant region of biome_noise, else random theme color
    # Here, sample center biomes across grid and choose the most frequent theme color
    centers: List[Tuple[int, int]] = [
        (x * interval_c + interval_c // 2, y * interval_r + interval_r // 2)
        for x in range(grid_size[0])
        for y in range(grid_size[1])
    ]
    chosen_theme_colors = []
    for cx, cy in centers:
        chosen_theme_colors.append(pick_theme_from_biome_value(biome_noise[cy, cx]).height_material_color)
    if chosen_theme_colors:
        # Majority color (ties broken by first seen)
        from collections import Counter
        ground_color = max(Counter(chosen_theme_colors).items(), key=lambda kv: kv[1])[0]
    else:
        ground_color = pr_world.choice([t.height_material_color for t in THEMES.values()])

    # --- CRAZY MODE: add ridges + warp for craggy mountains / broken plains ---
    if crazy:
        # ridged layer aligned to mountains: we bias using biome
        # mountains when biome_noise > 0.5
        ridge_res = (total_res[0] // 2 or 1, total_res[1] // 2 or 1)
        ridged = ridgedify(
            normalize_to_minus1_1(
                generate_fractal_noise_2d(total_shape, ridge_res, octaves=3, persistence=0.55, rng=rng)
            )
        )
        # weight ridges by positive biome (mountain/forest)
        biome_weight = np.clip((biome_noise + 1.0) * 0.5, 0.0, 1.0)  # [0..1]
        ridge_amp = 0.45 * float(intensity)  # dial with --intensity
        big_noise = normalize_to_minus1_1(big_noise + ridged * biome_weight * ridge_amp)

        # domain-warp the already combined field for crackled look
        warp_amount = 6.0 * float(intensity)     # pixels of displacement
        warp_res = (max(1, total_res[0] // 4), max(1, total_res[1] // 4))
        big_noise = normalize_to_minus1_1(domain_warp2d(big_noise, rng, warp_amount, warp_res))


    return {
        "id": id,
        "label": label,
        "type": "tilemap",
        "tileSize": tile_size,
        "visibleRadius": max(grid_size) + int(visible_radius_pad),
        "groundColor": ground_color,
        "tiles": tiles,
        "fallback": {"type": "procedural", "seed": f"{id}:fallback"},
        "seed": world_seed,
        "gridSize": list(grid_size),
        "rows": rows,
        "cols": cols,
    }


# ----------------------------- CLI / Script ------------------------------ #

def parse_grid(s: str) -> Tuple[int, int]:
    try:
        w, h = s.lower().split("x")
        return (int(w), int(h))
    except Exception as e:
        raise argparse.ArgumentTypeError(f"Invalid grid '{s}'. Use like 4x4.") from e


def main():
    ap = argparse.ArgumentParser(description="Generate beautiful procedural tile maps.")
    ap.add_argument("--grid", type=parse_grid, default="4x4", help="Grid size, e.g., 4x4")
    ap.add_argument("--tile", type=int, default=900, help="Tile size (world units)")
    ap.add_argument("--rows", type=int, default=33, help="Heightfield rows per tile")
    ap.add_argument("--cols", type=int, default=33, help="Heightfield cols per tile")
    ap.add_argument("--seed", type=int, default=None, help="World seed")
    ap.add_argument("--count", type=int, default=5, help="Number of maps to generate")
    ap.add_argument("--out-prefix", type=str, default="beautiful_map_", help="Output filename prefix")
    ap.add_argument("--density", type=float, default=1.0, help="Object density scale (0..inf)")
    ap.add_argument("--crazy", action="store_true", help="Enable ridges/domain-warp/caves/risks/trees+")
    ap.add_argument("--intensity", type=float, default=1.0, help="How wild (0.5..3.0)")

    args = ap.parse_args()

    grid = args.grid if isinstance(args.grid, tuple) else parse_grid(args.grid)

    for i in range(args.count):
        map_id = f"{args.out_prefix}{i}"
        data = generate_map(
            grid_size=grid,
            tile_size=args.tile,
            rows=args.rows,
            cols=args.cols,
            id=map_id,
            label=f"Beautiful Random Map {i}",
            seed=args.seed,
            density_scale=args.density,
            crazy=args.crazy,
            intensity=args.intensity,
        )

        with open(f"{map_id}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    print(f"Generated {args.count} map(s): {args.out_prefix}*.json")


if __name__ == "__main__":
    main()
