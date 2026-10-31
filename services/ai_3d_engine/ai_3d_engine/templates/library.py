"""Built-in parametric templates.

Every builder places the part flat on the build plate: min z = 0, the largest
flat face down, x/y starting at 0. Geometry is exact (CSG), so the requested
millimetre values appear unchanged in the exported STL.
"""

from __future__ import annotations

import math

from ..geometry.csg import Solid
from ..geometry.primitives import box, cylinder, hole, prism
from .base import Param, Template

# ------------------------------------------------------------------ phone stand


def _phone_stand(p: dict) -> Solid:
    W, H, a = p["width"], p["height"], math.radians(p["tilt_angle"])
    t, lip, gap = p["thickness"], p["lip_height"], p["phone_thickness"]
    y0 = t + gap  # front face of the support plate's foot
    # support plate: slab of thickness t leaning back at angle a from horizontal
    length = (H - t) / math.sin(a) + t  # long enough to be cut flat at height H
    dir_up = (math.cos(a), math.sin(a))
    back = (math.sin(a), -math.cos(a))  # unit normal pointing behind/below the plate
    p0 = (y0, t)
    p1 = (y0 + dir_up[0] * length, t + dir_up[1] * length)
    p2 = (p1[0] + back[0] * t, p1[1] + back[1] * t)
    p3 = (p0[0] + back[0] * t, p0[1] + back[1] * t)
    plate = prism([p0, p1, p2, p3], W, plane="yz")
    top_of_plate_y = max(p1[0], p2[0])
    depth = max(p["base_depth"], top_of_plate_y + 4.0)
    # clip the plate to the requested height
    plate = plate & box(W + 2, depth + 20, H, origin=(-1, -10, 0))

    base = box(W, depth, t)
    front_lip = box(W, t, t + lip)

    # rear gussets under the plate (one at each side) for stiffness
    gw = min(10.0, W / 5)
    under_y = y0 + t / math.sin(a)  # where the plate underside meets the base top
    hb = 0.45 * (H - t)
    # The sloped edge is pushed half a wall into the plate so gusset and plate overlap in
    # volume; touching along a line only would create a non-manifold edge.
    sink = 0.5 * t
    ay, az = under_y - back[0] * sink, t - back[1] * sink
    by, bz = under_y + hb / math.tan(a) - back[0] * sink, t + hb - back[1] * sink
    cy = under_y + hb / math.tan(a)
    profile = [(ay, t - 0.01), (cy, t - 0.01), (cy, bz - (cy - by) * math.tan(a)), (by, bz), (ay, az)]
    gussets = prism(profile, gw, plane="yz") | prism(profile, gw, plane="yz", offset=W - gw)

    solid = base | front_lip | plate | gussets
    if p["charging_slot"] >= 0.5:
        s = p["slot_width"]
        cut = box(s, y0 + t + 2.0, t + lip + 2.0, origin=(W / 2 - s / 2, -1.0, -1.0))
        solid = solid - cut
    return solid


def _phone_stand_req(p: dict) -> list[str]:
    req = [
        f"The stand shall be {p['width']:g} mm wide (X) and {p['height']:g} mm tall (Z).",
        f"The phone rest shall lean back at {p['tilt_angle']:g}° from horizontal.",
        f"The ledge shall accept a phone up to {p['phone_thickness']:g} mm thick behind a {p['lip_height']:g} mm lip.",
        f"All load-bearing walls shall be {p['thickness']:g} mm thick.",
    ]
    if p["charging_slot"] >= 0.5:
        req.append(f"A {p['slot_width']:g} mm cable slot shall pass through the lip and base under the phone's port.")
    return req


