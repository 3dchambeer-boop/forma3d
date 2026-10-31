"""Mesh file I/O: STL (binary + ASCII), GLB/glTF-binary, OBJ.

Only geometry is read. Materials, textures and animation are ignored on
purpose: a printer needs a closed surface, not a material graph.

Every reader validates sizes before allocating, because these files come from
users and from third-party providers and must be treated as untrusted input.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from .mesh import Mesh


class MeshFormatError(ValueError):
    """The file is not a readable mesh of the declared type."""


MAX_TRIANGLES = 5_000_000  # hard ceiling; callers apply stricter, configurable limits

# ---------------------------------------------------------------------------- STL

_STL_HEADER = 80
_STL_RECORD = 50  # 12 floats + uint16 attribute


def _stl_is_binary(data: bytes) -> bool:
    if len(data) < _STL_HEADER + 4:
        return False
    (count,) = struct.unpack_from("<I", data, _STL_HEADER)
    # Binary STL files may start with "solid" too, so trust the size equation first.
    return len(data) == _STL_HEADER + 4 + count * _STL_RECORD


def read_stl(data: bytes) -> Mesh:
    if _stl_is_binary(data):
        (count,) = struct.unpack_from("<I", data, _STL_HEADER)
        if count > MAX_TRIANGLES:
            raise MeshFormatError(f"STL declares {count} triangles, above limit {MAX_TRIANGLES}")
        rec = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
        arr = np.frombuffer(data, dtype=rec, count=count, offset=_STL_HEADER + 4)
        tris = arr["v"].astype(np.float64)
    else:
        head = data[:512].lstrip().lower()
        if not head.startswith(b"solid"):
            raise MeshFormatError("not an STL file (neither binary size match nor ASCII 'solid')")
        tris = _read_ascii_stl(data)
    if not np.all(np.isfinite(tris)):
        raise MeshFormatError("STL contains NaN or infinite coordinates")
    n = len(tris)
    # Weld bit-identical corners only: any tolerance here would silently change the file's topology.
    return Mesh(tris.reshape(-1, 3), np.arange(n * 3).reshape(-1, 3)).merged_exact()


def _read_ascii_stl(data: bytes) -> np.ndarray:
    coords: list[list[float]] = []
    for raw in data.decode("ascii", errors="strict").splitlines():
        parts = raw.strip().split()
        if parts and parts[0] == "vertex":
            if len(parts) != 4:
                raise MeshFormatError("malformed ASCII STL vertex line")
            coords.append([float(parts[1]), float(parts[2]), float(parts[3])])
            if len(coords) > MAX_TRIANGLES * 3:
                raise MeshFormatError("ASCII STL exceeds triangle limit")
    if len(coords) % 3:
        raise MeshFormatError("ASCII STL vertex count is not a multiple of 3")
    return np.asarray(coords, dtype=np.float64).reshape(-1, 3, 3)


def write_stl(mesh: Mesh, header: str = "ai_3d_engine binary STL, units=mm") -> bytes:
    tris = mesh.triangles().astype(np.float32)
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]).astype(np.float64)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 0).astype(np.float32)
    rec = np.zeros(len(tris), dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    rec["n"] = normals
    rec["v"] = tris
    hdr = header.encode("ascii", errors="replace")[:_STL_HEADER].ljust(_STL_HEADER, b" ")
    return hdr + struct.pack("<I", len(tris)) + rec.tobytes()


# ---------------------------------------------------------------------------- GLB

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _accessor(gltf: dict, bin_chunk: bytes, index: int) -> np.ndarray:
    acc = gltf["accessors"][index]
    if "sparse" in acc:
        raise MeshFormatError("sparse glTF accessors are not supported")
    view = gltf["bufferViews"][acc["bufferView"]]
    if view.get("buffer", 0) != 0:
        raise MeshFormatError("external glTF buffers are not supported (GLB must be self-contained)")
    dtype = np.dtype(_COMPONENT[acc["componentType"]])
    ncomp = _NCOMP[acc["type"]]
    count = int(acc["count"])
    start = int(view.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
    stride = int(view.get("byteStride", 0)) or dtype.itemsize * ncomp
    end = start + stride * (count - 1) + dtype.itemsize * ncomp if count else start
    if end > len(bin_chunk) or start < 0:
        raise MeshFormatError("glTF accessor points outside the binary chunk")
    if stride == dtype.itemsize * ncomp:
        out = np.frombuffer(bin_chunk, dtype=dtype, count=count * ncomp, offset=start).reshape(count, ncomp)
    else:
        out = np.lib.stride_tricks.as_strided(
            np.frombuffer(bin_chunk, dtype=np.uint8, offset=start),
            shape=(count, ncomp * dtype.itemsize),
            strides=(stride, 1),
        ).copy().view(dtype).reshape(count, ncomp)
    if acc.get("normalized"):
        raise MeshFormatError("normalized integer positions are not supported")
    return out.astype(np.float64) if dtype == np.float32 else out.astype(np.int64)


def _node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T  # column-major
    t = np.asarray(node.get("translation", [0, 0, 0]), dtype=np.float64)
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    s = np.asarray(node.get("scale", [1, 1, 1]), dtype=np.float64)
    r = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def read_glb(data: bytes) -> Mesh:
    if len(data) < 20:
        raise MeshFormatError("file too small to be GLB")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise MeshFormatError("not a glTF 2.0 binary (GLB) file")
    if length != len(data):
        raise MeshFormatError("GLB length header does not match file size (truncated download?)")
    offset, gltf, bin_chunk = 12, None, b""
    while offset + 8 <= len(data):
        clen, ctype = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8 : offset + 8 + clen]
        if ctype == b"JSON":
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == b"BIN\x00":
            bin_chunk = chunk
        offset += 8 + clen
    if gltf is None:
        raise MeshFormatError("GLB has no JSON chunk")
    unsupported = {"KHR_draco_mesh_compression", "EXT_meshopt_compression"} & set(gltf.get("extensionsRequired", []))
    if unsupported:
        raise MeshFormatError(f"compressed GLB not supported: {sorted(unsupported)}")

    parts: list[Mesh] = []
    total = 0

    def visit(node_index: int, parent: np.ndarray, depth: int) -> None:
        nonlocal total
        if depth > 64:
            raise MeshFormatError("glTF node hierarchy too deep")
        node = gltf["nodes"][node_index]
        world = parent @ _node_matrix(node)
        if "mesh" in node:
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                mode = prim.get("mode", 4)
                if mode != 4:
                    continue  # points/lines carry no surface
                pos = _accessor(gltf, bin_chunk, prim["attributes"]["POSITION"])
                if "indices" in prim:
                    idx = _accessor(gltf, bin_chunk, prim["indices"]).reshape(-1)
                else:
                    idx = np.arange(len(pos))
                if len(idx) % 3:
                    raise MeshFormatError("triangle index count is not a multiple of 3")
                if len(idx) and (idx.min() < 0 or idx.max() >= len(pos)):
                    raise MeshFormatError("glTF index out of range")
                total += len(idx) // 3
                if total > MAX_TRIANGLES:
                    raise MeshFormatError("GLB exceeds triangle limit")
                parts.append(Mesh(pos, idx.reshape(-1, 3)).transformed(world))
        for child in node.get("children", []):
            visit(child, world, depth + 1)

    scene_index = gltf.get("scene", 0)
    scenes = gltf.get("scenes")
    roots = scenes[scene_index]["nodes"] if scenes else range(len(gltf.get("nodes", [])))
    for root in roots:
        visit(root, np.eye(4), 0)
    mesh = Mesh.concatenate(parts)
    if not np.all(np.isfinite(mesh.vertices)):
        raise MeshFormatError("GLB contains NaN or infinite coordinates")
    return mesh


# ---------------------------------------------------------------------------- OBJ


def read_obj(data: bytes) -> Mesh:
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    for raw in data.decode("utf-8", errors="replace").splitlines():
        parts = raw.split()
        if not parts:
            continue
        if parts[0] == "v" and len(parts) >= 4:
            verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif parts[0] == "f" and len(parts) >= 4:
            idx = []
            for token in parts[1:]:
                i = int(token.split("/")[0])
                idx.append(i - 1 if i > 0 else len(verts) + i)
            for k in range(1, len(idx) - 1):  # fan-triangulate polygons
                faces.append([idx[0], idx[k], idx[k + 1]])
            if len(faces) > MAX_TRIANGLES:
                raise MeshFormatError("OBJ exceeds triangle limit")
    if not faces:
        raise MeshFormatError("OBJ contains no faces")
    try:
        return Mesh(np.asarray(verts), np.asarray(faces))
    except ValueError as exc:
        raise MeshFormatError(str(exc)) from exc


# ---------------------------------------------------------------------------- dispatch


def sniff_format(data: bytes, filename: str | None = None) -> str:
    """Decide the format from content first; the extension is only a tiebreaker."""
    if data[:4] == b"glTF":
        return "glb"
    if _stl_is_binary(data) or data[:512].lstrip().lower().startswith(b"solid"):
        return "stl"
    ext = Path(filename or "").suffix.lower()
    if ext == ".obj" or b"\nv " in data[:4096] or data.startswith(b"v "):
        return "obj"
    raise MeshFormatError("unrecognised mesh format (expected STL, GLB or OBJ)")


def load_mesh(data: bytes, filename: str | None = None) -> tuple[Mesh, str]:
    fmt = sniff_format(data, filename)
    reader = {"glb": read_glb, "stl": read_stl, "obj": read_obj}[fmt]
    return reader(data), fmt
