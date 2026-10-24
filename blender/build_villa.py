"""
SWITCH villa reconstruction  -  Blender Python build script.

Builds an ORIGINAL model that reproduces the layout/look of the reference villa
("Modern House, Prefab House, AirBnB, 3Bed" by MarMel-Bali) from the supplied
screenshots only. No geometry from the paid asset is used.

Run (either works):
    blender --background --python blender/build_villa.py
    python  blender/build_villa.py          # with `pip install bpy`

Outputs
    blender/out/switch_villa.blend      editable source project
    public/models/switch_villa.glb      optimized runtime asset
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from villa_lib import *  # noqa: E402,F401,F403
import villa_lib as L  # noqa: E402
import make_textures  # noqa: E402

ROOT = os.path.dirname(HERE)

# ------------------------------------------------------------- dimensions
X0, X1, Y0, Y1 = -7.5, 7.5, -3.75, 3.75     # ground footprint
WT, IT, H = 0.25, 0.12, 3.0                 # ext wall, int wall, clear height
SLAB_BOT, SLAB_TOP = 3.0, 3.25
CANT = 0.9                                  # canopy cantilever at the front
SY0 = Y0 - CANT                             # slab front edge
UX0, UX1, UY0, UY1 = -1.0, 7.5, -2.0, 3.75  # upper volume footprint
UZ0 = SLAB_TOP
K = 1.4 / (UX1 - UX0)                       # roof slope (m/m)


def ZR(x):
    """Underside of the sloped roof at x (high on the left, low on the right)."""
    return 7.1 - (x - UX0) * K


def ZT(x):
    return ZR(x) - 0.04      # top of upper walls (under the oak ceiling skin)


STAIR_HOLE = (3.9, 1.85, 7.3, 3.6)          # x0,y0,x1,y1 interior stair void
STAIR_TOP_GAP = 6.25                         # guard ends here; x>6.25 is the open stair-top landing
LEVEL = {"ground": 0, "upper": 1, "terrace": 1}


# ---------------------------------------------------------------- materials
def materials():
    mat("MAT_WALL_WHITE", (0.95, 0.95, 0.93), 0.85, tex="plaster")
    mat("MAT_TRIM_BLACK", (0.02, 0.02, 0.025), 0.42, 0.6)
    mat("MAT_ROOF_DARK", (1, 1, 1), 0.5, 0.55, tex="roof_metal")
    mat("MAT_CONCRETE", (0.56, 0.56, 0.57), 0.9)
    mat("MAT_GLASS", (0.72, 0.86, 0.92), 0.04, 0.0, alpha=0.2)
    mat("MAT_FLOOR_PLANK", (1, 1, 1), 0.55, tex="plank_grey")
    mat("MAT_OAK", (1, 1, 1), 0.6, tex="oak")
    mat("MAT_WALNUT", (1, 1, 1), 0.5, tex="walnut")
    mat("MAT_PAVING", (1, 1, 1), 0.85, tex="paving")
    mat("MAT_TERRACE_TILE", (1, 1, 1), 0.6, tex="terrace_tile")
    mat("MAT_MARBLE_WHITE", (1, 1, 1), 0.22, tex="marble_white")
    mat("MAT_MARBLE_BLACK", (1, 1, 1), 0.18, tex="marble_black")
    mat("MAT_FABRIC_NAVY", (1, 1, 1), 0.95, tex="fabric_navy")
    mat("MAT_FABRIC_WHITE", (1, 1, 1), 0.95, tex="fabric_white")
    mat("MAT_FABRIC_TEAL", (1, 1, 1), 0.95, tex="fabric_teal")
    mat("MAT_FABRIC_GREEN", (1, 1, 1), 0.95, tex="fabric_green")
    mat("MAT_GRASS", (1, 1, 1), 1.0, tex="grass")
    mat("MAT_TILE_GREEN", (1, 1, 1), 0.12, tex="tile_green")
    mat("MAT_RUG", (1, 1, 1), 1.0, tex="rug_blue")
    mat("MAT_STEEL", (0.75, 0.75, 0.78), 0.3, 1.0)
    mat("MAT_BLACK", (0.025, 0.025, 0.028), 0.5, 0.1)
    mat("MAT_RED", (0.6, 0.03, 0.03), 0.3)
    mat("MAT_CERAMIC", (0.96, 0.96, 0.95), 0.15)
    mat("MAT_LEAF", (0.10, 0.36, 0.13), 0.8)
    mat("MAT_LEAF_LIGHT", (0.25, 0.5, 0.18), 0.8)
    mat("MAT_POT", (0.62, 0.36, 0.24), 0.9)
    mat("MAT_UMBRELLA", (0.93, 0.89, 0.79), 0.9)
    mat("MAT_CABINET", (0.80, 0.80, 0.78), 0.45)
    mat("MAT_SHELF_GREEN", (0.40, 0.55, 0.24), 0.4)
    mat("MAT_BLIND_GREEN", (0.55, 0.62, 0.22), 0.7)
    mat("MAT_GREY_CUSHION", (0.62, 0.64, 0.64), 0.95)
    mat("MAT_EMBER", (1, 0.4, 0.1), 0.5, emit=(1, 0.35, 0.08), emit_strength=2.0)
    mat("MAT_SKY_BOOK", (0.85, 0.85, 0.85), 0.8)
    mat("MAT_SURF_GREEN", (0.2, 0.6, 0.35), 0.4)
    mat("MAT_SLAT", (0.88, 0.86, 0.80), 0.7)
    mat("MAT_PLASTER_CEIL", (0.95, 0.95, 0.94), 0.9)
    mat("MAT_DEVICE_WHITE", (0.93, 0.94, 0.95), 0.35)
    mat("MAT_TV_SCREEN", (0.01, 0.012, 0.015), 0.08, 0.2)


def emit_mat(device, color=(1.0, 0.93, 0.8)):
    return mat(f"MAT_EMIT_{device}", color, 0.3)


def led_mat(key, color=(0.2, 0.9, 0.6)):
    return mat(f"MAT_LED_{key}", color, 0.4)


# ----------------------------------------------------------------- walls
def _segments(a0, a1, holes):
    segs, cur = [], a0
    for h in sorted(holes):
        if h[0] > cur:
            segs.append((cur, h[0], None))
        segs.append((h[0], h[1], (h[2], h[3])))
        cur = h[1]
    if cur < a1:
        segs.append((cur, a1, None))
    return segs


def wallX(name, y, x0, x1, z0, z1, t, m, g, holes=(), uv=1.0):
    """Wall running along X, centred on y. z1 may be a function top(x)."""
    top = z1 if callable(z1) else (lambda _a: z1)
    yl, yh = y - t / 2, y + t / 2
    for n, (a, b, h) in enumerate(_segments(x0, x1, holes)):
        if h is None:
            Q8(f"{name}_{n}", [(a, yl, z0), (b, yl, z0), (b, yh, z0), (a, yh, z0),
                               (a, yl, top(a)), (b, yl, top(b)), (b, yh, top(b)), (a, yh, top(a))], m, g, uv)
        else:
            za, zb = h
            if za > z0 + 1e-4:
                B(f"{name}_{n}s", (a, yl, z0), (b, yh, za), m, g, uv)
            Q8(f"{name}_{n}h", [(a, yl, zb), (b, yl, zb), (b, yh, zb), (a, yh, zb),
                                (a, yl, top(a)), (b, yl, top(b)), (b, yh, top(b)), (a, yh, top(a))], m, g, uv)


def wallY(name, x, y0, y1, z0, z1, t, m, g, holes=(), uv=1.0):
    """Wall running along Y, centred on x. z1 may be a function top(y)."""
    top = z1 if callable(z1) else (lambda _a: z1)
    xl, xh = x - t / 2, x + t / 2
    for n, (a, b, h) in enumerate(_segments(y0, y1, holes)):
        if h is None:
            Q8(f"{name}_{n}", [(xl, a, z0), (xl, b, z0), (xh, b, z0), (xh, a, z0),
                               (xl, a, top(a)), (xl, b, top(b)), (xh, b, top(b)), (xh, a, top(a))], m, g, uv)
        else:
            za, zb = h
            if za > z0 + 1e-4:
                B(f"{name}_{n}s", (xl, a, z0), (xh, b, za), m, g, uv)
            Q8(f"{name}_{n}h", [(xl, a, zb), (xl, b, zb), (xh, b, zb), (xh, a, zb),
                                (xl, a, top(a)), (xl, b, top(b)), (xh, b, top(b)), (xh, a, top(a))], m, g, uv)


# --------------------------------------------------------------- glazing
def glaze_x(name, x0, x1, z0, z1, y, g, panes=2, wt=0.25, fr=0.05):
    """Black-framed glazed opening in a wall running along X (static)."""
    T, GL = M("MAT_TRIM_BLACK"), M("MAT_GLASS")
    d = 0.09
    B(f"{name}_head", (x0, y - d / 2, z1 - fr), (x1, y + d / 2, z1), T, g)
    B(f"{name}_sill", (x0, y - d / 2, z0), (x1, y + d / 2, z0 + fr), T, g)
    B(f"{name}_jl", (x0, y - d / 2, z0), (x0 + fr, y + d / 2, z1), T, g)
    B(f"{name}_jr", (x1 - fr, y - d / 2, z0), (x1, y + d / 2, z1), T, g)
    for i in range(1, panes):
        xm = x0 + (x1 - x0) * i / panes
        B(f"{name}_m{i}", (xm - 0.025, y - d / 2, z0), (xm + 0.025, y + d / 2, z1), T, g)
    B(f"{name}_glass", (x0 + fr, y - 0.006, z0 + fr), (x1 - fr, y + 0.006, z1 - fr), GL, g)


def glaze_y(name, y0, y1, z0, z1, x, g, panes=1, fr=0.05):
    T, GL = M("MAT_TRIM_BLACK"), M("MAT_GLASS")
    d = 0.09
    B(f"{name}_head", (x - d / 2, y0, z1 - fr), (x + d / 2, y1, z1), T, g)
    B(f"{name}_sill", (x - d / 2, y0, z0), (x + d / 2, y1, z0 + fr), T, g)
    B(f"{name}_jl", (x - d / 2, y0, z0), (x + d / 2, y0 + fr, z1), T, g)
    B(f"{name}_jr", (x - d / 2, y1 - fr, z0), (x + d / 2, y1, z1), T, g)
    for i in range(1, panes):
        ym = y0 + (y1 - y0) * i / panes
        B(f"{name}_m{i}", (x - d / 2, ym - 0.025, z0), (x + d / 2, ym + 0.025, z1), T, g)
    B(f"{name}_glass", (x - 0.006, y0 + fr, z0 + fr), (x + 0.006, y1 - fr, z1 - fr), GL, g)


def slider_x(device, name, x0, x1, z0, z1, y, g, room, level, panes=2, outward=-1):
    """Sliding glass door along X. Pane 0 is a separate movable node
    DOOR_<name>/DOOR_<name>_PANEL; the others stay fixed. The runtime slides the
    PANEL by `slide_vec` (Blender axes) when the contact sensor is OPEN."""
    T, GL = M("MAT_TRIM_BLACK"), M("MAT_GLASS")
    d = 0.09
    fr = 0.05
    B(f"{name}_head", (x0, y - d / 2, z1 - fr), (x1, y + d / 2, z1), T, g)
    B(f"{name}_sill", (x0, y - d / 2, z0), (x1, y + d / 2, z0 + fr), T, g)
    B(f"{name}_jl", (x0, y - d / 2, z0), (x0 + fr, y + d / 2, z1), T, g)
    B(f"{name}_jr", (x1 - fr, y - d / 2, z0), (x1, y + d / 2, z1), T, g)
    pw = (x1 - x0) / panes
    for i in range(1, panes):
        xa, xb = x0 + pw * i, x0 + pw * (i + 1)
        B(f"{name}_fm{i}", (xa - 0.025, y - d / 2, z0), (xa + 0.025, y + d / 2, z1), T, g)
        B(f"{name}_fglass{i}", (xa, y - 0.006, z0 + fr), (xb - fr * (i == panes - 1), y + 0.006, z1 - fr), GL, g)
    e = empty(f"DOOR_{name}", (x0 + pw / 2, y, (z0 + z1) / 2),
              {"kind": "slider", "device_id": device, "room": room, "level": level,
               "slide_vec": [pw * 0.92, 0.0, 0.0]}, group="DEVICES", size=0.3)
    pan = empty(f"DOOR_{name}_PANEL", (x0 + pw / 2, y + outward * 0.055, (z0 + z1) / 2),
                {"kind": "slider_panel", "device_id": device}, parent=e, group="DEVICES", size=0.2)
    xa, xb = x0, x0 + pw
    yy = y + outward * 0.055
    kw = dict(group="DEVICES", parent=pan, keep=True)
    B(f"{name}_p_t", (xa, yy - 0.03, z1 - 0.1), (xb, yy + 0.03, z1 - 0.04), T, **kw)
    B(f"{name}_p_b", (xa, yy - 0.03, z0 + 0.04), (xb, yy + 0.03, z0 + 0.1), T, **kw)
    B(f"{name}_p_l", (xa, yy - 0.03, z0 + 0.04), (xa + 0.06, yy + 0.03, z1 - 0.04), T, **kw)
    B(f"{name}_p_r", (xb - 0.06, yy - 0.03, z0 + 0.04), (xb, yy + 0.03, z1 - 0.04), T, **kw)
    B(f"{name}_p_glass", (xa + 0.06, yy - 0.006, z0 + 0.1), (xb - 0.06, yy + 0.006, z1 - 0.1), GL, **kw)
    B(f"{name}_p_handle", (xb - 0.14, yy - outward * 0.04 - 0.012, 1.0), (xb - 0.12, yy - outward * 0.04 + 0.012, 1.4), M("MAT_STEEL"), **kw)
    return e


# ------------------------------------------------------------ architecture
def shell():
    W, T, GL = M("MAT_WALL_WHITE"), M("MAT_TRIM_BLACK"), M("MAT_GLASS")
    g = "SHELL"
    # plinth + ground
    B("plinth", (X0 - 0.35, SY0 - 0.35, -0.45), (X1 + 0.35, Y1 + 0.35, -0.02), M("MAT_CONCRETE"), "SITE")
    # exterior walls (ground floor)
    front_h = [(-7.0, -4.0, 0, 2.6), (-2.3, 0.5, 0, 2.6), (0.8, 3.2, 0, 2.6), (4.0, 7.0, 0, 2.6)]
    wallX("wall_front", Y0 + WT / 2, X0, X1, 0, H, WT, W, g, front_h)
    rear_h = [(-2.4, -1.0, 0, 2.6), (0.6, 2.0, 0, 2.6)]
    wallX("wall_rear", Y1 - WT / 2, X0, X1, 0, H, WT, W, g, rear_h)
    wallY("wall_left", X0 + WT / 2, Y0, Y1, 0, H, WT, W, g, [(0.3, 1.3, 0.9, 2.4), (2.4, 3.2, 1.7, 2.4)])
    wallY("wall_right", X1 - WT / 2, Y0, Y1, 0, H, WT, W, g, [(0.3, 1.3, 0.9, 2.4), (2.4, 3.2, 0.6, 2.4)])
    # glazing: front
    glaze_x("win_front_bed2", 4.0, 7.0, 0, 2.6, Y0 + WT / 2, g, panes=3)
    glaze_x("win_front_kitchen", 0.8, 3.2, 0, 2.6, Y0 + WT / 2, g, panes=2)
    glaze_x("win_rear_door2", 0.6, 2.0, 0, 2.6, Y1 - WT / 2, g, panes=2)
    glaze_y("win_left_bed1", 0.3, 1.3, 0.9, 2.4, X0 + WT / 2, g)
    glaze_y("win_left_bath1", 2.4, 3.2, 1.7, 2.4, X0 + WT / 2, g)
    glaze_y("win_right_bed2", 0.3, 1.3, 0.9, 2.4, X1 - WT / 2, g)
    glaze_y("win_right_stair", 2.4, 3.2, 0.6, 2.4, X1 - WT / 2, g)
    # frames' white architectural surround on the glass facade
    for nm, a, b in (("bed1", -7.0, -4.0), ("living", -2.3, 0.5), ("kitchen", 0.8, 3.2), ("bed2", 4.0, 7.0)):
        sx = 0.09
        B(f"surround_{nm}_l", (a - sx, Y0 - 0.02, 0), (a, Y0 + 0.12, 2.75), W, g)
        B(f"surround_{nm}_r", (b, Y0 - 0.02, 0), (b + sx, Y0 + 0.12, 2.75), W, g)
        B(f"surround_{nm}_t", (a - sx, Y0 - 0.02, 2.6), (b + sx, Y0 + 0.12, 2.75), W, g)
    # sliding doors (animated)
    slider_x("doorBedroom1", "bed1", -7.0, -4.0, 0, 2.6, Y0 + WT / 2, g, "bedroom", 0, panes=3)
    slider_x("doorLiving", "living", -2.3, 0.5, 0, 2.6, Y0 + WT / 2, g, "living", 0, panes=3)
    slider_x("doorBedroom2", "bed2_slider", 4.0, 7.0, 0, 2.6, Y0 + WT / 2 - 0.0, g, "bedroom2", 0, panes=3)
    slider_x("doorRear", "rear1", -2.4, -1.0, 0, 2.6, Y1 - WT / 2, g, "hallway", 0, panes=2, outward=+1)
    # vertical wood slat panel between the Bedroom One and Living glazing (as in the reference)
    n = 12
    for i in range(n):
        x = -3.52 + i * (0.95 / (n - 1))
        B(f"slat_{i}", (x, Y0 - 0.1, 0.0), (x + 0.05, Y0, 2.95), M("MAT_SLAT"), g)
    B("slat_back", (-3.55, Y0 - 0.02, 0), (-2.5, Y0, 2.95), M("MAT_TRIM_BLACK"), g)
    # ground-floor slab / canopy (also the terrace floor). Stair void at the rear.
    sx0, sy0, sx1, sy1 = STAIR_HOLE
    g2 = "GROUNDCEIL"
    pieces = [((X0, SY0, SLAB_BOT), (X1, sy0, SLAB_TOP)),
              ((X0, sy0, SLAB_BOT), (sx0, Y1, SLAB_TOP)),
              ((sx1, sy0, SLAB_BOT), (X1, Y1, SLAB_TOP)),
              ((sx0, sy1, SLAB_BOT), (sx1, Y1, SLAB_TOP))]
    for i, (lo, hi) in enumerate(pieces):
        B(f"slab_{i}", lo, hi, W, g2)
    # oak soffit under the front canopy
    B("canopy_soffit", (X0, SY0, SLAB_BOT - 0.05), (X1, Y0, SLAB_BOT), M("MAT_OAK"), g2, uv=2.0)
    B("canopy_black_edge", (X0, SY0 - 0.02, SLAB_BOT - 0.02), (X1, SY0 + 0.03, SLAB_TOP + 0.02), T, g2)
    # exterior ground floor steps/threshold
    B("threshold_front", (X0 + 0.1, Y0 - 0.5, -0.05), (X1 - 0.1, Y0, 0.0), M("MAT_CONCRETE"), "SITE")


def ground_interior():
    W, FP = M("MAT_WALL_WHITE"), M("MAT_FLOOR_PLANK")
    g = "INTERIOR"
    # floors
    B("floor_main", (X0 + WT, Y0 + WT, 0.0), (X1 - WT, Y1 - WT, 0.03), FP, "FLOORS", uv=2.0)
    B("floor_bath1", (X0 + WT, 1.76, 0.03), (-3.66, Y1 - WT, 0.05), M("MAT_MARBLE_BLACK"), "FLOORS", uv=1.5)
    # partitions
    wallY("p_bed1_living", -3.6, Y0 + WT, Y1 - WT, 0, H, IT, W, g, [(0.1, 1.0, 0, 2.2), (2.3, 3.2, 0, 2.2)])
    wallY("p_bed2_living", 3.4, Y0 + WT, Y1 - WT, 0, H, IT, W, g, [(0.1, 1.0, 0, 2.2), (2.3, 3.2, 0, 2.2)])
    wallX("p_bed1_bath1", 1.7, X0 + WT, -3.6, 0, H, IT, W, g)
    wallX("p_bed2_stair", 1.7, 3.4, X1 - WT, 0, H, IT, W, g)
    wallX("p_hall", 1.8, -3.6, 3.4, 0, H, IT, W, g, [(-1.2, 0.2, 0, H)])
    # ceilings: oak in living/bedrooms, plaster elsewhere
    oak, pl = M("MAT_OAK"), M("MAT_PLASTER_CEIL")
    gc = "GROUNDCEIL"
    B("ceil_bed1", (X0 + WT, Y0 + WT, 2.95), (-3.66, 1.64, SLAB_BOT), oak, gc, uv=2.0)
    B("ceil_living", (-3.54, Y0 + WT, 2.95), (3.34, 1.74, SLAB_BOT), oak, gc, uv=2.0)
    B("ceil_bed2", (3.46, Y0 + WT, 2.95), (X1 - WT, 1.64, SLAB_BOT), oak, gc, uv=2.0)
    B("ceil_bath1", (X0 + WT, 1.76, 2.95), (-3.66, Y1 - WT, SLAB_BOT), pl, gc)
    B("ceil_hall", (-3.54, 1.86, 2.95), (3.34, Y1 - WT, SLAB_BOT), pl, gc)
    # stair room ceiling: only the strips OUTSIDE the stair void (STAIR_HOLE) - the void stays open
    # so the interior stair has headroom up to the upper floor (repair: v2 covered the whole void).
    B("ceil_stair_a", (3.46, 1.76, 2.95), (STAIR_HOLE[0], Y1 - WT, SLAB_BOT), pl, gc)
    B("ceil_stair_b", (STAIR_HOLE[0], 1.76, 2.95), (X1 - WT, STAIR_HOLE[1], SLAB_BOT), pl, gc)
    # living coffer (white drop frame) – houses the warm LED cove
    cx0, cx1, cy0, cy1 = -3.0, 0.6, -3.2, 0.2
    for nm, lo, hi in (("a", (cx0, cy0, 2.78), (cx1, cy0 + 0.25, 2.95)), ("b", (cx0, cy1 - 0.25, 2.78), (cx1, cy1, 2.95)),
                       ("c", (cx0, cy0 + 0.25, 2.78), (cx0 + 0.25, cy1 - 0.25, 2.95)),
                       ("d", (cx1 - 0.25, cy0 + 0.25, 2.78), (cx1, cy1 - 0.25, 2.95))):
        B(f"coffer_{nm}", lo, hi, pl, gc)
    # interior stairs to the upper floor (walnut treads), in the stair room
    n, rise, run = 15, SLAB_TOP / 15, 0.213
    for i in range(n):
        xa = 4.0 + i * run
        B(f"stair_{i}", (xa, 2.0, 0.0), (xa + run, 3.4, rise * (i + 1)), M("MAT_WALNUT"), "STAIRS_INT")
    B("stair_stringer_l", (4.0, 1.94, 0.0), (7.2, 2.0, 0.4), M("MAT_BLACK"), "STAIRS_INT")


def upper():
    W, T, GL = M("MAT_WALL_WHITE"), M("MAT_TRIM_BLACK"), M("MAT_GLASS")
    g = "UPPER"
    # walls: front and rear follow the roof slope
    front_h = [(-0.6, 0.55, UZ0, 5.55), (1.2, 3.2, 4.05, 5.5), (3.7, 5.7, 4.05, 5.5), (6.1, 7.1, 4.05, 5.4)]
    wallX("uwall_front", UY0 + WT / 2, UX0, UX1, UZ0, ZT, WT, W, g, front_h)
    wallX("uwall_rear", UY1 - WT / 2, UX0, UX1, UZ0, ZT, WT, W, g, [(2.0, 3.2, 4.3, 5.4)])
    wallY("uwall_left", UX0 + WT / 2, UY0, UY1, UZ0, ZT(UX0), WT, W, g, [(2.0, 3.2, 4.3, 5.4)])
    wallY("uwall_right", UX1 - WT / 2, UY0, UY1, UZ0, ZT(UX1), WT, W, g, [(-0.5, 1.0, 4.3, 5.1)])
    yf = UY0 + WT / 2
    glaze_x("uwin_1", 1.2, 3.2, 4.05, 5.5, yf, g, panes=2)
    glaze_x("uwin_2", 3.7, 5.7, 4.05, 5.5, yf, g, panes=2)
    glaze_x("uwin_3", 6.1, 7.1, 4.05, 5.4, yf, g, panes=1)
    glaze_x("uwin_rear", 2.0, 3.2, 4.3, 5.4, UY1 - WT / 2, g, panes=1)
    glaze_y("uwin_left", 2.0, 3.2, 4.3, 5.4, UX0 + WT / 2, g)
    glaze_y("uwin_right", -0.5, 1.0, 4.3, 5.1, UX1 - WT / 2, g)
    # big white surrounds on the ribbon windows (a strong feature of the reference)
    for nm, a, b, zt in (("1", 1.2, 3.2, 5.5), ("2", 3.7, 5.7, 5.5), ("3", 6.1, 7.1, 5.4)):
        s = 0.16
        B(f"usurr_{nm}_l", (a - s, UY0 - 0.06, 3.95), (a, UY0 + 0.1, zt + s), W, g)
        B(f"usurr_{nm}_r", (b, UY0 - 0.06, 3.95), (b + s, UY0 + 0.1, zt + s), W, g)
        B(f"usurr_{nm}_t", (a - s, UY0 - 0.06, zt), (b + s, UY0 + 0.1, zt + s), W, g)
        B(f"usurr_{nm}_b", (a - s, UY0 - 0.06, 3.95), (b + s, UY0 + 0.1, 4.05), W, g)
    # slider onto the terrace (Bedroom Three)
    slider_x("doorBedroom3", "bed3", -0.6, 0.55, UZ0, 5.55, yf, g, "bedroom3", 1, panes=2)
    # upper floor finish (with the stair void left open)
    sx0, sy0, sx1, sy1 = STAIR_HOLE
    fp = M("MAT_FLOOR_PLANK")
    B("ufloor_a", (UX0 + WT, UY0 + WT, UZ0), (UX1 - WT, sy0, UZ0 + 0.02), fp, g, uv=2.0)
    B("ufloor_b", (UX0 + WT, sy0, UZ0), (sx0, UY1 - WT, UZ0 + 0.02), fp, g, uv=2.0)
    # ensuite (Bedroom Three): partitions + marble floor/cladding
    wallX("u_ens_front", 1.2, UX0 + WT, 1.6, UZ0, ZT, IT, W, g, [(0.2, 1.1, UZ0, 5.35)])
    wallY("u_ens_side", 1.6, 1.2, UY1 - WT, UZ0, ZT, IT, W, g)
    B("u_ens_floor", (UX0 + WT, 1.26, UZ0 + 0.02), (1.54, UY1 - WT, UZ0 + 0.04), M("MAT_MARBLE_BLACK"), g, uv=1.5)
    mw = M("MAT_MARBLE_WHITE")
    B("u_ens_clad_rear", (UX0 + WT, UY1 - WT - 0.03, UZ0 + 0.04), (1.54, UY1 - WT, 5.0), mw, g, uv=1.5)
    B("u_ens_clad_left", (UX0 + WT, 1.26, UZ0 + 0.04), (UX0 + WT + 0.03, UY1 - WT, 5.0), mw, g, uv=1.5)
    # green tile accent wall behind the bed (right wall)
    B("u_tile_wall", (UX1 - WT - 0.04, UY0 + WT, UZ0 + 0.02), (UX1 - WT, 1.85, 5.2), M("MAT_TILE_GREEN"), g, uv=1.2)
    B("u_tile_wall2", (UX0 + WT, UY0 + WT, UZ0 + 0.02), (UX0 + WT + 0.03, 0.6, 3.5), M("MAT_TILE_GREEN"), g, uv=1.2)
    # glass guard around the stair void
    # guard stops at STAIR_TOP_GAP so the top of the stair opens onto the bedroom-three floor
    gx = STAIR_TOP_GAP
    B("u_guard_front", (sx0, sy0 - 0.02, UZ0), (gx, sy0 + 0.02, UZ0 + 1.0), GL, g)
    B("u_guard_rail", (sx0, sy0 - 0.03, UZ0 + 0.98), (gx, sy0 + 0.03, UZ0 + 1.02), M("MAT_STEEL"), g)
    B("u_guard_post", (gx - 0.03, sy0 - 0.03, UZ0), (gx + 0.03, sy0 + 0.03, UZ0 + 1.02), M("MAT_STEEL"), g)
    B("u_guard_side", (sx0 - 0.02, sy0, UZ0), (sx0 + 0.02, sy1, UZ0 + 1.0), GL, g)
    # interior oak ceiling skin follows the roof (part of ROOF so it disappears with it)


def roof():
    W, T, R, O = M("MAT_WALL_WHITE"), M("MAT_TRIM_BLACK"), M("MAT_ROOF_DARK"), M("MAT_OAK")
    g = "ROOF"
    rx0, rx1, ry0, ry1 = -1.5, 8.4, -3.2, 4.2

    def slab(name, z_lo, z_hi, m, x0=rx0, x1=rx1, y0=ry0, y1=ry1, uv=1.0):
        Q8(name, [(x0, y0, ZR(x0) + z_lo), (x1, y0, ZR(x1) + z_lo), (x1, y1, ZR(x1) + z_lo), (x0, y1, ZR(x0) + z_lo),
                  (x0, y0, ZR(x0) + z_hi), (x1, y0, ZR(x1) + z_hi), (x1, y1, ZR(x1) + z_hi), (x0, y1, ZR(x0) + z_hi)], m, g, uv)

    slab("roof_oak_soffit", -0.045, 0.0, O, uv=2.0)           # visible from below (interior ceiling / overhang)
    slab("roof_fascia_white", 0.0, 0.20, W)                  # white fascia band
    slab("roof_top_dark", 0.20, 0.34, R, x0=rx0 + 0.04, x1=rx1 - 0.04, y0=ry0 + 0.04, y1=ry1 - 0.04, uv=2.0)
    # black trim line under the front edge and along the right edge
    Q8("roof_trim_front", [(rx0, ry0 - 0.02, ZR(rx0) + 0.0), (rx1, ry0 - 0.02, ZR(rx1) + 0.0), (rx1, ry0 + 0.04, ZR(rx1)),
                           (rx0, ry0 + 0.04, ZR(rx0)), (rx0, ry0 - 0.02, ZR(rx0) + 0.22), (rx1, ry0 - 0.02, ZR(rx1) + 0.22),
                           (rx1, ry0 + 0.04, ZR(rx1) + 0.22), (rx0, ry0 + 0.04, ZR(rx0) + 0.22)], T, g)
    # angled end fin on the right (white screen with black edge), as on the reference
    fx0, fx1 = 8.05, 8.2
    Q8("fin_white", [(fx0, ry0, SLAB_TOP + 0.05), (fx1, ry0, SLAB_TOP + 0.05), (fx1, ry1, SLAB_TOP + 0.05), (fx0, ry1, SLAB_TOP + 0.05),
                     (fx0, ry0, ZR(fx0) + 0.0), (fx1, ry0, ZR(fx1)), (fx1, ry1, ZR(fx1)), (fx0, ry1, ZR(fx0))], W, g)
    B("fin_edge_black", (fx1, ry0, SLAB_TOP + 0.05), (fx1 + 0.04, ry0 + 0.1, ZR(fx1) + 0.2), T, g)
    n = 16
    for i in range(n):
        yy = ry0 + 0.4 + i * ((ry1 - ry0 - 0.8) / (n - 1))
        Q8(f"fin_slat_{i}", [(fx1, yy, SLAB_TOP + 0.3), (fx1 + 0.05, yy, SLAB_TOP + 0.3), (fx1 + 0.05, yy + 0.07, SLAB_TOP + 0.3), (fx1, yy + 0.07, SLAB_TOP + 0.3),
                              (fx1, yy, ZR(fx1) - 0.1), (fx1 + 0.05, yy, ZR(fx1) - 0.1), (fx1 + 0.05, yy + 0.07, ZR(fx1) - 0.1), (fx1, yy + 0.07, ZR(fx1) - 0.1)],
           T, g)


def terrace_and_site():
    W, T, GL, ST = M("MAT_WALL_WHITE"), M("MAT_TRIM_BLACK"), M("MAT_GLASS"), M("MAT_STEEL")
    g = "TERRACE"
    # deck
    B("deck", (X0, SY0, SLAB_TOP), (UX0, Y1, SLAB_TOP + 0.04), M("MAT_TERRACE_TILE"), g, uv=1.5)
    B("deck_front_strip", (UX0, SY0, SLAB_TOP), (X1, UY0, SLAB_TOP + 0.04), M("MAT_TERRACE_TILE"), g, uv=1.5)
    # parapet base + glass balustrade (front & left & rear of terrace)
    pb = 0.35
    B("parapet_front", (X0, SY0, SLAB_TOP), (X1, SY0 + 0.2, SLAB_TOP + pb), W, g)
    B("parapet_left_a", (X0, SY0, SLAB_TOP), (X0 + 0.2, -1.95, SLAB_TOP + pb), W, g)
    B("parapet_left_b", (X0, -0.9, SLAB_TOP), (X0 + 0.2, Y1, SLAB_TOP + pb), W, g)
    B("parapet_rear", (X0, Y1 - 0.2, SLAB_TOP), (UX0, Y1, SLAB_TOP + pb), W, g)
    B("parapet_right_rear", (UX1 - 0.0, Y1 - 0.2, SLAB_TOP), (X1, Y1, SLAB_TOP + pb), W, g)

    def glass_run(name, axis, fixed, a0, a1, z0=SLAB_TOP + pb, h=0.95):
        n = max(1, int(round((a1 - a0) / 1.2)))
        for i in range(n + 1):
            p = a0 + (a1 - a0) * i / n
            if axis == 'x':
                B(f"{name}_post{i}", (p - 0.02, fixed - 0.02, z0), (p + 0.02, fixed + 0.02, z0 + h + 0.05), ST, g)
            else:
                B(f"{name}_post{i}", (fixed - 0.02, p - 0.02, z0), (fixed + 0.02, p + 0.02, z0 + h + 0.05), ST, g)
        if axis == 'x':
            B(f"{name}_glass", (a0, fixed - 0.008, z0 + 0.03), (a1, fixed + 0.008, z0 + h), GL, g)
            B(f"{name}_rail", (a0, fixed - 0.03, z0 + h), (a1, fixed + 0.03, z0 + h + 0.05), ST, g)
        else:
            B(f"{name}_glass", (fixed - 0.008, a0, z0 + 0.03), (fixed + 0.008, a1, z0 + h), GL, g)
            B(f"{name}_rail", (fixed - 0.03, a0, z0 + h), (fixed + 0.03, a1, z0 + h + 0.05), ST, g)

    glass_run("rail_front", 'x', SY0 + 0.1, X0 + 0.1, UX0 - 0.05)
    glass_run("rail_left_a", 'y', X0 + 0.1, SY0 + 0.1, -1.95)
    glass_run("rail_left_b", 'y', X0 + 0.1, -0.9, Y1 - 0.1)
    glass_run("rail_rear", 'x', Y1 - 0.1, X0 + 0.1, UX0 - 0.05)
    # low front balustrade under the roof overhang (right part)
    glass_run("rail_front_r", 'x', SY0 + 0.1, UX0, X1 - 0.1, h=0.7)

    # --- terrace furniture ---
    # umbrella
    CYL("umbrella_base", (-4.9, -1.4, SLAB_TOP + 0.06), 0.35, 0.1, M("MAT_CONCRETE"), g)
    CYL("umbrella_pole", (-4.9, -1.4, SLAB_TOP + 1.3), 0.025, 2.4, ST, g, segs=10)
    CYL("umbrella_canopy", (-4.9, -1.4, SLAB_TOP + 2.35), 1.7, 0.4, M("MAT_UMBRELLA"), g, r2=0.04, segs=16)
    # lounge sofa (outdoor), table, two loungers
    B("sofa_base", (-6.9, -2.9, SLAB_TOP + 0.04), (-5.5, -2.2, SLAB_TOP + 0.4), M("MAT_STEEL"), g)
    B("sofa_seat", (-6.85, -2.85, SLAB_TOP + 0.4), (-5.55, -2.3, SLAB_TOP + 0.58), M("MAT_FABRIC_WHITE"), g)
    B("sofa_back", (-6.9, -2.95, SLAB_TOP + 0.4), (-5.5, -2.8, SLAB_TOP + 0.95), M("MAT_FABRIC_WHITE"), g)
    CYL("table_top", (-6.2, -1.1, SLAB_TOP + 0.45), 0.45, 0.04, M("MAT_WALNUT"), g)
    CYL("table_leg", (-6.2, -1.1, SLAB_TOP + 0.22), 0.05, 0.44, ST, g, segs=10)
    for i, y in enumerate((0.9, 1.9)):
        Brot(f"lounger_frame_{i}", (-5.2, y, SLAB_TOP + 0.22), (1.9, 0.62, 0.1), (0, 0, 0), ST, g)
        Brot(f"lounger_pad_{i}", (-5.35, y, SLAB_TOP + 0.34), (1.1, 0.58, 0.1), (0, 0, 0), M("MAT_FABRIC_WHITE"), g)
        Brot(f"lounger_back_{i}", (-4.55, y, SLAB_TOP + 0.5), (0.8, 0.58, 0.1), (0, -28, 0), M("MAT_FABRIC_WHITE"), g)
    # planters with plants
    for i, (px, py) in enumerate(((-7.0, -4.2), (-7.1, 3.2), (-1.5, -4.2), (-2.2, 3.3), (-6.3, 2.5))):
        CYL(f"planter_{i}", (px, py, SLAB_TOP + 0.3), 0.3, 0.6, M("MAT_POT"), g, r2=0.24, segs=16)
        for j in range(5):
            a = j * 1.26
            SPH(f"leaf_{i}_{j}", (px + 0.11 * math.sin(a), py + 0.1 * math.cos(a), SLAB_TOP + 0.76 + 0.1 * (j % 2)), 0.16,
                M("MAT_LEAF" if j % 2 else "MAT_LEAF_LIGHT"), g, sc=(1, 1, 1.3), segs=8)
    # --- external stairs up to the terrace along the left side ---
    gs = "SITE_STAIRS"
    n, rise, run = 15, SLAB_TOP / 15, 0.27
    for i in range(n):
        ya, yb = 3.1 - (i + 1) * run, 3.1 - i * run
        B(f"estair_{i}", (X0 - 1.0, ya, -0.05), (X0, yb, rise * (i + 1)), M("MAT_CONCRETE"), gs)
    B("estair_landing", (X0 - 1.0, -1.9, SLAB_TOP - 0.2), (X0, -0.95, SLAB_TOP), M("MAT_CONCRETE"), gs)
    B("estair_stringer", (X0 - 1.06, -0.9, -0.05), (X0 - 1.0, 3.1, 0.0), T, gs)
    ang = math.degrees(math.atan2(SLAB_TOP, 3.1 - (-0.95)))
    Brot("estair_rail", (X0 - 1.02, (3.1 + -0.95) / 2, SLAB_TOP / 2 + 1.0), (0.05, 4.4, 0.05), (ang, 0, 0), ST, gs)
    for i in range(5):
        y = 3.0 - i * 0.95
        z = (3.1 - y) / (3.1 + 0.95) * SLAB_TOP
        B(f"estair_post_{i}", (X0 - 1.04, y - 0.02, z - 0.0), (X0 - 1.0, y + 0.02, z + 1.0), ST, gs)

    # --- site: paving, grass, rear patio, AC outdoor units, slats, shrubs ---
    gp = "SITE"
    B("grass", (-34, -34, -0.55), (34, 34, -0.45), M("MAT_GRASS"), gp, uv=3.0)
    B("paving_front", (-10.5, -9.0, -0.5), (10.5, SY0 - 0.35, -0.04), M("MAT_PAVING"), gp, uv=1.5)
    B("paving_front_lines", (-10.5, -6.2, -0.04), (10.5, -6.0, -0.035), M("MAT_CONCRETE"), gp)
    B("patio_rear", (-10.0, Y1 + 0.35, -0.5), (10.0, 8.5, -0.04), M("MAT_TERRACE_TILE"), gp, uv=1.5)
    B("paving_left", (-10.5, SY0 - 0.35, -0.5), (X0 - 0.35, 8.5, -0.04), M("MAT_PAVING"), gp, uv=1.5)
    B("paving_right", (X1 + 0.35, SY0 - 0.35, -0.5), (10.5, 8.5, -0.04), M("MAT_PAVING"), gp, uv=1.5)
    for i, x in enumerate((5.0, 6.2)):           # moved away from the rear hallway door
        B(f"outdoor_ac_{i}", (x - 0.4, Y1 + 0.05, 0.35), (x + 0.4, Y1 + 0.4, 0.95), M("MAT_DEVICE_WHITE"), gp)
        CYL(f"outdoor_ac_fan_{i}", (x - 0.12, Y1 + 0.41, 0.65), 0.2, 0.02, M("MAT_BLACK"), gp, axis='y', segs=16)
    for i in range(12):
        B(f"rear_slat_{i}", (3.4 + i * 0.07, Y1 + 0.02, 0.0), (3.4 + i * 0.07 + 0.04, Y1 + 0.08, 2.4), M("MAT_SLAT"), gp)
    for i, (sx, sy, sh) in enumerate(((9.2, -7.5, 1.0), (-9.4, -7.0, 0.9), (9.5, 5.0, 1.2), (-9.3, 6.2, 1.0))):
        for j in range(4):
            SPH(f"shrub_{i}_{j}", (sx + 0.35 * math.cos(j * 1.9), sy + 0.3 * math.sin(j * 1.9), sh * 0.5 + 0.1 * j), 0.55,
                M("MAT_LEAF" if j % 2 else "MAT_LEAF_LIGHT"), gp, segs=8, sc=(1, 1, 0.9))
    # palms near the front lawn
    for i, (px, py) in enumerate(((-12.5, -10.5), (12.0, -11.0), (14.0, -3.0))):
        CYL(f"palm_trunk_{i}", (px, py, 2.0), 0.14, 4.4, M("MAT_POT"), gp, r2=0.1, segs=8)
        for j in range(7):
            a = j * 0.9
            Brot(f"palm_frond_{i}_{j}", (px + 0.9 * math.cos(a), py + 0.9 * math.sin(a), 4.4), (1.9, 0.28, 0.03),
                 (0, 14, math.degrees(a)), M("MAT_LEAF"), gp)


# =============================================================== DEVICES
def _extras(kind, device, room, level, **kw):
    d = {"kind": kind, "device_id": device, "room": room, "level": level}
    d.update(kw)
    return d


def light_fixture(name, device, room, level, loc, color="#ffd9a0", lumens=1.0, rng=5.0, parts=None):
    """Empty = the light SOURCE position. `parts(parent)` adds the visible bulb
    meshes (using MAT_EMIT_<device>) as children."""
    e = empty(name, loc, _extras("light", device, room, level, color=color, power=lumens, range=rng), size=0.12)
    if parts:
        parts(e)
    return e


def downlight(name, device, room, level, loc, r=0.07, **kw):
    em = emit_mat(device)

    def parts(p):
        CYL(f"{name}_BULB", loc, r, 0.02, em, "DEVICES", parent=p, keep=True, segs=16)
        CYL(f"{name}_RING", (loc[0], loc[1], loc[2] + 0.012), r + 0.025, 0.012, M("MAT_DEVICE_WHITE"), "DEVICES", parent=p, keep=True, segs=16)
    return light_fixture(name, device, room, level, (loc[0], loc[1], loc[2] - 0.15), parts=parts, **kw)


def globe_pendant(name, device, room, level, loc, drop, r=0.16, **kw):
    """Spherical pendant hanging `drop` m below loc (ceiling point)."""
    em = emit_mat(device)

    def parts(p):
        CYL(f"{name}_CORD", (loc[0], loc[1], loc[2] - drop / 2), 0.004, drop, M("MAT_BLACK"), "DEVICES", parent=p, keep=True, segs=6)
        SPH(f"{name}_BULB", (loc[0], loc[1], loc[2] - drop - r), r, em, "DEVICES", parent=p, keep=True, segs=16)
    return light_fixture(name, device, room, level, (loc[0], loc[1], loc[2] - drop - r), parts=parts, **kw)


def strip_light(name, device, room, level, lo, hi, **kw):
    em = emit_mat(device)
    c = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)

    def parts(p):
        B(f"{name}_BULB", lo, hi, em, "DEVICES", parent=p, keep=True)
    return light_fixture(name, device, room, level, c, parts=parts, **kw)


def ring_chandelier(name, device, room, level, c, z_ceiling):
    em = emit_mat(device)
    R = 0.55

    def parts(p):
        TOR(f"{name}_RING", (c[0], c[1], c[2]), R, 0.012, M("MAT_BLACK"), "DEVICES", parent=p, keep=True)
        for i in range(8):
            a = i * math.pi / 4
            SPH(f"{name}_BULB_{i}", (c[0] + R * math.cos(a), c[1] + R * math.sin(a), c[2] - 0.05), 0.055, em, "DEVICES", parent=p, keep=True, segs=10)
        for i in range(3):
            a = i * 2.094 + 0.5
            x, y = c[0] + R * 0.9 * math.cos(a), c[1] + R * 0.9 * math.sin(a)
            CYL(f"{name}_ROD_{i}", (x, y, (c[2] + z_ceiling) / 2), 0.004, z_ceiling - c[2], M("MAT_BLACK"), "DEVICES", parent=p, keep=True, segs=6)
    return light_fixture(name, device, room, level, (c[0], c[1], c[2] - 0.25), parts=parts, color="#ffe2b0", lumens=1.0, rng=5.5)


def ceiling_fan(key, device, room, level, x, y, z_ceiling, drop=0.32):
    e = empty(f"FAN_{key}", (x, y, z_ceiling), _extras("fan", device, room, level), size=0.2)
    kw = dict(group="DEVICES", parent=e, keep=True)
    CYL(f"FAN_{key}_MOUNT", (x, y, z_ceiling - 0.03), 0.09, 0.06, M("MAT_BLACK"), segs=16, **kw)
    CYL(f"FAN_{key}_ROD", (x, y, z_ceiling - drop / 2), 0.016, drop, M("MAT_BLACK"), segs=8, **kw)
    zm = z_ceiling - drop - 0.06
    CYL(f"FAN_{key}_MOTOR", (x, y, zm), 0.13, 0.13, M("MAT_BLACK"), segs=20, **kw)
    pv = empty(f"FAN_{key}_BLADES", (x, y, zm), {"kind": "fan_blades", "device_id": device}, parent=e, group="DEVICES", size=0.3)
    for i in range(5):
        a = i * 72
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        Brot(f"FAN_{key}_BLADE_{i}", (x + 0.5 * ca, y + 0.5 * sa, zm - 0.02), (0.78, 0.15, 0.012), (8, 0, a),
             M("MAT_OAK") if i % 2 == 0 else M("MAT_WALNUT"), "DEVICES", parent=pv, keep=True, uv=1.0)
    return e


def ac_unit(key, device, room, level, origin, yaw):
    """Wall split unit. Local frame: back on the wall plane (local y=0), the
    unit protrudes toward local -Y; `yaw` rotates it about Z."""
    ox, oy, oz = origin
    e = empty(f"AC_{key}", origin, _extras("ac", device, room, level), size=0.2)
    e.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()

    def W(l):
        r = yaw_rot(l, yaw)
        return (ox + r[0], oy + r[1], oz + r[2])

    kw = dict(group="DEVICES", parent=e, keep=True)
    Brot(f"AC_{key}_BODY", W((0, -0.105, 0)), (0.98, 0.21, 0.30), (0, 0, yaw), M("MAT_DEVICE_WHITE"), **kw)
    Brot(f"AC_{key}_PANEL", W((0, -0.212, 0.03)), (0.9, 0.004, 0.2), (0, 0, yaw), M("MAT_CERAMIC"), **kw)
    # louver: pivot at the lower front edge, rotates about local X
    piv = empty(f"AC_{key}_LOUVER", W((0, -0.2, -0.145)), {"kind": "ac_louver", "device_id": device}, parent=e, group="DEVICES", size=0.1)
    piv.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()
    Brot(f"AC_{key}_LOUVER_BLADE", W((0, -0.2, -0.16)), (0.84, 0.012, 0.07), (0, 0, yaw), M("MAT_DEVICE_WHITE"), group="DEVICES", parent=piv, keep=True)
    # status LED (colour set at runtime)
    lm = led_mat(f"{device}")
    SPH(f"AC_{key}_LED", W((0.38, -0.214, 0.07)), 0.011, lm, "DEVICES", parent=e, keep=True, segs=8)
    return e


def sensor_motion(key, room, level, loc):
    e = empty(f"SENSOR_{key}_MOTION", loc, _extras("sensor", f"motion:{room}", room, level, sensor="motion"), size=0.1)
    CYL(f"SENSOR_{key}_MOTION_BODY", loc, 0.045, 0.025, M("MAT_DEVICE_WHITE"), "DEVICES", parent=e, keep=True, segs=14)
    SPH(f"SENSOR_{key}_MOTION_LED", (loc[0], loc[1], loc[2] - 0.016), 0.014, led_mat(f"motion_{room}", (0.2, 0.6, 1.0)), "DEVICES", parent=e, keep=True, segs=8)
    return e


def sensor_env(key, room, level, loc, yaw=0):
    e = empty(f"SENSOR_{key}_ENV", loc, _extras("sensor", f"env:{room}", room, level, sensor="env"), size=0.1)
    B(f"SENSOR_{key}_ENV_BODY", (loc[0] - 0.035, loc[1] - 0.012, loc[2] - 0.035), (loc[0] + 0.035, loc[1] + 0.012, loc[2] + 0.035), M("MAT_DEVICE_WHITE"), "DEVICES", parent=e, keep=True)
    return e


def room_marker(room_id, name, level, lo, hi):
    c = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    s = ((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2)
    return empty(f"ROOM_{name}", c, {"kind": "room", "room_id": room_id, "level": level},
                 group="ROOMS", scale=s, display='CUBE', size=1.0)


# ============================================================ FURNITURE
def sofa_module(g, cx, cy, back_dir, size=(0.95, 1.0), mat_name="MAT_FABRIC_NAVY", n=""):
    """Chunky modular sofa piece (Camaleonda-style). back_dir: unit vector (dx,dy)."""
    m = M(mat_name)
    sx, sy = size
    B(f"sofa_seat{n}", (cx - sx / 2 + 0.02, cy - sy / 2 + 0.02, 0.06), (cx + sx / 2 - 0.02, cy + sy / 2 - 0.02, 0.48), m, g)
    # rounded cushion on top
    SPH(f"sofa_cush{n}", (cx, cy, 0.5), 0.5, m, g, sc=(sx / 1.0 * 0.95, sy / 1.0 * 0.95, 0.2), segs=12)
    bx, by = cx + back_dir[0] * (sx / 2 - 0.15), cy + back_dir[1] * (sy / 2 - 0.15)
    bw = (0.3, sy - 0.04) if back_dir[0] else (sx - 0.04, 0.3)
    B(f"sofa_back{n}", (bx - bw[0] / 2, by - bw[1] / 2, 0.3), (bx + bw[0] / 2, by + bw[1] / 2, 0.88), m, g)
    SPH(f"sofa_backr{n}", (bx, by, 0.88), 0.5, m, g, sc=(bw[0] / 1.0 * 1.0, bw[1] / 1.0 * 0.96, 0.14), segs=12)


def potted_plant(g, x, y, s=1.0, z0=0.0):
    CYL(f"pot_{x:.1f}_{y:.1f}", (x, y, z0 + 0.25 * s), 0.22 * s, 0.5 * s, M("MAT_POT"), g, r2=0.17 * s, segs=14)
    for j in range(6):
        a = j * 1.05
        SPH(f"plant_{x:.1f}_{y:.1f}_{j}", (x + 0.11 * s * math.sin(a), y + 0.1 * s * math.cos(a), z0 + (0.72 + 0.11 * (j % 3)) * s), 0.15 * s,
            M("MAT_LEAF" if j % 2 else "MAT_LEAF_LIGHT"), g, sc=(1, 1, 1.5), segs=8)


def bed(g, name, cx, cy, head_dir, frame_mat="MAT_BLACK", z0=0.0, size=(2.1, 2.0)):
    """King bed; head_dir = (+1|-1, 0) -> headboard side along X."""
    L, Wd = size
    d = head_dir[0]
    x0, x1 = cx - L / 2, cx + L / 2
    B(f"{name}_base", (x0, cy - Wd / 2, z0), (x1, cy + Wd / 2, z0 + 0.25), M(frame_mat), g)
    B(f"{name}_mattress", (x0 + 0.04, cy - Wd / 2 + 0.04, z0 + 0.25), (x1 - 0.04, cy + Wd / 2 - 0.04, z0 + 0.5), M("MAT_FABRIC_WHITE"), g)
    hx = (x0 if d < 0 else x1)
    for k, yy in enumerate((cy - Wd / 4, cy + Wd / 4)):
        SPH(f"{name}_pillow{k}", (hx - d * 0.3, yy, z0 + 0.58), 0.3, M("MAT_FABRIC_WHITE"), g, sc=(0.8, 1.0, 0.35), segs=10)
    if d < 0:     # head at x0, foot at x1
        B(f"{name}_throw", (x1 - 0.62, cy - Wd / 2 + 0.03, z0 + 0.5), (x1 - 0.02, cy + Wd / 2 - 0.03, z0 + 0.53), M("MAT_GREY_CUSHION"), g)
        hb = (x0 - 0.1, x0)
        hp = (x0 - 0.02, x0 + 0.02)
    else:         # head at x1, foot at x0
        B(f"{name}_throw", (x0 + 0.02, cy - Wd / 2 + 0.03, z0 + 0.5), (x0 + 0.62, cy + Wd / 2 - 0.03, z0 + 0.53), M("MAT_GREY_CUSHION"), g)
        hb = (x1, x1 + 0.1)
        hp = (x1 - 0.02, x1 + 0.02)
    # headboard: black frame with a pale padded panel
    B(f"{name}_headboard", (hb[0], cy - Wd / 2 - 0.15, z0), (hb[1], cy + Wd / 2 + 0.15, z0 + 1.15), M("MAT_BLACK"), g)
    B(f"{name}_headpad", (hp[0], cy - Wd / 2 + 0.1, z0 + 0.4), (hp[1], cy + Wd / 2 - 0.1, z0 + 1.05), M("MAT_GREY_CUSHION"), g)


def nightstand(g, name, x, y, sx=0.45, sy=0.4):
    B(f"{name}", (x - sx / 2, y - sy / 2, 0.25), (x + sx / 2, y + sy / 2, 0.55), M("MAT_BLACK"), g)
    B(f"{name}_shelf", (x - sx / 2 + 0.03, y - sy / 2 + 0.03, 0.30), (x + sx / 2 - 0.03, y + sy / 2 - 0.03, 0.34), M("MAT_WALNUT"), g)


LIVING_SOFA_DY = 0.7     # living seating moved back from the front glazing (walkable route to the slider)
TV_DY, TV_DZ = 0.6, 0.17  # TV centred on the sofa, raised above the fireplace/console


def furnish_living():
    g = "FURN_LIVING"
    S = LIVING_SOFA_DY  # whole seating group sits back from the glass -> walkable strip to the slider
    B("rug", (-3.0, -3.45 + S, 0.03), (0.2, -0.55 + S, 0.045), M("MAT_RUG"), g, uv=2.6)
    # U of modular navy sofa facing the TV wall (west)
    for i, y in enumerate((-3.0, -2.0, -1.0)):
        sofa_module(g, -0.5, y + S, (1, 0), n=f"_b{i}")
    sofa_module(g, -1.45, -3.0 + S, (0, -1), n="_s0")
    sofa_module(g, -1.45, -1.0 + S, (0, 1), n="_s1")
    # cushions
    for i, (x, y) in enumerate(((-0.72, -3.05), (-0.72, -1.0), (-1.45, -3.35))):
        SPH(f"cushion_{i}", (x, y + S, 0.65), 0.2, M("MAT_FABRIC_WHITE"), g, sc=(0.6, 1.0, 1.0), segs=8)
    # round coffee table
    CYL("coffee_top", (-1.8, -2.0 + S, 0.37), 0.55, 0.05, M("MAT_WALNUT"), g)
    CYL("coffee_base", (-1.8, -2.0 + S, 0.18), 0.35, 0.36, M("MAT_BLACK"), g)
    # TV wall: walnut panelling, black fireplace, red shelving ladder
    B("tvwall_panel", (-3.6, -3.55, 0), (-3.54, -0.2, 2.65), M("MAT_WALNUT"), g, uv=1.5)
    B("fireplace_surround", (-3.58, -1.25, 0), (-3.38, -0.45, 1.05), M("MAT_BLACK"), g)
    B("fireplace_flame", (-3.55, -1.1, 0.1), (-3.42, -0.6, 0.22), M("MAT_EMBER"), g)
    B("tvwall_console", (-3.58, -2.9, 0.1), (-3.3, -1.4, 0.42), M("MAT_BLACK"), g)
    for yy in (-3.55, -3.05):
        B(f"ladder_up_{yy}", (-3.58, yy, 0), (-3.3, yy + 0.05, 2.45), M("MAT_RED"), g)
    for i in range(7):
        B(f"ladder_rung_{i}", (-3.58, -3.55, 0.25 + i * 0.33), (-3.3, -3.0, 0.29 + i * 0.33), M("MAT_RED"), g)
    for i in range(4):
        B(f"book_{i}", (-3.5, -3.5 + i * 0.12, 0.29 + 0.33), (-3.38, -3.42 + i * 0.12, 0.55 + 0.33), M("MAT_SKY_BOOK"), g)
    B("console_ps5", (-3.5, -2.0, 0.42), (-3.38, -1.82, 0.7), M("MAT_CERAMIC"), g)
    # kitchen island (black marble + red base), stools
    kc = "FURN_KITCHEN"
    B("island_core", (1.3, -3.0, 0), (2.3, -0.2, 0.9), M("MAT_MARBLE_BLACK"), kc, uv=1.5)
    B("island_red", (1.18, -3.0, 0.06), (1.3, -0.2, 0.86), M("MAT_RED"), kc)
    B("island_top", (1.1, -3.05, 0.9), (2.75, -0.15, 0.95), M("MAT_MARBLE_BLACK"), kc, uv=1.5)
    B("island_sink", (1.5, -1.9, 0.945), (2.1, -1.4, 0.955), M("MAT_STEEL"), kc)
    CYL("tap_stem", (1.8, -1.45, 1.05), 0.012, 0.2, M("MAT_STEEL"), kc, segs=8)
    for i, y in enumerate((-2.6, -1.6, -0.6)):
        CYL(f"stool_seat_{i}", (3.05, y, 0.72), 0.2, 0.07, M("MAT_WALNUT"), kc)
        CYL(f"stool_post_{i}", (3.05, y, 0.36), 0.025, 0.7, M("MAT_BLACK"), kc, segs=8)
        CYL(f"stool_base_{i}", (3.05, y, 0.02), 0.22, 0.03, M("MAT_BLACK"), kc)
        B(f"stool_back_{i}", (3.19, y - 0.18, 0.76), (3.25, y + 0.18, 1.05), M("MAT_WALNUT"), kc)
    # hood over the island (hangs from the ceiling)
    B("hood_body", (1.2, -2.9, 2.2), (2.4, -0.3, 2.45), M("MAT_BLACK"), kc)
    for xx, yy in ((1.25, -2.85), (2.35, -2.85), (1.25, -0.35), (2.35, -0.35)):
        CYL(f"hood_rod_{xx}_{yy}", (xx, yy, 2.62), 0.006, 0.4, M("MAT_BLACK"), kc, segs=6)
    # kitchen run along the hallway partition
    B("kit_base", (0.4, 1.2, 0), (3.4, 1.74, 0.9), M("MAT_CABINET"), kc)
    B("kit_top", (0.4, 1.15, 0.9), (3.4, 1.74, 0.94), M("MAT_MARBLE_BLACK"), kc, uv=1.5)
    B("kit_upper", (0.4, 1.4, 1.55), (2.35, 1.74, 2.35), M("MAT_CABINET"), kc)
    B("kit_red_unit", (0.4, 1.12, 0.0), (0.9, 1.2, 0.9), M("MAT_RED"), kc)
    B("fridge", (2.45, 1.05, 0), (3.35, 1.74, 2.1), M("MAT_BLACK"), kc)
    B("fridge_handle", (2.5, 1.0, 0.9), (2.53, 1.05, 1.7), M("MAT_STEEL"), kc)
    B("fridge_red_trim", (2.45, 1.03, 0), (3.35, 1.05, 2.1), M("MAT_RED"), kc)
    B("kit_oven", (1.5, 1.2, 0.42), (2.3, 1.22, 0.82), M("MAT_BLACK"), kc)
    # green venetian blinds half-drawn across the front glass (reference feature)
    # living blinds are raised to 1.96 m so the sliding door below them is passable (kitchen ones stay half-drawn)
    for nm, a, b, n in (("living", -2.25, 0.45, 8), ("kitchen", 0.85, 3.15, 14)):
        for i in range(n):
            B(f"blind_{nm}_{i}", (a, Y0 + WT + 0.01, 2.5 - i * 0.07), (b, Y0 + WT + 0.09, 2.52 - i * 0.07), M("MAT_BLIND_GREEN"), g)
    potted_plant(g, 0.0, -3.1, 1.2)
    potted_plant(g, 3.1, -3.25, 1.1, 0)     # kitchen corner (was in the kitchen -> bedroom-two doorway)
    # surfboard accent on the hall partition
    SPH("surfboard", (-2.4, 1.72, 1.5), 0.3, M("MAT_SURF_GREEN"), g, sc=(0.45, 0.05, 2.6), segs=12)


def furnish_bed1():
    g = "FURN_BED1"
    WAVE_WALL("BED1_WAVE_WALL", -7.24, -3.62, 1.62, 0.03, 2.97, M("MAT_WALL_WHITE"), M("MAT_BLACK"), "FURN_BED1", axis_x_face=+1)
    B("rug", (-7.0, -3.4, 0.03), (-3.9, -0.3, 0.045), M("MAT_RUG"), g, uv=2.4)
    bed(g, "bed1", -5.95, -1.9, (-1, 0))
    nightstand(g, "ns_a", -6.85, -3.27)
    nightstand(g, "ns_b", -6.85, -0.5)
    B("bench", (-5.1, -2.9, 0.0), (-4.55, -0.9, 0.4), M("MAT_FABRIC_WHITE"), g)
    B("wardrobe", (-7.2, 1.14, 0), (-5.0, 1.64, 2.5), M("MAT_WALNUT"), g, uv=1.5)
    for i in range(4):
        B(f"wardrobe_handle_{i}", (-7.0 + i * 0.5, 1.1, 1.0), (-6.97 + i * 0.5, 1.14, 1.5), M("MAT_STEEL"), g)
    # blinds + sheer curtain at the front glass
    for i in range(12):
        B(f"blind_{i}", (-6.95, Y0 + WT + 0.01, 2.5 - i * 0.07), (-4.05, Y0 + WT + 0.09, 2.52 - i * 0.07), M("MAT_BLIND_GREEN"), g)
    potted_plant(g, -4.15, 1.3, 0.85)      # clear of the living->bedroom doorway (y 0.1..1.0)


def furnish_bath1():
    g = "FURN_BATH1"
    mw = M("MAT_MARBLE_WHITE")
    B("clad_left", (X0 + WT, 1.76, 0.05), (X0 + WT + 0.03, Y1 - WT, 3.0), mw, g, uv=1.5)
    B("clad_rear", (X0 + WT, Y1 - WT - 0.03, 0.05), (-3.66, Y1 - WT, 3.0), mw, g, uv=1.5)
    B("clad_front", (X0 + WT, 1.76, 0.05), (-3.66, 1.79, 3.0), mw, g, uv=1.5)
    # shower
    B("shower_tray", (-7.24, 1.8, 0.05), (-6.15, 3.45, 0.09), M("MAT_CERAMIC"), g)
    B("shower_glass", (-6.17, 1.8, 0.05), (-6.14, 3.2, 2.1), M("MAT_GLASS"), g)
    CYL("shower_arm", (-7.1, 2.6, 2.15), 0.012, 0.3, M("MAT_BLACK"), g, axis='x', segs=8)
    CYL("shower_head", (-6.9, 2.6, 2.13), 0.12, 0.015, M("MAT_BLACK"), g)
    CYL("shower_pipe", (-7.2, 2.6, 1.2), 0.012, 2.1, M("MAT_BLACK"), g, segs=8)
    # wall-hung toilet with dark tank panel + steel plate
    B("wc_panel", (-5.55, Y1 - WT - 0.1, 0.0), (-4.65, Y1 - WT, 1.3), M("MAT_WALNUT"), g)
    SPH("wc_bowl", (-5.1, Y1 - WT - 0.3, 0.36), 0.22, M("MAT_CERAMIC"), g, sc=(1, 1.4, 0.9), segs=12)
    CYL("wc_seat", (-5.1, Y1 - WT - 0.32, 0.42), 0.19, 0.03, M("MAT_FABRIC_TEAL"), g)
    B("wc_flush", (-5.2, Y1 - WT - 0.11, 0.95), (-5.0, Y1 - WT - 0.1, 1.1), M("MAT_STEEL"), g)
    # floating green shelves with towels
    for i, z in enumerate((1.55, 1.9)):
        B(f"shelf_{i}", (-5.6, Y1 - WT - 0.2, z), (-4.6, Y1 - WT, z + 0.04), M("MAT_SHELF_GREEN"), g)
    B("towels", (-5.4, Y1 - WT - 0.17, 1.59), (-5.05, Y1 - WT - 0.03, 1.72), M("MAT_FABRIC_WHITE"), g)
    # vanity + basin + mirror
    B("vanity", (-4.5, 3.0, 0.45), (-3.7, Y1 - WT, 0.9), M("MAT_BLACK"), g)
    B("basin", (-4.4, 3.05, 0.9), (-3.8, 3.45, 0.98), M("MAT_CERAMIC"), g)
    CYL("tap", (-4.1, 3.4, 1.05), 0.012, 0.2, M("MAT_BLACK"), g, segs=8)
    B("mirror", (-4.4, Y1 - WT - 0.03, 1.2), (-3.8, Y1 - WT - 0.01, 2.0), M("MAT_STEEL"), g)


def furnish_bed2():
    g = "FURN_BED2"
    B("curtain_wall", (7.2, -3.65, 0.03), (7.25, 1.6, 2.95), M("MAT_FABRIC_GREEN"), g, uv=1.2)
    for i in range(22):
        B(f"curtain_fold_{i}", (7.17, -3.6 + i * 0.235, 0.03), (7.2, -3.5 + i * 0.235, 2.95), M("MAT_FABRIC_GREEN"), g, uv=1.2)
    B("rug", (3.9, -3.4, 0.03), (6.9, -0.3, 0.045), M("MAT_RUG"), g, uv=2.4)
    bed(g, "bed2", 6.0, -1.9, (1, 0))
    nightstand(g, "ns_a", 6.85, -3.27)
    nightstand(g, "ns_b", 6.85, -0.5)
    # sofa with teal cushions at the foot of the bed
    B("sofa_base", (3.7, -3.0, 0.06), (4.5, -0.8, 0.45), M("MAT_FABRIC_WHITE"), g)
    B("sofa_back", (3.55, -3.0, 0.3), (3.8, -0.8, 0.9), M("MAT_FABRIC_WHITE"), g)
    for i, y in enumerate((-2.7, -1.9, -1.1)):
        SPH(f"teal_cushion_{i}", (3.95, y, 0.65), 0.22, M("MAT_FABRIC_TEAL"), g, sc=(0.5, 1.0, 1.0), segs=8)
    B("coffee_table", (4.8, -1.6, 0.0), (5.2, -0.6, 0.38), M("MAT_BLACK"), g)
    for i in range(12):
        B(f"blind_{i}", (4.05, Y0 + WT + 0.01, 2.5 - i * 0.07), (6.95, Y0 + WT + 0.09, 2.52 - i * 0.07), M("MAT_BLIND_GREEN"), g)
    potted_plant(g, 7.0, 1.32, 0.85)       # moved out of the kitchen->bedroom-two doorway
    B("wardrobe", (4.5, 1.14, 0), (6.7, 1.64, 2.5), M("MAT_WALNUT"), g, uv=1.5)


BED3_CY = -0.4      # bed centre (y); was 0.0 - moved so the stair-top landing is walkable


def furnish_bed3():
    g = "FURN_BED3"
    z = UZ0 + 0.02
    B("rug", (1.0, -1.6, z), (4.6, 1.3, z + 0.015), M("MAT_RUG"), g, uv=2.4)

    def bed_up():
        L, Wd, cx, cy = 2.1, 2.0, 5.95, BED3_CY
        B("bed3_base", (cx - L / 2, cy - Wd / 2, z), (cx + L / 2, cy + Wd / 2, z + 0.25), M("MAT_BLACK"), g)
        B("bed3_mattress", (cx - L / 2 + 0.04, cy - Wd / 2 + 0.04, z + 0.25), (cx + L / 2 - 0.04, cy + Wd / 2 - 0.04, z + 0.5), M("MAT_FABRIC_WHITE"), g)
        B("bed3_headboard", (7.0, cy - 1.15, z), (7.1, cy + 1.15, z + 1.3), M("MAT_BLACK"), g)
        B("bed3_headpad", (6.98, cy - 0.9, z + 0.4), (7.02, cy + 0.9, z + 1.1), M("MAT_GREY_CUSHION"), g)
        for k, yy in enumerate((cy - 0.5, cy + 0.5)):
            SPH(f"bed3_pillow{k}", (6.7, yy, z + 0.58), 0.3, M("MAT_FABRIC_WHITE"), g, sc=(0.8, 1.0, 0.35), segs=10)
        B("bed3_throw", (4.98, cy - 0.97, z + 0.5), (5.58, cy + 0.97, z + 0.53), M("MAT_GREY_CUSHION"), g)
    bed_up()
    # large white sofa with teal cushions facing the glass
    B("sofa3_base", (1.4, -1.3, z + 0.05), (2.5, 0.7, z + 0.45), M("MAT_FABRIC_WHITE"), g)
    B("sofa3_back", (1.3, -1.3, z + 0.3), (1.6, 0.7, z + 0.95), M("MAT_FABRIC_WHITE"), g)
    for i, y in enumerate((-0.9, -0.3, 0.3)):
        SPH(f"sofa3_cush_{i}", (1.85, y, z + 0.7), 0.24, M("MAT_FABRIC_TEAL" if i != 1 else "MAT_FABRIC_WHITE"), g, sc=(0.5, 1.0, 1.0), segs=8)
    B("coffee3", (3.3, -0.9, z), (3.9, -0.2, z + 0.38), M("MAT_BLACK"), g)
    nightstand_z = z
    # nightstands flank the (shifted) bed; ns3_b no longer blocks the stair landing
    B("ns3_a", (6.65, BED3_CY - 1.33, z), (7.05, BED3_CY - 1.03, z + 0.5), M("MAT_BLACK"), g)
    B("ns3_b", (6.65, BED3_CY + 1.03, z), (7.05, BED3_CY + 1.33, z + 0.5), M("MAT_BLACK"), g)
    # ensuite double vanity
    B("ens_vanity", (-0.7, 2.95, z + 0.45), (1.5, 3.5, z + 0.9), M("MAT_BLACK"), g)
    B("ens_top", (-0.72, 2.95, z + 0.9), (1.52, 3.5, z + 0.95), M("MAT_MARBLE_BLACK"), g, uv=1.2)
    for i, x in enumerate((-0.1, 0.9)):
        B(f"ens_basin_{i}", (x - 0.25, 3.0, z + 0.95), (x + 0.25, 3.4, z + 1.02), M("MAT_CERAMIC"), g)
        CYL(f"ens_tap_{i}", (x, 3.42, z + 1.1), 0.012, 0.2, M("MAT_BLACK"), g, segs=8)
        B(f"ens_mirror_{i}", (x - 0.25, 3.46, z + 1.25), (x + 0.25, 3.49, z + 2.1), M("MAT_STEEL"), g)
    potted_plant(g, 0.8, 1.55, 1.0, z)
    potted_plant(g, 3.2, 1.55, 1.1, z)


def furnish_hall():
    g = "FURN_HALL"
    B("console", (-0.85, 3.15, 0.0), (0.45, 3.5, 0.8), M("MAT_WALNUT"), g)       # clear of the rear slider
    B("console_mirror", (-0.65, 3.47, 1.0), (0.25, 3.5, 2.1), M("MAT_STEEL"), g)
    B("shoe_cabinet", (1.2, 3.1, 0), (2.8, 3.5, 1.0), M("MAT_BLACK"), g)
    potted_plant(g, -3.15, 3.2, 1.0)


def furnish_terrace_lights():
    pass


# ------------------------------------------------------------ DEVICE SET
def build_devices():
    tvm = M("MAT_TV_SCREEN")
    # ---------------- lights ----------------
    # living (ceiling downlights + LED cove) & pendant chandelier are separate devices
    for i, (x, y) in enumerate(((-2.5, -2.9), (-2.5, -1.1), (-0.3, -2.9), (-0.3, -1.1))):
        downlight(f"LIGHT_LIVING_CEILING_{i + 1}", "livingLight", "living", 0, (x, y, 2.95), color="#ffd9a0", lumens=1.0, rng=5.5)
    def cove_parts(p):
        em = emit_mat("livingLight")
        for nm, lo, hi in (("a", (-2.75, -2.95, 2.765), (0.35, -2.91, 2.78)), ("b", (-2.75, -0.09, 2.765), (0.35, -0.05, 2.78)),
                           ("c", (-2.75, -2.95, 2.765), (-2.71, -0.05, 2.78)), ("d", (0.31, -2.95, 2.765), (0.35, -0.05, 2.78))):
            B(f"LIGHT_LIVING_COVE_{nm}_BULB", lo, hi, em, "DEVICES", parent=p, keep=True)
    light_fixture("LIGHT_LIVING_COVE", "livingLight", "living", 0, (-1.2, -1.5, 2.7), color="#ffd0a0", lumens=0.0, rng=1.0, parts=cove_parts)
    ring_chandelier("LIGHT_LIVING_PENDANT", "livingPendant", "living", 0, (-1.6, -2.0 + LIVING_SOFA_DY, 2.35), 2.95)
    # kitchen
    strip_light("LIGHT_KITCHEN_HOOD", "kitchenLight", "kitchen", 0, (1.3, -2.8, 2.17), (2.3, -0.4, 2.2), color="#fff0d8", lumens=1.0, rng=5.0)
    for i, y in enumerate((-2.4, -1.0)):
        downlight(f"LIGHT_KITCHEN_CEILING_{i + 1}", "kitchenLight", "kitchen", 0, (2.9, y, 2.95), color="#fff0d8", lumens=0.9, rng=5.0)
    downlight("LIGHT_KITCHEN_TASK", "kitchenLight", "kitchen", 0, (1.8, 1.0, 2.95), color="#fff0d8", lumens=0.8, rng=4.5)
    # hallway (3 fixtures)
    for i, (x, y) in enumerate(((-2.4, 2.8), (0.0, 2.8), (2.2, 2.8))):
        downlight(f"LIGHT_HALL_CEILING_{i + 1}", "hallwayLight", "hallway", 0, (x, y, 2.95), color="#ffe2b0", lumens=0.9, rng=4.8)
    downlight("LIGHT_HALL_STAIR", "hallwayLight", "hallway", 0, (3.68, 2.7, 2.95), color="#ffe2b0", lumens=0.6, rng=4.0)
    # bedroom one: pendant globes either side of the bed + ceiling
    globe_pendant("LIGHT_BED1_PENDANT_L", "bedroomLight", "bedroom", 0, (-6.85, -3.27, 2.95), 1.0, color="#ffd9a0", lumens=0.9, rng=4.5)
    globe_pendant("LIGHT_BED1_PENDANT_R", "bedroomLight", "bedroom", 0, (-6.85, -0.5, 2.95), 1.0, color="#ffd9a0", lumens=0.9, rng=4.5)
    # bedroom two
    globe_pendant("LIGHT_BED2_PENDANT_L", "bedroom2Light", "bedroom2", 0, (6.85, -3.27, 2.95), 1.0, color="#ffd9a0", lumens=0.9, rng=4.5)
    globe_pendant("LIGHT_BED2_PENDANT_R", "bedroom2Light", "bedroom2", 0, (6.85, -0.5, 2.95), 1.0, color="#ffd9a0", lumens=0.9, rng=4.5)
    # bedroom three (under the sloped ceiling)
    globe_pendant("LIGHT_BED3_PENDANT_L", "bedroom3Light", "bedroom3", 1, (6.85, BED3_CY - 1.18, ZT(6.85)), 1.1, color="#ffd9a0", lumens=1.0, rng=5.0)
    globe_pendant("LIGHT_BED3_PENDANT_R", "bedroom3Light", "bedroom3", 1, (6.85, BED3_CY + 1.18, ZT(6.85)), 1.1, color="#ffd9a0", lumens=1.0, rng=5.0)
    downlight("LIGHT_BED3_CEILING", "bedroom3Light", "bedroom3", 1, (2.5, -0.6, ZT(2.5)), color="#ffe2b0", lumens=1.0, rng=5.5)
    # bathroom one
    downlight("LIGHT_BATH1_CEILING", "bathroomLight", "bathroom", 0, (-5.3, 2.7, 2.95), r=0.12, color="#ffffff", lumens=1.0, rng=4.2)
    strip_light("LIGHT_BATH1_MIRROR", "bathroomLight", "bathroom", 0, (-4.4, 3.46, 2.05), (-3.8, 3.49, 2.09), color="#ffffff", lumens=0.6, rng=2.5)
    # patio / exterior
    for i, (x, y) in enumerate(((-0.7, 0.8), (-0.7, -1.3))):
        e = empty(f"LIGHT_PATIO_WALL_{i + 1}", (UX0 - 0.1, y, 4.6), _extras("light", "patioLight", "patio", 1, color="#ffcf90", power=0.9, range=6.0), size=0.1)
        SPH(f"LIGHT_PATIO_WALL_{i + 1}_BULB", (UX0 - 0.1, y, 4.6), 0.07, emit_mat("patioLight", (1, 0.85, 0.6)), "DEVICES", parent=e, keep=True, segs=10)
    for i, (x, y) in enumerate(((-6.4, -4.2), (-2.0, -4.2))):
        e = empty(f"LIGHT_PATIO_POST_{i + 1}", (x, y, SLAB_TOP + 0.95), _extras("light", "patioLight", "patio", 1, color="#ffcf90", power=0.8, range=5.0), size=0.1)
        CYL(f"LIGHT_PATIO_POST_{i + 1}_BULB", (x, y, SLAB_TOP + 0.95), 0.05, 0.12, emit_mat("patioLight", (1, 0.85, 0.6)), "DEVICES", parent=e, keep=True, segs=10)
    for i, x in enumerate((-4.0, 4.0)):
        e = empty(f"LIGHT_FRONT_{i + 1}", (x, Y0 - 0.4, 2.7), _extras("light", "patioLight", "patio", 0, color="#ffcf90", power=0.6, range=4.5), size=0.1)
        SPH(f"LIGHT_FRONT_{i + 1}_BULB", (x, Y0 - 0.4, 2.7), 0.06, emit_mat("patioLight", (1, 0.85, 0.6)), "DEVICES", parent=e, keep=True, segs=10)

    # ---------------- fans ----------------
    ceiling_fan("LIVING", "fanLiving", "living", 0, -0.2, -0.15, SLAB_BOT - 0.04)
    ceiling_fan("BEDROOM1", "fanBedroom1", "bedroom", 0, -5.0, -1.9, SLAB_BOT - 0.04)
    ceiling_fan("BEDROOM2", "fanBedroom2", "bedroom2", 0, 5.0, -1.9, SLAB_BOT - 0.04)
    ceiling_fan("BEDROOM3", "fanBedroom3", "bedroom3", 1, 3.1, -0.5, ZT(3.1), drop=0.45)

    # ---------------- AC ----------------
    ac_unit("LIVING", "ac", "living", 0, (-2.4, 1.74, 2.55), 0)         # on the hall partition, faces -Y
    ac_unit("BEDROOM1", "acBedroom1", "bedroom", 0, (-4.5, 1.64, 2.55), 0)
    ac_unit("BEDROOM2", "acBedroom2", "bedroom2", 0, (3.95, 1.64, 2.55), 0)
    ac_unit("BEDROOM3", "acBedroom3", "bedroom3", 1, (2.7, UY1 - WT, UZ0 + 2.45), 0)   # rear wall inner face, protrudes toward -Y

    # ---------------- TV ----------------
    dy, dz = TV_DY, TV_DZ
    tv = empty("DEVICE_LIVING_TV", (-3.5, -2.1 + dy, 1.35 + dz), _extras("tv", "tv", "living", 0), size=0.2)
    kw = dict(group="DEVICES", parent=tv, keep=True)
    B("DEVICE_LIVING_TV_FRAME", (-3.54, -2.85 + dy, 0.95 + dz), (-3.46, -1.35 + dy, 1.78 + dz), M("MAT_BLACK"), **kw)
    QUAD("DEVICE_LIVING_TV_SCREEN", (-3.455, -2.8 + dy, 1.0 + dz), (-3.455, -1.4 + dy, 1.0 + dz), (-3.455, -1.4 + dy, 1.73 + dz), (-3.455, -2.8 + dy, 1.73 + dz), tvm, parent=tv)
    SPH("DEVICE_LIVING_TV_LED", (-3.455, -1.38 + dy, 0.97 + dz), 0.012, led_mat("tv", (1, 0.2, 0.15)), segs=8, **kw)

    # ---------------- purifier (living) ----------------
    PX, PY = -3.08, -3.22   # purifier in the corner by the shelving (was in front of the sliding door)
    pu = empty("DEVICE_LIVING_PURIFIER", (PX, PY, 0), _extras("purifier", "purifier", "living", 0), size=0.2)
    kw = dict(group="DEVICES", parent=pu, keep=True)
    CYL("DEVICE_LIVING_PURIFIER_BODY", (PX, PY, 0.45), 0.17, 0.9, M("MAT_DEVICE_WHITE"), segs=20, **kw)
    CYL("DEVICE_LIVING_PURIFIER_RING", (PX, PY, 0.92), 0.172, 0.03, led_mat("purifier", (0.3, 0.9, 1.0)), segs=20, **kw)
    pf = empty("DEVICE_LIVING_PURIFIER_FAN", (PX, PY, 0.98), {"kind": "purifier_fan", "device_id": "purifier"}, parent=pu, group="DEVICES", size=0.1)
    for i in range(6):
        a = i * 60
        Brot(f"DEVICE_LIVING_PURIFIER_VANE_{i}", (PX + 0.07 * math.cos(math.radians(a)), PY + 0.07 * math.sin(math.radians(a)), 0.985),
             (0.1, 0.02, 0.012), (0, 0, a), M("MAT_BLACK"), "DEVICES", parent=pf, keep=True)

    # ---------------- coffee machine (kitchen counter) ----------------
    co = empty("DEVICE_KITCHEN_COFFEE", (1.3, 1.45, 0.94), _extras("coffee", "coffee", "kitchen", 0), size=0.2)
    kw = dict(group="DEVICES", parent=co, keep=True)
    B("DEVICE_KITCHEN_COFFEE_BODY", (1.05, 1.25, 0.94), (1.55, 1.68, 1.3), M("MAT_STEEL"), **kw)
    B("DEVICE_KITCHEN_COFFEE_HEAD", (1.1, 1.25, 1.2), (1.5, 1.52, 1.34), M("MAT_BLACK"), **kw)
    CYL("DEVICE_KITCHEN_COFFEE_CUP", (1.3, 1.4, 0.98), 0.03, 0.05, M("MAT_CERAMIC"), segs=10, **kw)
    SPH("DEVICE_KITCHEN_COFFEE_LED", (1.45, 1.245, 1.12), 0.012, led_mat("coffee", (1, 0.55, 0.1)), segs=8, **kw)

    # ---------------- security keypad (hall) ----------------
    sc = empty("DEVICE_HALL_SECURITY", (-3.0, 1.86, 1.4), _extras("security", "security", "hallway", 0), size=0.2)
    kw = dict(group="DEVICES", parent=sc, keep=True)
    B("DEVICE_HALL_SECURITY_PANEL", (-3.12, 1.86, 1.3), (-2.88, 1.9, 1.52), M("MAT_BLACK"), **kw)
    SPH("DEVICE_HALL_SECURITY_LED", (-2.94, 1.915, 1.47), 0.012, led_mat("security", (0.2, 0.9, 0.4)), segs=8, **kw)

    # ---------------- bathroom door (hinged leaf) ----------------
    hinge = empty("DOOR_BATH1", (-3.6, 2.3, 0.0), _extras("hinge", "doorBathroom", "bathroom", 0, open_deg=-100.0), size=0.2)
    B("DOOR_BATH1_LEAF", (-3.64, 2.3, 0.02), (-3.58, 3.2, 2.15), M("MAT_WALNUT"), "DEVICES", parent=hinge, keep=True)
    B("DOOR_BATH1_HANDLE", (-3.66, 3.05, 1.0), (-3.56, 3.12, 1.04), M("MAT_STEEL"), "DEVICES", parent=hinge, keep=True)

    # ---------------- sensors ----------------
    sensor_motion("LIVING", "living", 0, (-1.45, -0.2, 2.95))
    sensor_motion("KITCHEN", "kitchen", 0, (2.2, 0.5, 2.95))
    sensor_motion("HALL", "hallway", 0, (0.0, 3.2, 2.95))
    sensor_motion("BED1", "bedroom", 0, (-4.3, -3.2, 2.95))
    sensor_motion("BED2", "bedroom2", 0, (4.3, -3.2, 2.95))
    sensor_motion("BED3", "bedroom3", 1, (1.0, -1.2, ZT(1.0)))
    sensor_motion("BATH1", "bathroom", 0, (-4.2, 2.5, 2.95))
    sensor_motion("PATIO", "patio", 1, (-3.0, -4.0, SLAB_TOP + 0.05))
    for key, room, lvl, loc in (("LIVING", "living", 0, (-3.5, -0.3, 1.5)), ("KITCHEN", "kitchen", 0, (3.3, 0.6, 1.5)),
                                ("HALL", "hallway", 0, (-3.0, 1.86, 1.0)), ("BED1", "bedroom", 0, (-4.4, -3.6, 1.5)),
                                ("BED2", "bedroom2", 0, (4.4, -3.6, 1.5)), ("BED3", "bedroom3", 1, (-0.7, 1.0, 4.6)),
                                ("BATH1", "bathroom", 0, (-3.66, 3.4, 1.5))):
        sensor_env(key, room, lvl, loc)


def room_markers():
    zc = (0.0, 3.0)
    room_marker("living", "LIVING", 0, (-3.54, Y0 + WT, 0), (0.6, 1.74, 3.0))
    room_marker("kitchen", "KITCHEN", 0, (0.6, Y0 + WT, 0), (3.34, 1.74, 3.0))
    room_marker("hallway", "HALLWAY", 0, (-3.54, 1.86, 0), (3.34, Y1 - WT, 3.0))
    room_marker("hallway", "HALLWAY_STAIR", 0, (3.46, 1.76, 0), (X1 - WT, Y1 - WT, 3.0))
    room_marker("bedroom", "BEDROOM_1", 0, (X0 + WT, Y0 + WT, 0), (-3.66, 1.64, 3.0))
    room_marker("bathroom", "BATHROOM_1", 0, (X0 + WT, 1.76, 0), (-3.66, Y1 - WT, 3.0))
    room_marker("bedroom2", "BEDROOM_2", 0, (3.46, Y0 + WT, 0), (X1 - WT, 1.64, 3.0))
    room_marker("bedroom3", "BEDROOM_3", 1, (UX0 + WT, UY0 + WT, UZ0), (UX1 - WT, UY1 - WT, 6.2))
    room_marker("patio", "PATIO", 1, (X0, SY0, SLAB_TOP), (UX0, Y1, SLAB_TOP + 3.0))


# ======================================================== ROOM CAMERAS
# Eye-level room-tour presets authored here (the authoring tool) and exported as glTF extras.
# Each CAM_<room> empty sits at the eye position; extras.target is the look-at point already
# converted to glTF Y-up metres, so the runtime can use it directly. These are validated
# against the exported triangles by tests/geometry.test.mjs (clearance, line of sight, floor/ceiling).
EYE = 1.6
ROOM_CAMERAS = {
    # room_id: (eye xy, floor z, look-at xyz, fov)
    "living":   ((-0.25, 1.25), 0.03, (-2.8, -1.6, 1.0), 62),
    "kitchen":  ((2.6, 0.65), 0.03, (0.4, -3.3, 1.25), 64),
    "bedroom":  ((-4.15, 0.55), 0.03, (-6.6, -2.2, 0.7), 64),
    "bathroom": ((-4.05, 2.2), 0.05, (-6.6, 3.0, 1.0), 72),
    "hallway":  ((-3.0, 2.45), 0.03, (3.0, 2.75, 1.2), 64),
    "bedroom2": ((3.95, 0.5), 0.03, (6.6, -2.2, 0.7), 64),
    "bedroom3": ((2.15, 1.55), UZ0 + 0.02, (6.2, -0.8, UZ0 + 0.6), 64),
    "patio":    ((-1.65, 2.55), SLAB_TOP + 0.04, (-5.6, -2.4, SLAB_TOP + 0.5), 64),
}


def to_gltf(p):
    """Blender Z-up (x, y, z) -> glTF Y-up (x, z, -y)."""
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def room_cameras():
    for rid, ((x, y), fz, tgt, fov) in ROOM_CAMERAS.items():
        empty(f"CAM_{rid.upper()}", (x, y, fz + EYE),
              {"kind": "camera", "room_id": rid, "target": to_gltf(tgt), "fov": fov,
               "floor_y": round(fz, 4), "eye_height": EYE},
              group="ROOMS", size=0.25)


# =================================================================== MAIN
def build(out_glb=None, out_blend=None):
    L.reset_scene()
    make_textures.generate_all()
    materials()
    shell()
    ground_interior()
    upper()
    roof()
    terrace_and_site()
    furnish_living()
    furnish_bed1()
    furnish_bath1()
    furnish_bed2()
    furnish_bed3()
    furnish_hall()
    build_devices()
    room_markers()
    room_cameras()
    L.finalize_static()
    # root metadata
    meta = empty("SWITCH_VILLA_META", (0, 0, 0), {
        "kind": "meta", "generator": "blender/build_villa.py",
        "note": "Original reconstruction from screenshots; not the paid Sketchfab asset.",
        "coordinate_system": "Blender Z-up; exported glTF Y-up; front facade = +Z in three.js"},
        group="ROOMS", size=0.2)
    out_glb = out_glb or os.path.join(ROOT, "public", "models", "switch_villa.glb")
    out_blend = out_blend or os.path.join(HERE, "out", "switch_villa.blend")
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    os.makedirs(os.path.dirname(out_blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    L.export_glb(out_glb)
    n_obj = len(bpy.data.objects)
    n_tri = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f"[SWITCH] objects={n_obj} polys={n_tri} materials={len(bpy.data.materials)}")
    print(f"[SWITCH] wrote {out_glb} ({os.path.getsize(out_glb) / 1e6:.2f} MB)")
    print(f"[SWITCH] wrote {out_blend}")


if __name__ == "__main__":
    build()
