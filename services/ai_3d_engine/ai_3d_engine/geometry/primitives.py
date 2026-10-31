"""Primitive solids for the CSG kernel. All dimensions in millimetres."""

from __future__ import annotations

import math

import numpy as np

from .csg import Polygon, Solid


def box(size_x: float, size_y: float, size_z: float, origin=(0.0, 0.0, 0.0)) -> Solid:
    """Axis-aligned box whose minimum corner sits at ``origin``."""
    if min(size_x, size_y, size_z) <= 0:
        raise ValueError("box dimensions must be positive")
    ox, oy, oz = origin
    x0, y0, z0 = ox, oy, oz
    x1, y1, z1 = ox + size_x, oy + size_y, oz + size_z
    c = np.array(
        [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
         [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
    )
    quads = [
        [0, 3, 2, 1],  # bottom (-z)
        [4, 5, 6, 7],  # top (+z)
        [0, 1, 5, 4],  # front (-y)
        [2, 3, 7, 6],  # back (+y)
        [1, 2, 6, 5],  # right (+x)
        [3, 0, 4, 7],  # left (-x)
    ]
    return Solid([Polygon(c[q]) for q in quads])


def cylinder(radius: float, height: float, center=(0.0, 0.0, 0.0), axis: str = "z", segments: int = 48) -> Solid:
    """Cylinder starting at ``center`` (base centre) and extending +height along ``axis``.

    ``segments`` is the polygon count; the true circle is inscribed. For holes we
    circumscribe instead (see ``hole``) so a printed hole is never undersized.
    """
    if radius <= 0 or height <= 0:
        raise ValueError("cylinder radius/height must be positive")
    angles = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    ring = np.stack([radius * np.cos(angles), radius * np.sin(angles), np.zeros(segments)], axis=1)
    bottom = ring
    top = ring + [0, 0, height]
    polys = [Polygon(bottom[::-1].copy()), Polygon(top.copy())]
    for i in range(segments):
        j = (i + 1) % segments
        polys.append(Polygon(np.array([bottom[i], bottom[j], top[j], top[i]])))
    solid = Solid(polys)
    if axis == "x":
        solid = solid.rotated("y", 90)
    elif axis == "y":
        solid = solid.rotated("x", -90)
    elif axis != "z":
        raise ValueError(f"unknown axis {axis!r}")
    return solid.translated(*center)


def hole(diameter: float, depth: float, center=(0.0, 0.0, 0.0), axis: str = "z", segments: int = 48) -> Solid:
    """Cylinder sized so the *inscribed* circle of the polygon equals ``diameter``.

    A screw of the requested diameter therefore always fits the printed hole.
    """
    r = (diameter / 2.0) / math.cos(math.pi / segments)
    return cylinder(r, depth, center=center, axis=axis, segments=segments)


def prism(profile_2d, length: float, plane: str = "yz", offset: float = 0.0) -> Solid:
    """Extrude a *convex* 2-D polygon.

    ``plane="yz"`` means the profile is given as (y, z) points and is extruded
    along +x from ``offset`` to ``offset + length``. Non-convex outlines must be
    composed from several convex prisms with ``union``.
    """
    pts = np.asarray(profile_2d, dtype=np.float64)
    if len(pts) < 3:
        raise ValueError("profile needs at least 3 points")
    # enforce counter-clockwise order in the profile plane
    area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area < 0:
        pts = pts[::-1]
    if not _is_convex(pts):
        raise ValueError("prism profile must be convex; compose concave shapes with union()")
    n = len(pts)
    if plane == "yz":
        a = np.column_stack([np.full(n, offset), pts[:, 0], pts[:, 1]])
        b = a + [length, 0, 0]
    elif plane == "xz":
        # (x, z) profile extruded along +y; flip order to keep outward normals
        a = np.column_stack([pts[:, 0], np.full(n, offset), pts[:, 1]])[::-1]
        b = a + [0, length, 0]
    elif plane == "xy":
        a = np.column_stack([pts[:, 0], pts[:, 1], np.full(n, offset)])[::-1]
        b = a + [0, 0, length]
    else:
        raise ValueError(f"unknown plane {plane!r}")
    polys = [Polygon(a[::-1].copy()), Polygon(b.copy())]
    for i in range(n):
        j = (i + 1) % n
        polys.append(Polygon(np.array([a[i], a[j], b[j], b[i]])))
    solid = Solid(polys)
    return solid if plane == "yz" else _orient(solid)


def _orient(solid: Solid) -> Solid:
    """Flip every polygon if the solid came out inside-out (negative volume)."""
    from .csg import Solid as _S

    mesh = solid.to_mesh()
    if mesh.signed_volume() < 0:
        return _S([p.flipped() for p in solid.polygons])
    return solid


def _is_convex(pts: np.ndarray) -> bool:
    n = len(pts)
    sign = 0
    for i in range(n):
        o, a, b = pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        cross = (a[0] - o[0]) * (b[1] - a[1]) - (a[1] - o[1]) * (b[0] - a[0])
        if abs(cross) < 1e-12:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return False
    return True