PHONE_STAND = Template(
    key="phone_stand",
    title_ar="حامل هاتف مكتبي",
    title_en="Desk phone stand",
    keywords=("حامل هاتف", "حامل جوال", "حامل موبايل", "حامل للهاتف", "حامل الهاتف", "ستاند", "phone stand", "phone holder", "mobile stand", "phone dock"),
    params=(
        Param("width", 90, 40, 220, "mm", "العرض", "Width", ("عرض", "width", "wide")),
        Param("height", 110, 50, 250, "mm", "الارتفاع", "Height", ("ارتفاع", "طول", "height", "tall", "high")),
        Param("tilt_angle", 65, 45, 85, "deg", "زاوية الميل", "Tilt angle", ("زاوية", "ميل", "angle", "tilt")),
        Param("base_depth", 80, 50, 200, "mm", "عمق القاعدة", "Base depth", ("عمق", "depth", "deep")),
        Param("thickness", 5, 2, 12, "mm", "السماكة", "Wall thickness", ("سماكة", "سمك", "thickness", "thick")),
        Param("lip_height", 12, 4, 30, "mm", "ارتفاع الحافة", "Lip height", ("حافة", "lip")),
        Param("phone_thickness", 12, 7, 25, "mm", "سماكة الهاتف", "Phone thickness (with case)", ()),
        Param("charging_slot", 0, 0, 1, "bool", "فتحة شحن", "Charging cable slot", ()),
        Param("slot_width", 14, 8, 30, "mm", "عرض فتحة الشحن", "Cable slot width", ()),
    ),
    build=_phone_stand,
    requirements=_phone_stand_req,
    key_params=("width", "height", "tilt_angle"),
)

# ------------------------------------------------------------------ open box


def _box(p: dict) -> Solid:
    L, W, H, t, f = p["length"], p["width"], p["height"], p["wall"], p["floor"]
    solid = box(L, W, H) - box(L - 2 * t, W - 2 * t, H, origin=(t, t, f))
    n = int(round(p["dividers"]))
    if n > 0:
        pitch = (L - 2 * t) / (n + 1)
        for i in range(1, n + 1):
            x = t + pitch * i - t / 2
            solid = solid | box(t, W - 2 * t + 0.02, H - f - 2 if H - f > 6 else H - f, origin=(x, t - 0.01, f - 0.01))
    return solid


def _box_req(p: dict) -> list[str]:
    inner = (p["length"] - 2 * p["wall"], p["width"] - 2 * p["wall"], p["height"] - p["floor"])
    req = [
        f"Outer size shall be {p['length']:g} × {p['width']:g} × {p['height']:g} mm.",
        f"Inner cavity shall be {inner[0]:g} × {inner[1]:g} × {inner[2]:g} mm (open top).",
        f"Walls shall be {p['wall']:g} mm and the floor {p['floor']:g} mm thick.",
    ]
    if int(round(p["dividers"])):
        req.append(f"The cavity shall be split by {int(round(p['dividers']))} evenly spaced dividers.")
    return req


OPEN_BOX = Template(
    key="open_box",
    title_ar="علبة مفتوحة / منظّم",
    title_en="Open box / organiser",
    keywords=("علبة", "صندوق", "منظم", "منظّم", "حاوية", "box", "container", "organizer", "organiser", "tray", "bin"),
    params=(
        Param("length", 100, 15, 220, "mm", "الطول", "Length", ("طول", "length", "long")),
        Param("width", 60, 15, 220, "mm", "العرض", "Width", ("عرض", "width", "wide")),
        Param("height", 40, 8, 200, "mm", "الارتفاع", "Height", ("ارتفاع", "عمق", "height", "tall", "deep")),
        Param("wall", 2, 1.2, 8, "mm", "سماكة الجدار", "Wall thickness", ("سماكة", "سمك", "جدار", "wall", "thickness")),
        Param("floor", 2, 1.2, 8, "mm", "سماكة القاع", "Floor thickness", ("قاع", "أرضية", "floor", "bottom")),
        Param("dividers", 0, 0, 8, "count", "عدد الفواصل", "Dividers", ("فواصل", "أقسام", "dividers", "compartments")),
    ),
    build=_box,
    requirements=_box_req,
    key_params=("length", "width", "height"),
)

