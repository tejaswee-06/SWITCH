"""
Procedural texture generator for the SWITCH villa (original, license-free).

Every texture is generated with numpy from a FIXED seed, so the output is
reproducible. No third-party images are used. Run standalone:

    python blender/make_textures.py

build_villa.py calls generate_all() automatically if textures are missing.
"""
import os
import numpy as np
from PIL import Image

N = 512
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures")


def vnoise(rng, sy, sx, n=N):
    """Tileable value noise on an (sy x sx) lattice, upsampled to n x n."""
    g = rng.random((sy, sx))
    ys = np.linspace(0, sy, n, endpoint=False)
    xs = np.linspace(0, sx, n, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    y1, x1 = (y0 + 1) % sy, (x0 + 1) % sx
    a, b = g[y0][:, x0], g[y0][:, x1]
    c, d = g[y1][:, x0], g[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(rng, base=4, octaves=5, aniso=(1, 1)):
    out, amp, tot = np.zeros((N, N)), 1.0, 0.0
    for o in range(octaves):
        s = base * (2 ** o)
        out += amp * vnoise(rng, max(2, s * aniso[0]), max(2, s * aniso[1]))
        tot += amp
        amp *= 0.5
    return out / tot


def save(name, arr):
    arr = np.clip(arr, 0, 1)
    Image.fromarray((arr * 255).astype(np.uint8)).save(
        os.path.join(OUT, name + ".jpg"), quality=88)


def tint(base, v, k=0.25):
    base = np.array(base, dtype=float)
    return base[None, None, :] * (1 - k + 2 * k * v[..., None])


def planks(seed, base, count=8, k=0.22, grain=0.10, groove=0.35):
    rng = np.random.default_rng(seed)
    rows = np.arange(N) * count // N
    per = rng.random(count + 1)[rows][:, None] * np.ones((1, N))
    g = fbm(rng, 2, 4, aniso=(8, 1))
    v = 0.5 * per + 0.5 * g
    img = tint(base, v, k)
    img *= (1 - grain + grain * 2 * fbm(rng, 4, 3, aniso=(12, 1)))[..., None]
    edge = (np.arange(N) * count % N) < 3
    img[edge, :, :] *= (1 - groove)
    # staggered butt joints
    for r in range(count):
        x = int(rng.random() * N)
        y0, y1 = r * N // count, (r + 1) * N // count
        img[y0:y1, x:x + 2, :] *= (1 - groove)
    return img


def tiles(seed, base, grout, n=4, k=0.10, gap=4):
    rng = np.random.default_rng(seed)
    idx = np.arange(N) * n // N
    cell = rng.random((n, n))[idx][:, idx]
    img = tint(base, cell * 0.6 + 0.4 * fbm(rng, 6, 4), k)
    ey = (np.arange(N) * n % N) < gap
    img[ey, :, :] = grout
    img[:, ey, :] = grout
    return img


def marble(seed, base, vein, strength=1.0, freq=6.0, sharp=14.0):
    rng = np.random.default_rng(seed)
    f = fbm(rng, 3, 6)
    yy, xx = np.mgrid[0:N, 0:N] / N
    t = np.abs(np.sin((xx * 0.8 + yy * 0.6) * freq * np.pi + f * 9.0))
    m = np.exp(-sharp * t) * strength
    m2 = np.exp(-sharp * 0.5 * np.abs(np.sin((xx * 0.3 - yy * 0.9) * freq * 0.6 * np.pi + f * 7.0))) * 0.35
    m = np.clip(m + m2 * strength, 0, 1)[..., None]
    base_img = tint(base, fbm(rng, 4, 4), 0.06)
    return base_img * (1 - m) + np.array(vein)[None, None, :] * m


def fabric(seed, base, weave=64, k=0.12):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    w = 0.5 + 0.25 * np.sin(xx * weave * np.pi * 2) + 0.25 * np.sin(yy * weave * np.pi * 2)
    v = 0.6 * w + 0.4 * fbm(rng, 16, 3)
    return tint(base, v, k)


def grass(seed):
    rng = np.random.default_rng(seed)
    v = 0.5 * fbm(rng, 16, 5) + 0.5 * vnoise(rng, 128, 128)
    a = np.array([0.16, 0.42, 0.10])
    b = np.array([0.30, 0.60, 0.16])
    return a[None, None, :] * (1 - v[..., None]) + b[None, None, :] * v[..., None]


def subway(seed, base, grout, rows=16, cols=6):
    rng = np.random.default_rng(seed)
    ry = np.arange(N) * rows // N
    shift = (ry % 2) * 0.5
    xx = (np.arange(N)[None, :] * cols / N + shift[:, None])
    cx = np.floor(xx).astype(int) % cols
    val = rng.random((rows, cols))[ry[:, None], cx]
    img = tint(base, 0.5 * val + 0.5 * fbm(rng, 8, 3), 0.10)
    gy = (np.arange(N) * rows % N) < 3
    gx = (xx % 1.0) < 0.02
    img[gy, :, :] = grout
    img[gx] = grout
    return img


def rug(seed, a, b):
    yy, xx = np.mgrid[0:N, 0:N] / N
    d = np.maximum(np.abs(xx - 0.5), np.abs(yy - 0.5))
    ring = (np.floor(d * 14) % 2 == 0)
    maze = (np.floor((xx + yy) * 14) % 2 == 0)
    m = np.where(d > 0.42, ring, ring ^ (maze & (d < 0.3)))
    img = np.where(m[..., None], np.array(a)[None, None, :], np.array(b)[None, None, :])
    return img * (0.94 + 0.06 * fbm(np.random.default_rng(seed), 16, 3))[..., None]


def roof_metal(seed):
    rng = np.random.default_rng(seed)
    xx = np.arange(N)[None, :] * 8 // N
    seam = ((np.arange(N)[None, :] * 8 % N) < 5).astype(float)
    base = np.array([0.075, 0.08, 0.09])
    img = np.ones((N, N, 1)) * base[None, None, :]
    img = img * (0.9 + 0.2 * fbm(rng, 4, 3, aniso=(1, 6)))[..., None]
    img = img * (1 + 1.4 * seam[..., None])
    return np.tile(img, (1, 1, 1))


def wall_plaster(seed):
    rng = np.random.default_rng(seed)
    return tint([0.93, 0.93, 0.91], fbm(rng, 8, 5), 0.03)


def generate_all(force=False):
    os.makedirs(OUT, exist_ok=True)
    jobs = {
        "plank_grey": lambda: planks(1, [0.66, 0.70, 0.72], 8, 0.10, 0.06),
        "oak": lambda: planks(2, [0.74, 0.55, 0.34], 10, 0.20, 0.12),
        "walnut": lambda: planks(3, [0.20, 0.12, 0.09], 6, 0.30, 0.15),
        "paving": lambda: tiles(4, [0.30, 0.34, 0.40], [0.12, 0.14, 0.16], 4, 0.12),
        "terrace_tile": lambda: tiles(5, [0.72, 0.74, 0.76], [0.45, 0.47, 0.5], 4, 0.07),
        "marble_white": lambda: marble(6, [0.90, 0.92, 0.95], [0.42, 0.48, 0.60], 0.9),
        "marble_black": lambda: marble(7, [0.035, 0.035, 0.045], [0.78, 0.74, 0.62], 0.7, 4.0, 20.0),
        "fabric_navy": lambda: fabric(8, [0.07, 0.10, 0.22]),
        "fabric_white": lambda: fabric(9, [0.90, 0.89, 0.86], 48, 0.06),
        "fabric_teal": lambda: fabric(10, [0.12, 0.42, 0.42]),
        "fabric_green": lambda: fabric(11, [0.10, 0.36, 0.30], 24, 0.2),
        "grass": lambda: grass(12),
        "tile_green": lambda: subway(13, [0.05, 0.50, 0.36], [0.82, 0.84, 0.82]),
        "rug_blue": lambda: rug(14, [0.12, 0.22, 0.42], [0.88, 0.88, 0.84]),
        "roof_metal": lambda: roof_metal(15),
        "plaster": lambda: wall_plaster(16),
    }
    for name, fn in jobs.items():
        p = os.path.join(OUT, name + ".jpg")
        if force or not os.path.exists(p):
            save(name, fn())
    return OUT


if __name__ == "__main__":
    print("textures ->", generate_all(force=True))
