"""
Reusable Blender (bpy) helpers for the SWITCH villa reconstruction.

Coordinate system (Blender, Z-up, metres):
  +X = right when facing the front facade, -Y = FRONT facade (street side),
  +Y = rear, Z = up.  glTF export converts to Y-up, so in three.js the front
  facade faces +Z.

Conventions
  * Static geometry is built in WORLD coordinates and joined per
    (group, material) at the end -> few, descriptively named meshes.
  * Interactive things (lights, fans, AC, doors, TV, sensors ...) are built as
    an EMPTY (named, carrying custom properties that export as glTF `extras`)
    with child meshes, so the runtime finds them by name / device_id and never
    by array index.
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")

_MATS = {}
_REG = {}          # (group, material name) -> [objects]  (to be joined)
_COLLS = {}


# ------------------------------------------------------------------ scene
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()
    _REG.clear()
    _COLLS.clear()
    bpy.context.scene.unit_settings.system = 'METRIC'


def coll(name):
    if name not in _COLLS:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        _COLLS[name] = c
    return _COLLS[name]


# ------------------------------------------------------------- materials
def mat(name, color=(0.8, 0.8, 0.8), rough=0.6, metal=0.0, tex=None,
        emit=None, emit_strength=0.0, alpha=None, tex_rough=None):
    """Create (or fetch) a Principled material. `tex` is a file stem in
    blender/textures. `alpha` < 1 makes a glass-like blended material."""
    key = name
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    if tex:
        img = bpy.data.images.load(os.path.join(TEX, tex + ".jpg"))
        img.name = "TEX_" + tex
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    _MATS[key] = m
    return m


def M(name):
    return _MATS[name]


# ------------------------------------------------------------- primitives
def _uv(bm, scale):
    """World/local box-projection UVs in metres / scale (dominant-axis)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = l.vert.co
            if ax == 2:
                u, v = p.x, p.y
            elif ax == 1:
                u, v = p.x, p.z
            else:
                u, v = p.y, p.z
            l[uv].uv = (u / scale, v / scale)


def _finish(bm, name, material, group, loc, uv, smooth, parent, keep):
    bm.normal_update()
    _uv(bm, uv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if material is not None:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    c = coll(group.split("__")[0] if group else (parent.users_collection[0].name if parent and parent.users_collection else "DEVICES"))
    c.objects.link(ob)
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    if group and not keep:
        _REG.setdefault((group, material.name if material else "NONE"), []).append(ob)
    return ob


_BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (3, 0, 4, 7), (1, 2, 6, 5)]