# ------------------------------------------------------------------ L bracket


def _l_bracket(p: dict) -> Solid:
    W, A, B, t, d = p["width"], p["leg_a"], p["leg_b"], p["thickness"], p["hole_diameter"]
    solid = box(W, A, t) | box(W, t, B)
    if p["gusset"] >= 0.5:
        g = min(A, B) * 0.6
        tri = [(t - 0.01, t - 0.01), (t + g, t - 0.01), (t - 0.01, t + g)]
        gw = min(t, W / 4)
        solid = solid | prism(tri, gw, plane="yz", offset=W / 2 - gw / 2)
    n = int(round(p["holes_per_leg"]))
    if n > 0 and d > 0:
        for i in range(n):
            x = W * (i + 1) / (n + 1)
            # holes are placed off the gusset centre line when there is a single hole
            if n == 1 and p["gusset"] >= 0.5:
                x = W * 0.25
            solid = solid - hole(d, t + 2, center=(x, t + (A - t) / 2, -1), axis="z")
            solid = solid - hole(d, t + 2, center=(x, -1, t + (B - t) / 2), axis="y")
    return solid


def _l_bracket_req(p: dict) -> list[str]:
    req = [
        f"Each leg shall be {p['width']:g} mm wide and {p['thickness']:g} mm thick.",
        f"Legs shall measure {p['leg_a']:g} mm (horizontal) and {p['leg_b']:g} mm (vertical) at 90°.",
    ]
    n = int(round(p["holes_per_leg"]))
    if n:
        req.append(f"Each leg shall have {n} clearance hole(s) of at least {p['hole_diameter']:g} mm.")
    if p["gusset"] >= 0.5:
        req.append("A triangular gusset shall stiffen the inside corner.")
    return req


L_BRACKET = Template(
    key="l_bracket",
    title_ar="زاوية تثبيت L",
    title_en="L bracket",
    keywords=("زاوية تثبيت", "كتيفة", "زاوية حديد", "زاوية رف", "حامل رف", "bracket", "angle bracket", "corner brace", "shelf bracket"),
    params=(
        Param("width", 30, 10, 200, "mm", "العرض", "Width", ("عرض", "width", "wide")),
        Param("leg_a", 50, 15, 200, "mm", "طول الضلع الأفقي", "Horizontal leg", ("ضلع", "طول", "length", "leg")),
        Param("leg_b", 50, 15, 200, "mm", "طول الضلع العمودي", "Vertical leg", ("ارتفاع", "height")),
        Param("thickness", 5, 2, 15, "mm", "السماكة", "Thickness", ("سماكة", "سمك", "thickness", "thick")),
        Param("hole_diameter", 4.5, 0, 12, "mm", "قطر الثقب", "Hole diameter", ("قطر", "ثقب", "براغي", "diameter", "hole", "screw")),
        Param("holes_per_leg", 2, 0, 4, "count", "عدد الثقوب لكل ضلع", "Holes per leg", ("ثقوب", "فتحات", "holes")),
        Param("gusset", 1, 0, 1, "bool", "دعامة مثلثة", "Gusset", ()),
    ),
    build=_l_bracket,
    requirements=_l_bracket_req,
    key_params=("width", "leg_a", "leg_b"),
)

# ------------------------------------------------------------------ spacer / washer


def _spacer(p: dict) -> Solid:
    od, id_, h = p["outer_diameter"], p["inner_diameter"], p["height"]
    if id_ >= od - 1.0:
        raise ValueError("inner diameter must be at least 1 mm smaller than outer diameter")
    seg = 96
    outer = cylinder(od / 2, h, center=(od / 2, od / 2, 0), segments=seg)
    if id_ <= 0:
        return outer
    return outer - hole(id_, h + 2, center=(od / 2, od / 2, -1), segments=seg)


def _spacer_req(p: dict) -> list[str]:
    return [
        f"Outer diameter shall be {p['outer_diameter']:g} mm and height {p['height']:g} mm.",
        f"The bore shall be at least {p['inner_diameter']:g} mm (polygon circumscribed so it is never undersized).",
    ]


