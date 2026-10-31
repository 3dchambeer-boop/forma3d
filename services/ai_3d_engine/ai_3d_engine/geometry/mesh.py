"""Indexed triangle mesh with the handful of operations the engine needs.

Units are millimetres everywhere in the engine. STL files carry no unit, so the
unit lives in the job record, never in the file.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Mesh:
    vertices: np.ndarray  # (N, 3) float64
    faces: np.ndarray  # (M, 3) int64, counter-clockwise when seen from outside

    def __post_init__(self) -> None:
        self.vertices = np.ascontiguousarray(self.vertices, dtype=np.float64).reshape(-1, 3)
        self.faces = np.ascontiguousarray(self.faces, dtype=np.int64).reshape(-1, 3)
        if len(self.faces) and (self.faces.min() < 0 or self.faces.max() >= len(self.vertices)):
            raise ValueError("face index out of range")

    # ------------------------------------------------------------------ basics
    @classmethod
    def empty(cls) -> "Mesh":
        return cls(np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64))

    @property
    def is_empty(self) -> bool:
        return len(self.faces) == 0

    def copy(self) -> "Mesh":
        return Mesh(self.vertices.copy(), self.faces.copy())

    def triangles(self) -> np.ndarray:
        """(M, 3, 3) array of triangle corner coordinates."""
        return self.vertices[self.faces]

    def bounds(self) -> np.ndarray:
        """[[minx, miny, minz], [maxx, maxy, maxz]]."""
        if len(self.vertices) == 0:
            return np.zeros((2, 3))
        used = self.vertices[np.unique(self.faces)] if len(self.faces) else self.vertices
        return np.array([used.min(axis=0), used.max(axis=0)])

    def extents(self) -> np.ndarray:
        b = self.bounds()
        return b[1] - b[0]

    def face_normals_raw(self) -> np.ndarray:
        t = self.triangles()
        return np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])

    def face_areas(self) -> np.ndarray:
        return 0.5 * np.linalg.norm(self.face_normals_raw(), axis=1)

    def area(self) -> float:
        return float(self.face_areas().sum())

    def signed_volume(self) -> float:
        """Divergence-theorem volume; positive for a closed, outward-oriented mesh."""
        if self.is_empty:
            return 0.0
        t = self.triangles()
        return float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6.0)

    # ---------------------------------------------------------- transforms
    def transformed(self, matrix: np.ndarray) -> "Mesh":
        m = np.asarray(matrix, dtype=np.float64)
        v = self.vertices @ m[:3, :3].T + m[:3, 3]
        faces = self.faces
        if np.linalg.det(m[:3, :3]) < 0:  # mirroring flips orientation
            faces = faces[:, ::-1]
        return Mesh(v, faces.copy())

    def translated(self, offset) -> "Mesh":
        return Mesh(self.vertices + np.asarray(offset, dtype=np.float64), self.faces.copy())

    def scaled(self, factor) -> "Mesh":
        f = np.broadcast_to(np.asarray(factor, dtype=np.float64), (3,))
        m = np.eye(4)
        m[0, 0], m[1, 1], m[2, 2] = f
        return self.transformed(m)

    @staticmethod
    def concatenate(meshes: list["Mesh"]) -> "Mesh":
        meshes = [m for m in meshes if not m.is_empty]
        if not meshes:
            return Mesh.empty()
        verts, faces, offset = [], [], 0
        for m in meshes:
            verts.append(m.vertices)
            faces.append(m.faces + offset)
            offset += len(m.vertices)
        return Mesh(np.vstack(verts), np.vstack(faces))

    # --------------------------------------------------------------- cleanup
    def merged_vertices(self, tolerance: float = 1e-6) -> "Mesh":
        """Weld vertices closer than ``tolerance`` (grid-quantised) and drop unused ones."""
        if self.is_empty:
            return Mesh.empty()
        q = np.round(self.vertices / tolerance).astype(np.int64)
        _, first, inverse = np.unique(q, axis=0, return_index=True, return_inverse=True)
        inverse = inverse.reshape(-1)
        faces = inverse[self.faces]
        # unique() orders by quantised key; keep the original coordinate of the first occurrence
        verts = self.vertices[first]
        used = np.unique(faces)
        remap = np.full(len(verts), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        return Mesh(verts[used], remap[faces])

    def merged_exact(self) -> "Mesh":
        """Weld only bit-identical vertices (how shared corners appear in an STL triangle soup)."""
        if self.is_empty:
            return Mesh.empty()
        uniq, inverse = np.unique(self.vertices, axis=0, return_inverse=True)
        return Mesh(uniq, inverse.reshape(-1)[self.faces])

    def as_float32(self) -> "Mesh":
        """Round coordinates to what an STL file can store, so validation sees the exported geometry."""
        return Mesh(self.vertices.astype(np.float32).astype(np.float64), self.faces.copy())

    def without_degenerate_faces(self, area_eps: float = 1e-12) -> "Mesh":
        f = self.faces
        distinct = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
        keep = distinct & (self.face_areas() > area_eps)
        return Mesh(self.vertices, f[keep])

    def without_duplicate_faces(self) -> "Mesh":
        """Drop faces that repeat the same vertex set (in either winding)."""
        if self.is_empty:
            return self.copy()
        key = np.sort(self.faces, axis=1)
        _, idx = np.unique(key, axis=0, return_index=True)
        return Mesh(self.vertices, self.faces[np.sort(idx)])