def Q8(name, v8, material, group, uv=1.0, parent=None, keep=False, origin=(0, 0, 0)):
    """General hexahedron from 8 corners ordered like a box:
    bottom (x0y0, x1y0, x1y1, x0y1) then the same four at the top."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(v) - Vector(origin)) for v in v8]
    for f in _BOX_FACES:
        bm.faces.new([vs[i] for i in f])
    return _finish(bm, name, material, group, origin, uv, False, parent, keep)


def B(name, lo, hi, material, group, uv=1.0, parent=None, keep=False):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v8 = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
          (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    return Q8(name, v8, material, group, uv, parent, keep)


def Bc(name, c, s, material, group, uv=1.0, parent=None, keep=False):
    return B(name, (c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2),
             (c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2),
             material, group, uv, parent, keep)


def Brot(name, c, s, rot_deg, material, group, uv=1.0, parent=None, keep=False):
    """Centre/size box rotated by Euler XYZ degrees about its centre."""
    R = Euler([math.radians(a) for a in rot_deg], 'XYZ').to_matrix()
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    corners = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
               (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    v8 = [tuple(Vector(c) + R @ Vector(p)) for p in corners]
    return Q8(name, v8, material, group, uv, parent, keep)


def CYL(name, c, r, h, material, group, axis='z', segs=24, r2=None, smooth=True,
        parent=None, keep=False, uv=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=(r if r2 is None else r2), depth=h)
    rot = {'z': Matrix.Identity(3),
           'x': Euler((0, math.radians(90), 0)).to_matrix(),
           'y': Euler((math.radians(90), 0, 0)).to_matrix()}[axis]
    for v in bm.verts:
        v.co = rot @ v.co
    return _finish(bm, name, material, group, c, uv, smooth, parent, keep)


def SPH(name, c, r, material, group, sc=(1, 1, 1), segs=16, parent=None, keep=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * sc[0], v.co.y * sc[1], v.co.z * sc[2]))
    return _finish(bm, name, material, group, c, 1.0, True, parent, keep)


def TOR(name, c, R, r, material, group, segs=32, tsegs=8, parent=None, keep=False):
    bm = bmesh.new()
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = []
        for j in range(tsegs):
            b = 2 * math.pi * j / tsegs
            rr = R + r * math.cos(b)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        verts.append(ring)
    for i in range(segs):
        for j in range(tsegs):
            bm.faces.new([verts[i][j], verts[(i + 1) % segs][j],
                          verts[(i + 1) % segs][(j + 1) % tsegs], verts[i][(j + 1) % tsegs]])
    return _finish(bm, name, material, group, c, 1.0, True, parent, keep)


def WAVE_WALL(name, x, y0, y1, z0, z1, mat_a, mat_b, group, amp=0.07, period=0.55,
              strips=36, nz=10, axis_x_face=+1):
    """Vertical wavy wall (two alternating materials) facing +X or -X.
    Reproduces the black/white wave feature wall of Bedroom One."""
    bm = bmesh.new()
    ys = [y0 + (y1 - y0) * i / strips for i in range(strips + 1)]
    zs = [z0 + (z1 - z0) * j / nz for j in range(nz + 1)]
    grid = []
    for j, z in enumerate(zs):
        row = []
        for i, y in enumerate(ys):
            # a diagonal wave: offset depends on y and z
            off = amp * math.sin((y / period + z * 0.9) * 2 * math.pi / 1.0)
            row.append(bm.verts.new((x + axis_x_face * off, y, z)))
        grid.append(row)
    for j in range(nz):
        for i in range(strips):
            vs = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            if axis_x_face < 0:
                vs = vs[::-1]
            f = bm.faces.new(vs)
            f.material_index = (i // 2 + j // 1) % 2
    ob = _finish(bm, name, mat_a, None, (0, 0, 0), 1.0, True, None, True)
    ob.data.materials.append(mat_b)
    c = coll(group)
    return ob


# ----------------------------------------------------- devices / empties
def empty(name, loc=(0, 0, 0), extras=None, parent=None, group="DEVICES", size=0.1,
          scale=(1, 1, 1), display='PLAIN_AXES'):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = display
    e.empty_display_size = size
    e.location = loc
    e.scale = scale
    coll(group).objects.link(e)
    if parent is not None:
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    for k, v in (extras or {}).items():
        e[k] = v
    bpy.context.view_layer.update()
    return e


def finalize_static():
    """Join static meshes per (group, material) into descriptive objects."""
    for (group, mname), objs in sorted(_REG.items()):
        if not objs:
            continue
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        # Bake every object's transform into its mesh BEFORE joining. (Repair: the join used to keep the
        # first object's local frame and then zero its location, which shifted whole groups whenever the
        # first object was a cylinder/sphere placed off-origin - e.g. the living-room TV console and
        # fireplace ended up ~1.8 m into the room.)
        bpy.context.view_layer.update()
        for o in objs:
            if o.matrix_world != Matrix.Identity(4):
                o.data.transform(o.matrix_world)
                o.matrix_world = Matrix.Identity(4)
        target = objs[0]
        for o in objs:
            o.select_set(True)
        with bpy.context.temp_override(active_object=target, selected_objects=objs,
                                       selected_editable_objects=objs, object=target):
            if len(objs) > 1:
                bpy.ops.object.join()
        target.name = f"{group}__{mname.replace('MAT_', '').lower()}"
        target.data.name = target.name
        target.location = (0, 0, 0)
    _REG.clear()


def export_glb(path, extras=True):
    bpy.ops.object.select_all(action='DESELECT')
    kw = dict(filepath=path, export_format='GLB', export_extras=extras,
              export_apply=True, export_yup=True, export_cameras=False,
              export_lights=False, export_animations=False,
              export_image_format='JPEG', export_jpeg_quality=82,
              export_texcoords=True, export_normals=True)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        for k in ("export_jpeg_quality", "export_lights"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)


def QUAD(name, p0, p1, p2, p3, material, group="DEVICES", parent=None, keep=True):
    """Single quad with explicit (0,0)-(1,1) UVs (used for the TV screen)."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in (p0, p1, p2, p3)]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.verify()
    for l, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uv].uv = t
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    coll(group).objects.link(ob)
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


def yaw_rot(local, yaw_deg):
    a = math.radians(yaw_deg)
    return (local[0] * math.cos(a) - local[1] * math.sin(a),
            local[0] * math.sin(a) + local[1] * math.cos(a), local[2])