SPACER = Template(
    key="spacer",
    title_ar="حلقة / فاصل / وردة",
    title_en="Spacer / washer",
    keywords=("حلقة", "فاصل", "وردة", "جلبة", "spacer", "washer", "ring", "bushing", "standoff"),
    params=(
        Param("outer_diameter", 20, 4, 200, "mm", "القطر الخارجي", "Outer diameter", ("قطر خارجي", "outer diameter", "od")),
        Param("inner_diameter", 8, 0, 190, "mm", "القطر الداخلي", "Inner diameter", ("قطر داخلي", "inner diameter", "id", "bore")),
        Param("height", 5, 0.8, 150, "mm", "الارتفاع", "Height", ("ارتفاع", "سماكة", "سمك", "height", "thickness", "thick")),
    ),
    build=_spacer,
    requirements=_spacer_req,
    key_params=("outer_diameter", "inner_diameter", "height"),
)

# ------------------------------------------------------------------ wall hook


def _wall_hook(p: dict) -> Solid:
    W, H, t, L, tip = p["width"], p["plate_height"], p["thickness"], p["reach"], p["tip_height"]
    plate = box(W, t, H)  # lies in XZ, printed standing; flat back on y=0
    arm_z = 0.0
    arm = box(W, L + t, t, origin=(0, 0, arm_z))
    tip_block = box(W, t, tip + t, origin=(0, L, arm_z))
    solid = plate | arm | tip_block
    d = p["screw_diameter"]
    if d > 0:
        for z in (H * 0.45, H * 0.8):
            solid = solid - hole(d, t + 2, center=(W / 2, -1, z), axis="y")
    # rotate so the back plate lies flat on the bed (largest face down) → better strength along layers
    solid = solid.rotated("x", 90)
    b = solid.to_mesh().bounds()
    return solid.translated(-b[0][0], -b[0][1], -b[0][2])


def _wall_hook_req(p: dict) -> list[str]:
    return [
        f"The mounting plate shall be {p['width']:g} × {p['plate_height']:g} mm, {p['thickness']:g} mm thick.",
        f"The hook shall reach {p['reach']:g} mm from the wall with a {p['tip_height']:g} mm retaining tip.",
        f"Two screw holes of at least {p['screw_diameter']:g} mm shall be provided." if p["screw_diameter"] > 0 else "No screw holes (adhesive mount).",
    ]


WALL_HOOK = Template(
    key="wall_hook",
    title_ar="علّاقة جدارية",
    title_en="Wall hook",
    keywords=("علاقة", "علّاقة", "خطاف", "شماعة", "تعليق", "hook", "hanger", "wall hook"),
    params=(
        Param("width", 25, 10, 120, "mm", "العرض", "Width", ("عرض", "width", "wide")),
        Param("plate_height", 60, 25, 200, "mm", "ارتفاع اللوح", "Plate height", ("ارتفاع", "طول", "height", "tall")),
        Param("thickness", 5, 3, 12, "mm", "السماكة", "Thickness", ("سماكة", "سمك", "thickness", "thick")),
        Param("reach", 35, 10, 120, "mm", "البروز عن الجدار", "Reach", ("بروز", "عمق", "reach", "depth")),
        Param("tip_height", 12, 4, 60, "mm", "ارتفاع الطرف", "Tip height", ("طرف", "tip")),
        Param("screw_diameter", 4.5, 0, 8, "mm", "قطر البرغي", "Screw hole diameter", ("قطر", "برغي", "براغي", "screw", "diameter")),
    ),
    build=_wall_hook,
    requirements=_wall_hook_req,
    key_params=("width", "plate_height", "reach"),
)

TEMPLATES: dict[str, Template] = {t.key: t for t in (PHONE_STAND, OPEN_BOX, L_BRACKET, SPACER, WALL_HOOK)}
