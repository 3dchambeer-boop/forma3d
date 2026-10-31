"""Exact constructive solid geometry on polygon meshes (BSP-tree method).

This is a Python port of the algorithm used by csg.js (Evan Wallace, MIT
licence): each solid is a set of convex planar polygons, Booleans are computed
by clipping polygons against binary space partitioning trees.

Why ship our own kernel instead of a mesh library:
  * results are exact to floating point (no voxelisation, so a 90 mm part is
    90 mm, not 89.6 mm), which matters for functional parts;
  * it has no native dependencies, so the engine runs anywhere numpy runs;
  * ``ManifoldKernel`` (manifold3d) can replace it later behind the same
    ``Solid`` API if parts become large enough for performance to matter.

The raw BSP output contains T-junctions where one face was split and its
neighbour was not; ``Solid.to_mesh`` welds vertices and removes them, so the
result is a closed, edge-manifold triangle mesh. The validation service checks
that claim independently on every export.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .mesh import Mesh

EPS = 1e-5  # mm; classification tolerance for coplanar tests

COPLANAR, FRONT, BACK, SPANNING = 0, 1, 2, 3


@dataclass
class Plane:
    normal: np.ndarray
    w: float

    @staticmethod
    def from_points(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> "Plane":
        n = np.cross(b - a, c - a)
        n = n / np.linalg.norm(n)
        return Plane(n, float(n @ a))

    def flipped(self) -> "Plane":
        return Plane(-self.normal, -self.w)

    def split_polygon(self, poly: "Polygon", coplanar_front: list, coplanar_back: list, front: list, back: list) -> None:
        dists = poly.points @ self.normal - self.w
        types = np.where(dists < -EPS, BACK, np.where(dists > EPS, FRONT, COPLANAR))
        polygon_type = 0
        for t in types:
            polygon_type |= int(t)
        if polygon_type == COPLANAR:
            (coplanar_front if self.normal @ poly.plane.normal > 0 else coplanar_back).append(poly)
        elif polygon_type == FRONT:
            front.append(poly)
        elif polygon_type == BACK:
            back.append(poly)
        else:
            f, b = [], []
            pts = poly.points
            n = len(pts)
            for i in range(n):
                j = (i + 1) % n
                ti, tj = types[i], types[j]
                vi, vj = pts[i], pts[j]
                if ti != BACK:
                    f.append(vi)
                if ti != FRONT:
                    b.append(vi)
                if (ti | tj) == SPANNING:
                    t = (self.w - self.normal @ vi) / (self.normal @ (vj - vi))
                    v = vi + (vj - vi) * t
                    f.append(v)
                    b.append(v)
            if len(f) >= 3:
                front.append(Polygon(np.array(f), poly.plane))
            if len(b) >= 3:
                back.append(Polygon(np.array(b), poly.plane))


class Polygon:
    __slots__ = ("points", "plane")

    def __init__(self, points: np.ndarray, plane: Plane | None = None):
        self.points = np.asarray(points, dtype=np.float64)
        self.plane = plane or Plane.from_points(self.points[0], self.points[1], self.points[2])

    def flipped(self) -> "Polygon":
        return Polygon(self.points[::-1].copy(), self.plane.flipped())


class _Node:
    __slots__ = ("plane", "front", "back", "polygons")

    def __init__(self, polygons: list[Polygon] | None = None):
        self.plane: Plane | None = None
        self.front: _Node | None = None
        self.back: _Node | None = None
        self.polygons: list[Polygon] = []
        if polygons:
            self.build(polygons)

    def invert(self) -> None:
        stack = [self]
        while stack:
            node = stack.pop()
            node.polygons = [p.flipped() for p in node.polygons]
            if node.plane is not None:
                node.plane = node.plane.flipped()
            node.front, node.back = node.back, node.front
            stack.extend(n for n in (node.front, node.back) if n is not None)

    def clip_polygons(self, polygons: list[Polygon]) -> list[Polygon]:
        if self.plane is None:
            return list(polygons)
        front: list[Polygon] = []
        back: list[Polygon] = []
        for p in polygons:
            self.plane.split_polygon(p, front, back, front, back)
        if self.front is not None:
            front = self.front.clip_polygons(front)
        if self.back is not None:
            back = self.back.clip_polygons(back)
        else:
            back = []
        return front + back

    def clip_to(self, bsp: "_Node") -> None:
        stack = [self]
        while stack:
            node = stack.pop()
            node.polygons = bsp.clip_polygons(node.polygons)
            stack.extend(n for n in (node.front, node.back) if n is not None)

    def all_polygons(self) -> list[Polygon]:
        out: list[Polygon] = []
        stack = [self]
        while stack:
            node = stack.pop()
            out.extend(node.polygons)
            stack.extend(n for n in (node.front, node.back) if n is not None)
        return out

    def build(self, polygons: list[Polygon]) -> None:
        # Iterative build: avoids Python recursion limits on larger solids.
        work = [(self, polygons)]
        while work:
            node, polys = work.pop()
            if not polys:
                continue
            if node.plane is None:
                node.plane = polys[0].plane
            front: list[Polygon] = []
            back: list[Polygon] = []
            for p in polys:
                node.plane.split_polygon(p, node.polygons, node.polygons, front, back)
            if front:
                if node.front is None:
                    node.front = _Node()
                work.append((node.front, front))
            if back:
                if node.back is None:
                    node.back = _Node()
                work.append((node.back, back))


class Solid:
    """Immutable-style solid: every operation returns a new ``Solid``."""

    def __init__(self, polygons: list[Polygon]):
        self.polygons = polygons

    # --------------------------------------------------------------- booleans
    def union(self, other: "Solid") -> "Solid":
        a, b = _Node(self._clone()), _Node(other._clone())
        a.clip_to(b)
        b.clip_to(a)
        b.invert()
        b.clip_to(a)
        b.invert()
        a.build(b.all_polygons())
        return Solid(a.all_polygons())

    def subtract(self, other: "Solid") -> "Solid":
        a, b = _Node(self._clone()), _Node(other._clone())
        a.invert()
        a.clip_to(b)
        b.clip_to(a)
        b.invert()
        b.clip_to(a)
        b.invert()
        a.build(b.all_polygons())
        a.invert()
        return Solid(a.all_polygons())

    def intersect(self, other: "Solid") -> "Solid":
        a, b = _Node(self._clone()), _Node(other._clone())
        a.invert()
        b.clip_to(a)
        b.invert()
        a.clip_to(b)
        b.clip_to(a)
        a.build(b.all_polygons())
        a.invert()
        return Solid(a.all_polygons())

    def __or__(self, other: "Solid") -> "Solid":
        return self.union(other)

    def __sub__(self, other: "Solid") -> "Solid":
        return self.subtract(other)

    def __and__(self, other: "Solid") -> "Solid":
        return self.intersect(other)

    def _clone(self) -> list[Polygon]:
        return [Polygon(p.points.copy(), p.plane) for p in self.polygons]

    # ------------------------------------------------------------- transforms
    def transformed(self, matrix: np.ndarray) -> "Solid":
        m = np.asarray(matrix, dtype=np.float64)
        flip = np.linalg.det(m[:3, :3]) < 0
        out = []
        for p in self.polygons:
            pts = p.points @ m[:3, :3].T + m[:3, 3]
            if flip:
                pts = pts[::-1]
            out.append(Polygon(pts))
        return Solid(out)

    def translated(self, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> "Solid":
        m = np.eye(4)
        m[:3, 3] = (x, y, z)
        return self.transformed(m)

    def rotated(self, axis: str, degrees: float) -> "Solid":
        return self.transformed(rotation(axis, degrees))

    # ------------------------------------------------------------- export
    def to_mesh(self, weld_tolerance: float = 1e-4) -> Mesh:
        verts: list[np.ndarray] = []
        faces: list[list[int]] = []
        for p in self.polygons:
            base = len(verts)
            verts.extend(p.points)
            for k in range(1, len(p.points) - 1):
                faces.append([base, base + k, base + k + 1])
        if not faces:
            return Mesh.empty()
        mesh = Mesh(np.asarray(verts), np.asarray(faces)).merged_vertices(weld_tolerance)
        mesh = mesh.without_degenerate_faces(area_eps=1e-10)
        return remove_t_junctions(mesh, tolerance=weld_tolerance * 5)


# ------------------------------------------------------------------ helpers


def rotation(axis: str, degrees: float) -> np.ndarray:
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    if axis == "x":
        m[1:3, 1:3] = [[c, -s], [s, c]]
    elif axis == "y":
        m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, s, -s, c
    elif axis == "z":
        m[0:2, 0:2] = [[c, -s], [s, c]]
    else:
        raise ValueError(f"unknown axis {axis!r}")
    return m


def remove_t_junctions(mesh: Mesh, tolerance: float = 5e-4, max_passes: int = 20) -> Mesh:
    """Split triangles whose edges pass through another vertex.

    After a BSP boolean, a face on one side of an edge may have been cut while
    its neighbour was not, leaving a vertex in the middle of the neighbour's
    edge. Those edges show up as "boundary" edges even though the surface is
    geometrically closed. Splitting the neighbour at that vertex closes it.
    """
    verts = [v for v in mesh.vertices]
    faces = [list(f) for f in mesh.faces]
    for _ in range(max_passes):
        boundary = _boundary_half_edges(np.asarray(faces))
        if not boundary:
            break
        varr = np.asarray(verts)
        split_map: dict[int, dict[int, list[int]]] = {}
        for fi, (a, b) in boundary:
            pa, pb = varr[a], varr[b]
            d = pb - pa
            length2 = float(d @ d)
            if length2 == 0:
                continue
            t = (varr - pa) @ d / length2
            closest = pa + np.outer(t, d)
            dist = np.linalg.norm(varr - closest, axis=1)
            inside = [int(i) for i in np.where((t > 1e-9) & (t < 1 - 1e-9) & (dist < tolerance))[0] if i not in (a, b)]
            if inside:
                inside.sort(key=lambda i: t[i])
                split_map.setdefault(fi, {})[a] = inside
        if not split_map:
            break
        new_faces: list[list[int]] = []
        for fi, f in enumerate(faces):
            if fi not in split_map:
                new_faces.append(f)
                continue
            poly: list[int] = []
            for k in range(3):
                poly.append(f[k])
                poly.extend(split_map[fi].get(f[k], []))
            # Fan around the triangle centroid: always valid for a convex polygon and,
            # unlike a corner fan, never creates zero-area triangles along a split edge.
            centre = len(verts)
            verts.append(varr[f].mean(axis=0))
            for k in range(len(poly)):
                new_faces.append([centre, poly[k], poly[(k + 1) % len(poly)]])
        faces = new_faces
    return Mesh(np.asarray(verts), np.asarray(faces, dtype=np.int64)).without_degenerate_faces(area_eps=1e-12)


def _boundary_half_edges(faces: np.ndarray) -> list[tuple[int, tuple[int, int]]]:
    if len(faces) == 0:
        return []
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    face_ids = np.tile(np.arange(len(faces)), 3)
    key = np.sort(edges, axis=1)
    _, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    single = counts[inv] == 1
    return [(int(face_ids[i]), (int(edges[i, 0]), int(edges[i, 1]))) for i in np.where(single)[0]]
