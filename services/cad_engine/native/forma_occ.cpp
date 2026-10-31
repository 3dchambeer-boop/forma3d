// forma_occ — executes a FormaCAD plan (services/cad_engine/cad_engine/plan.py) with the OpenCascade
// Technology (OCCT) C++ kernel and writes exact B-Rep exports.
//
//   stdin : {"tree": <plan tree>, "place_on_bed": true, "formats": ["step","stl","brep"],
//            "quality": {"linear_mm": 0.01, "angular_deg": 5}, "out_dir": "/tmp/x"}
//   stdout: {"ok": true, "report": {...}, "exports": {"step": {"file", "check"}, "stl": {...}}}
//           {"ok": false, "error": {"path": "model.difference[1]", "message": "..."}}   (exit code 2)
//
// Every kernel failure (StdFail_NotDone, Standard_Failure, invalid result, empty boolean) becomes an
// error naming the model path. Nothing is approximated: fillets, chamfers, shells, offsets and drafts are
// the OCCT B-Rep algorithms; STEP files are re-read with the STEP reader and compared with the solid.
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "third_party/nlohmann/json.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepLib.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <Bnd_Box.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeSegment.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Static.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <StdFail_NotDone.hxx>
#include <StlAPI_Writer.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>
#include <Standard_Version.hxx>
#include <Message.hxx>
#include <ShapeFix_Shape.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <TColStd_SequenceOfAsciiString.hxx>
#include <TopoDS.hxx>
#include <Message_Messenger.hxx>
#include <Message_PrinterOStream.hxx>

using json = nlohmann::json;

struct CadError : std::runtime_error {
  std::string path;
  CadError(const std::string& p, const std::string& m) : std::runtime_error(m), path(p) {}
};

static gp_Pnt P3(const json& a) { return gp_Pnt(a[0].get<double>(), a[1].get<double>(), a.size() > 2 ? a[2].get<double>() : 0.0); }
// adaptive integration to a relative error of 1e-9 (the default Gauss rule can be off by ~1e-4 on revolved/blended faces)
static double volumeOf(const TopoDS_Shape& s) { GProp_GProps g; BRepGProp::VolumeProperties(s, g, 1e-9, Standard_True); return g.Mass(); }
static double areaOf(const TopoDS_Shape& s) { GProp_GProps g; BRepGProp::SurfaceProperties(s, g, 1e-9); return g.Mass(); }
static int countOf(const TopoDS_Shape& s, TopAbs_ShapeEnum t) { TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, t, m); return m.Extent(); }
static bool isValid(const TopoDS_Shape& s) { return !s.IsNull() && BRepCheck_Analyzer(s).IsValid(); }

static Bnd_Box boundsOf(const TopoDS_Shape& s) {
  Bnd_Box b; BRepBndLib::AddOptimal(s, b, Standard_False, Standard_False); return b;
}

static TopoDS_Shape transformed(const TopoDS_Shape& s, const gp_Trsf& t) { return BRepBuilderAPI_Transform(s, t, Standard_True).Shape(); }

// closed wire in a local frame (origin + x dir + normal) from {"start", "segs": [["line", end] | ["arc", mid, end, centre, r]]}
static TopoDS_Wire wireOf(const json& prof, const gp_Ax3& frame, const std::string& path) {
  gp_Trsf toWorld; toWorld.SetTransformation(frame); toWorld.Invert();
  auto pt = [&](const json& a) { gp_Pnt p(a[0].get<double>(), a[1].get<double>(), 0); return p.Transformed(toWorld); };
  BRepBuilderAPI_MakeWire mw;
  gp_Pnt cur = pt(prof["start"]);
  for (const auto& s : prof["segs"]) {
    std::string kind = s[0];
    if (kind == "line") {
      gp_Pnt e = pt(s[1]);
      if (cur.Distance(e) < 1e-9) continue;
      mw.Add(BRepBuilderAPI_MakeEdge(cur, e).Edge());
      cur = e;
    } else {
      gp_Pnt m = pt(s[1]), e = pt(s[2]);
      GC_MakeArcOfCircle arc(cur, m, e);
      if (!arc.IsDone()) throw CadError(path, "profile arc could not be built");
      mw.Add(BRepBuilderAPI_MakeEdge(arc.Value()).Edge());
      cur = e;
    }
  }
  if (!mw.IsDone()) throw CadError(path, "profile wire could not be built");
  TopoDS_Wire w = mw.Wire();
  if (!w.Closed()) throw CadError(path, "profile wire is not closed");
  return w;
}

static TopoDS_Wire polygonWire(const std::vector<gp_Pnt>& pts) {
  BRepBuilderAPI_MakePolygon mp;
  for (const auto& p : pts) mp.Add(p);
  mp.Close();
  return mp.Wire();
}

// Merge faces/edges split by booleans. ShapeUpgrade_UnifySameDomain was measured (OCCT 7.8.1) to return a shape that
// passes BRepCheck but lost 1320 mm3 on the vase starter (revolve fused with 12 cylinders), so its result is accepted
// only when it is valid and keeps the volume; otherwise the boolean result is kept as it is.
static TopoDS_Shape clean(const TopoDS_Shape& s) {
  try {
    ShapeUpgrade_UnifySameDomain u(s, Standard_True, Standard_True, Standard_False);
    u.Build();
    TopoDS_Shape c = u.Shape();
    const double v0 = volumeOf(s), v1 = volumeOf(c);
    if (BRepCheck_Analyzer(c).IsValid() && std::fabs(v1 - v0) <= 1e-7 * std::max(1.0, std::fabs(v0))) return c;
    return s;
  } catch (...) { return s; }
}

// ---------------------------------------------------------------- selectors (CadQuery semantics)
// Edges: "|Z" straight edges parallel to Z; "#Z" perpendicular; ">Z"/"<Z" edges whose centre is extreme along Z.
// Faces: "|Z" planar faces whose normal is parallel to Z (top/bottom); "#Z" normal perpendicular (side faces);
//        ">Z"/"<Z" faces whose centre is extreme.  {"near": [[x,y,z]...]} the edge/face nearest each point.
static gp_Dir axisDir(char c) { return c == 'X' ? gp_Dir(1, 0, 0) : c == 'Y' ? gp_Dir(0, 1, 0) : gp_Dir(0, 0, 1); }
static gp_Pnt centreOf(const TopoDS_Shape& s) {
  GProp_GProps g;
  if (s.ShapeType() == TopAbs_EDGE) BRepGProp::LinearProperties(s, g); else BRepGProp::SurfaceProperties(s, g);
  return g.CentreOfMass();
}
static bool edgeDir(const TopoDS_Edge& e, gp_Dir& d) {
  BRepAdaptor_Curve c(e);
  if (c.GetType() != GeomAbs_Line) return false;
  d = c.Line().Direction(); return true;
}
static bool faceNormal(const TopoDS_Face& f, gp_Dir& d) {
  BRepAdaptor_Surface s(f);
  if (s.GetType() != GeomAbs_Plane) return false;
  d = s.Plane().Axis().Direction(); return true;
}
static std::vector<TopoDS_Shape> select(const TopoDS_Shape& shape, TopAbs_ShapeEnum type, const json& sel, const std::string& path) {
  TopTools_IndexedMapOfShape all; TopExp::MapShapes(shape, type, all);
  std::vector<TopoDS_Shape> out;
  if (sel.is_object()) {
    for (const auto& q : sel["near"]) {
      TopoDS_Shape best; double bd = 1e300;
      for (int i = 1; i <= all.Extent(); i++) {
        BRepExtrema_DistShapeShape d(BRepBuilderAPI_MakeVertex(P3(q)).Vertex(), all(i));
        if (d.IsDone() && d.Value() < bd) { bd = d.Value(); best = all(i); }
      }
      if (!best.IsNull()) out.push_back(best);
    }
  } else {
    std::string s = sel.get<std::string>();
    if (s == "all") for (int i = 1; i <= all.Extent(); i++) out.push_back(all(i));
    else {
      char op = s[0]; gp_Dir ax = axisDir(s[1]);
      if (op == '|' || op == '#') {
        for (int i = 1; i <= all.Extent(); i++) {
          gp_Dir d; bool ok = type == TopAbs_EDGE ? edgeDir(TopoDS::Edge(all(i)), d) : faceNormal(TopoDS::Face(all(i)), d);
          if (!ok) continue;
          double c = std::fabs(d.Dot(ax));
          if ((op == '|' && c > 1 - 1e-6) || (op == '#' && c < 1e-6)) out.push_back(all(i));
        }
      } else {
        double best = op == '>' ? -1e300 : 1e300;
        std::vector<std::pair<double, TopoDS_Shape>> v;
        for (int i = 1; i <= all.Extent(); i++) { double k = gp_Vec(centreOf(all(i)).XYZ()).Dot(gp_Vec(ax)); v.push_back({k, all(i)}); best = op == '>' ? std::max(best, k) : std::min(best, k); }
        for (auto& [k, sh] : v) if (std::fabs(k - best) < 1e-4) out.push_back(sh);
      }
    }
  }
  if (out.empty()) throw CadError(path, "selector " + sel.dump() + " matched nothing");
  return out;
}

// ---------------------------------------------------------------- builder
static TopoDS_Shape build(const json& n);

static TopoDS_Shape applyTf(TopoDS_Shape s, const json& tf) {
  if (tf.is_null()) return s;
  if (tf.contains("scale")) { gp_Trsf t; t.SetScale(gp_Pnt(0, 0, 0), tf["scale"].get<double>()); s = transformed(s, t); }
  if (tf.contains("mirror")) { std::string a = tf["mirror"]; gp_Trsf t; t.SetMirror(gp_Ax2(gp_Pnt(0, 0, 0), axisDir(std::toupper(a[0])))); s = transformed(s, t); }
  if (tf.contains("rotate")) {
    const char axes[3] = {'X', 'Y', 'Z'};
    for (int i = 0; i < 3; i++) { double a = tf["rotate"][i].get<double>(); if (a != 0) { gp_Trsf t; t.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), axisDir(axes[i])), a * M_PI / 180.0); s = transformed(s, t); } }
  }
  if (tf.contains("translate")) { gp_Trsf t; t.SetTranslation(gp_Vec(tf["translate"][0].get<double>(), tf["translate"][1].get<double>(), tf["translate"][2].get<double>())); s = transformed(s, t); }
  return s;
}

static std::vector<gp_Pnt> regular(int n, double r, double z) {
  std::vector<gp_Pnt> v;
  for (int k = 0; k < n; k++) v.emplace_back(r * std::cos(2 * M_PI * k / n), r * std::sin(2 * M_PI * k / n), z);
  return v;
}

static TopoDS_Shape boxShape(const json& n) {
  double x = n["size"][0], y = n["size"][1], z = n["size"][2];
  gp_Pnt o = n["center"].get<bool>() ? gp_Pnt(-x / 2, -y / 2, -z / 2) : gp_Pnt(0, 0, 0);
  return BRepPrimAPI_MakeBox(o, x, y, z).Shape();
}

static TopoDS_Shape filletAll(const TopoDS_Shape& s, double r, const std::vector<TopoDS_Shape>& edges, const std::string& path) {
  BRepFilletAPI_MakeFillet mk(s);
  for (const auto& e : edges) mk.Add(r, TopoDS::Edge(e));
  mk.Build();
  if (!mk.IsDone()) throw CadError(path, "fillet r=" + std::to_string(r) + " mm failed on " + std::to_string(edges.size()) + " edge(s): the radius is larger than the adjacent faces allow");
  return mk.Shape();
}
static TopoDS_Shape chamferAll(const TopoDS_Shape& s, double d, const std::vector<TopoDS_Shape>& edges, const std::string& path) {
  BRepFilletAPI_MakeChamfer mk(s);
  for (const auto& e : edges) mk.Add(d, TopoDS::Edge(e));
  mk.Build();
  if (!mk.IsDone()) throw CadError(path, "chamfer d=" + std::to_string(d) + " mm failed on " + std::to_string(edges.size()) + " edge(s): the distance is larger than the adjacent faces allow");
  return mk.Shape();
}

static TopoDS_Shape fuseAll(const std::vector<TopoDS_Shape>& v) {
  TopoDS_Shape acc = v[0];
  for (size_t i = 1; i < v.size(); i++) { BRepAlgoAPI_Fuse f(acc, v[i]); if (!f.IsDone()) throw Standard_Failure("fuse failed"); acc = f.Shape(); }
  return clean(acc);
}

static TopoDS_Shape buildOp(const json& n, const std::string& op, const std::string& path) {
  if (op == "box") return boxShape(n);
  if (op == "fillet_box") { TopoDS_Shape b = boxShape(n); return filletAll(b, n["r"], select(b, TopAbs_EDGE, "all", path), path); }
  if (op == "chamfer_box") { TopoDS_Shape b = boxShape(n); return chamferAll(b, n["d"], select(b, TopAbs_EDGE, "all", path), path); }
  if (op == "cylinder") {
    double r1 = n["r1"], r2 = n["r2"], h = n["h"];
    gp_Ax2 ax(gp_Pnt(0, 0, n["center"].get<bool>() ? -h / 2 : 0), gp_Dir(0, 0, 1));
    if (std::fabs(r1 - r2) < 1e-12) return BRepPrimAPI_MakeCylinder(ax, r1, h).Shape();
    return BRepPrimAPI_MakeCone(ax, r1, r2, h).Shape();
  }
  if (op == "prism") {
    int k = n["n"]; double r1 = n["r1"], r2 = n["r2"], h = n["h"], z0 = n["center"].get<bool>() ? -h / 2 : 0;
    if (std::fabs(r1 - r2) < 1e-12) {
      TopoDS_Face f = BRepBuilderAPI_MakeFace(polygonWire(regular(k, r1, z0))).Face();
      return BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, h)).Shape();
    }
    BRepOffsetAPI_ThruSections ts(Standard_True, Standard_True);
    ts.AddWire(polygonWire(regular(k, r1, z0))); ts.AddWire(polygonWire(regular(k, std::max(r2, 1e-6), z0 + h)));
    ts.Build(); return ts.Shape();
  }
  if (op == "sphere") return BRepPrimAPI_MakeSphere(n["r"].get<double>()).Shape();
  if (op == "torus") return BRepPrimAPI_MakeTorus(n["R"].get<double>(), n["r"].get<double>()).Shape();
  if (op == "extrude") {
    double z0 = n.value("z0", 0.0), h = n["h"];
    gp_Ax3 fr(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
    TopoDS_Face f = BRepBuilderAPI_MakeFace(wireOf(n["profile"], fr, path)).Face();
    TopoDS_Shape s = BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, h)).Shape();
    for (const auto& hp : n["holes"]) {
      gp_Ax3 fh(gp_Pnt(0, 0, z0 - 1), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
      TopoDS_Shape cut = BRepPrimAPI_MakePrism(BRepBuilderAPI_MakeFace(wireOf(hp, fh, path)).Face(), gp_Vec(0, 0, h + 2)).Shape();
      s = BRepAlgoAPI_Cut(s, cut).Shape();
    }
    return clean(s);
  }
  if (op == "revolve") {
    // profile (r, z) lives in the XZ plane: local x -> world X, local y -> world Z
    gp_Ax3 fr(gp_Pnt(0, 0, 0), gp_Dir(0, -1, 0), gp_Dir(1, 0, 0));
    TopoDS_Face f = BRepBuilderAPI_MakeFace(wireOf(n["profile"], fr, path)).Face();
    return BRepPrimAPI_MakeRevol(f, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2 * M_PI).Shape();
  }
  if (op == "loft") {
    BRepOffsetAPI_ThruSections ts(Standard_True, Standard_True);
    for (const auto& sec : n["sections"]) {
      std::vector<gp_Pnt> pts; double z = sec["z"];
      for (const auto& p : sec["points"]) pts.emplace_back(p[0].get<double>(), p[1].get<double>(), z);
      ts.AddWire(polygonWire(pts));
    }
    ts.Build(); return ts.Shape();
  }
  if (op == "sweep") {
    const json& pts = n["spine"];
    gp_Pnt p0 = P3(pts[0]), p1 = P3(pts[1]);
    gp_Dir d0(gp_Vec(p0, p1));
    gp_Dir ref = std::fabs(d0.Z()) < 0.9 ? gp_Dir(0, 0, 1) : gp_Dir(1, 0, 0);
    gp_Dir u = ref.Crossed(d0);  // profile x along u, profile y along d0 x u (same frame as the browser kernel)
    gp_Ax3 fr(p0, d0, u);
    TopoDS_Wire prof = wireOf(n["profile"], fr, path);
    std::vector<gp_Pnt> sp; for (const auto& q : pts) sp.push_back(P3(q));
    BRepBuilderAPI_MakePolygon spine; for (auto& q : sp) spine.Add(q);
    BRepOffsetAPI_MakePipeShell pipe(spine.Wire());
    pipe.SetMode(Standard_False);
    pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
    pipe.Add(prof);
    pipe.Build();
    if (!pipe.IsDone() || !pipe.MakeSolid()) throw CadError(path, "sweep failed (the profile folds into itself at a sharp turn)");
    return pipe.Shape();
  }
  if (op == "union" || op == "difference" || op == "intersection") {
    std::vector<TopoDS_Shape> kids;
    for (const auto& c : n["children"]) kids.push_back(build(c));
    TopoDS_Shape acc = kids[0];
    for (size_t i = 1; i < kids.size(); i++) {
      if (op == "union") { BRepAlgoAPI_Fuse b(acc, kids[i]); if (!b.IsDone()) throw CadError(path, "union failed"); acc = b.Shape(); }
      else if (op == "difference") { BRepAlgoAPI_Cut b(acc, kids[i]); if (!b.IsDone()) throw CadError(path, "difference failed"); acc = b.Shape(); }
      else { BRepAlgoAPI_Common b(acc, kids[i]); if (!b.IsDone()) throw CadError(path, "intersection failed"); acc = b.Shape(); }
    }
    acc = clean(acc);
    if (volumeOf(acc) <= 1e-9) throw CadError(path, op + " left no material (check the order of a difference, or that intersecting parts overlap)");
    return acc;
  }
  if (op == "linear_array" || op == "polar_array") {
    TopoDS_Shape base = build(n["child"]);
    std::vector<TopoDS_Shape> copies;
    for (int k = 0; k < n["count"].get<int>(); k++) {
      gp_Trsf t;
      if (op == "linear_array") t.SetTranslation(gp_Vec(n["step"][0].get<double>() * k, n["step"][1].get<double>() * k, n["step"][2].get<double>() * k));
      else t.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), n["step_deg"].get<double>() * k * M_PI / 180);
      copies.push_back(transformed(base, t));
    }
    return fuseAll(copies);
  }
  if (op == "mirror_copy") {
    TopoDS_Shape base = build(n["child"]);
    std::string a = n["axis"]; gp_Trsf t; t.SetMirror(gp_Ax2(gp_Pnt(0, 0, 0), axisDir(std::toupper(a[0]))));
    return fuseAll({base, transformed(base, t)});
  }
  if (op == "fillet_edges") { TopoDS_Shape b = build(n["child"]); return filletAll(b, n["r"], select(b, TopAbs_EDGE, n["edges"], path), path); }
  if (op == "chamfer_edges") { TopoDS_Shape b = build(n["child"]); return chamferAll(b, n["d"], select(b, TopAbs_EDGE, n["edges"], path), path); }
  if (op == "shell") {
    TopoDS_Shape b = build(n["child"]); double t = n["thickness"];
    if (n["open"].is_null()) {  // closed hollow body: cut the inward offset
      BRepOffsetAPI_MakeOffsetShape off; off.PerformByJoin(b, -t, 1e-4, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Intersection);
      if (!off.IsDone()) throw CadError(path, "shell failed: the wall is thicker than the part allows");
      return BRepAlgoAPI_Cut(b, off.Shape()).Shape();
    }
    TopTools_ListOfShape faces; for (auto& f : select(b, TopAbs_FACE, n["open"], path)) faces.Append(f);
    BRepOffsetAPI_MakeThickSolid mk; mk.MakeThickSolidByJoin(b, faces, -t, 1e-4, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Intersection);
    mk.Build();
    if (!mk.IsDone()) throw CadError(path, "shell " + std::to_string(t) + " mm failed: the wall is thicker than the part allows or a fillet is smaller than the wall");
    return mk.Shape();
  }
  if (op == "offset") {
    TopoDS_Shape b = build(n["child"]);
    BRepOffsetAPI_MakeOffsetShape off; off.PerformByJoin(b, n["distance"].get<double>(), 1e-4, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Arc);
    if (!off.IsDone()) throw CadError(path, "offset failed");
    return off.Shape();
  }
  if (op == "draft") {
    TopoDS_Shape b = build(n["child"]);
    BRepOffsetAPI_DraftAngle da(b);
    gp_Pln pln(gp_Pnt(0, 0, n["neutral_z"].get<double>()), gp_Dir(0, 0, 1));
    for (auto& f : select(b, TopAbs_FACE, n["faces"], path)) {
      da.Add(TopoDS::Face(f), gp_Dir(0, 0, 1), n["angle"].get<double>() * M_PI / 180, pln, Standard_True);
      if (!da.AddDone()) throw CadError(path, "draft could not be added to a selected face (only planar or ruled side faces can be drafted)");
    }
    da.Build();
    if (!da.IsDone()) throw CadError(path, "draft failed");
    return da.Shape();
  }
  throw CadError(path, "operation \"" + op + "\" is not supported by the OpenCascade service");
}

static TopoDS_Shape build(const json& n) {
  std::string op = n["op"], path = n.value("path", std::string("model"));
  TopoDS_Shape s;
  try { s = buildOp(n, op, path); }
  catch (const CadError&) { throw; }
  catch (const Standard_Failure& e) { throw CadError(path, op + " failed in OpenCascade: " + std::string(e.DynamicType()->Name()) + ": " + (e.GetMessageString() ? e.GetMessageString() : "")); }
  catch (const std::exception& e) { throw CadError(path, op + " failed: " + e.what()); }
  if (n.contains("tf")) s = applyTf(s, n["tf"]);
  if (s.IsNull()) throw CadError(path, op + " produced no geometry");
  if (!isValid(s)) throw CadError(path, op + " produced invalid geometry");
  return s;
}

// ---------------------------------------------------------------- reports and exports

// ---------------------------------------------------------------- STEP import
// {"import": {"step": "<file>", "max_faces": 200000}}: read every root, convert to millimetres (the reader's default),
// heal with ShapeFix, sew a closed shell into a solid when the file holds only surfaces, and refuse anything that is
// not valid closed solid geometry (it could not be printed or measured). The report says what was done.
static TopoDS_Shape importStep(const json& im, json& info) {
  std::string file = im.at("step");
  STEPControl_Reader r;
  if (r.ReadFile(file.c_str()) != IFSelect_RetDone) throw CadError("import", "not a readable STEP file");
  TColStd_SequenceOfAsciiString lu, au, su;
  r.FileUnits(lu, au, su);
  info["file_length_unit"] = lu.Length() ? lu.Value(1).ToCString() : "unknown";
  int roots = r.NbRootsForTransfer();
  if (roots < 1) throw CadError("import", "the STEP file contains no shape");
  r.TransferRoots();
  TopoDS_Shape s = r.OneShape();
  if (s.IsNull()) throw CadError("import", "the STEP file contains no transferable shape");
  info["roots"] = roots;
  const int maxFaces = im.value("max_faces", 200000);
  if (countOf(s, TopAbs_FACE) > maxFaces) throw CadError("import", "the model has more than " + std::to_string(maxFaces) + " faces");
  bool healed = false, sewn = false;
  if (!isValid(s)) {
    Handle(ShapeFix_Shape) fx = new ShapeFix_Shape(s); fx->Perform(); s = fx->Shape(); healed = true;
  }
  if (countOf(s, TopAbs_SOLID) == 0 && countOf(s, TopAbs_FACE) > 0) {
    BRepBuilderAPI_Sewing sew(1e-3); sew.Add(s); sew.Perform();
    TopoDS_Shape sh = sew.SewedShape();
    TopTools_IndexedMapOfShape shells; TopExp::MapShapes(sh, TopAbs_SHELL, shells);
    BRepBuilderAPI_MakeSolid ms; int closed = 0;
    for (int i = 1; i <= shells.Extent(); i++) { if (BRep_Tool::IsClosed(shells(i))) { ms.Add(TopoDS::Shell(shells(i))); closed++; } }
    if (!closed) throw CadError("import", "the STEP file holds only open surfaces, not a closed solid; it cannot be printed");
    s = ms.Solid(); sewn = true;
    if (volumeOf(s) < 0) s.Reverse();
  }
  info["healed"] = healed; info["sewn"] = sewn;
  if (countOf(s, TopAbs_SOLID) == 0) throw CadError("import", "no solid found in the STEP file");
  if (!isValid(s)) throw CadError("import", "the geometry is not valid even after healing");
  if (volumeOf(s) <= 1e-9) throw CadError("import", "the solid has no volume");
  return s;
}

static json reportOf(const TopoDS_Shape& s) {
  Bnd_Box b = boundsOf(s); double x0, y0, z0, x1, y1, z1; b.Get(x0, y0, z0, x1, y1, z1);
  return {{"valid", isValid(s)}, {"solids", countOf(s, TopAbs_SOLID)}, {"faces", countOf(s, TopAbs_FACE)}, {"edges", countOf(s, TopAbs_EDGE)},
          {"volume_mm3", volumeOf(s)}, {"area_mm2", areaOf(s)}, {"size_mm", {{"x", x1 - x0}, {"y", y1 - y0}, {"z", z1 - z0}}},
          {"bounds", {{"min", {x0, y0, z0}}, {"max", {x1, y1, z1}}}}, {"kernel", std::string("OCCT ") + OCC_VERSION_COMPLETE}};
}

static json stepExport(const TopoDS_Shape& s, const std::string& file) {
  Interface_Static::SetCVal("write.step.schema", "AP214IS");
  Interface_Static::SetCVal("write.step.unit", "MM");
  STEPControl_Writer w;
  if (w.Transfer(s, STEPControl_AsIs) != IFSelect_RetDone || w.Write(file.c_str()) != IFSelect_RetDone) throw CadError("export.step", "STEP writer failed");
  STEPControl_Reader r;
  if (r.ReadFile(file.c_str()) != IFSelect_RetDone) throw CadError("export.step", "the written STEP file could not be read back");
  r.TransferRoots();
  TopoDS_Shape back = r.OneShape();
  json a = reportOf(s), b = reportOf(back);
  double v0 = a["volume_mm3"], v1 = b["volume_mm3"], be = 0;
  for (int i = 0; i < 3; i++) { be = std::max(be, std::fabs(a["bounds"]["min"][i].get<double>() - b["bounds"]["min"][i].get<double>())); be = std::max(be, std::fabs(a["bounds"]["max"][i].get<double>() - b["bounds"]["max"][i].get<double>())); }
  json c = {{"reimported", true}, {"valid", b["valid"]}, {"volume_rel_err", std::fabs(v1 - v0) / std::max(std::fabs(v0), 1e-12)}, {"bounds_max_err_mm", be}, {"faces", {a["faces"], b["faces"]}}, {"solids", b["solids"]}};
  c["ok"] = c["valid"].get<bool>() && c["volume_rel_err"].get<double>() < 1e-6 && be < 1e-6 && a["faces"] == b["faces"];
  return c;
}

static double meshVolume(const TopoDS_Shape& s, int& tris) {
  double v = 0; tris = 0;
  for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
    TopoDS_Face f = TopoDS::Face(ex.Current()); TopLoc_Location loc;
    Handle(Poly_Triangulation) t = BRep_Tool::Triangulation(f, loc);
    if (t.IsNull()) continue;
    bool rev = f.Orientation() == TopAbs_REVERSED;
    for (int i = 1; i <= t->NbTriangles(); i++) {
      int a, b, c; t->Triangle(i).Get(a, b, c); if (rev) std::swap(b, c);
      gp_Pnt p = t->Node(a).Transformed(loc.Transformation()), q = t->Node(b).Transformed(loc.Transformation()), r = t->Node(c).Transformed(loc.Transformation());
      v += (p.X() * (q.Y() * r.Z() - r.Y() * q.Z()) - q.X() * (p.Y() * r.Z() - r.Y() * p.Z()) + r.X() * (p.Y() * q.Z() - q.Y() * p.Z())) / 6.0;
      tris++;
    }
  }
  return v;
}

static json stlExport(const TopoDS_Shape& s, const std::string& file, double lin, double angDeg) {
  BRepMesh_IncrementalMesh mesh(s, lin, Standard_False, angDeg * M_PI / 180, Standard_True);
  int tris = 0; double vm = meshVolume(s, tris), vb = volumeOf(s);
  StlAPI_Writer w; w.ASCIIMode() = Standard_False;
  if (!w.Write(s, file.c_str())) throw CadError("export.stl", "STL writer failed");
  return {{"triangles", tris}, {"linear_mm", lin}, {"angular_deg", angDeg}, {"mesh_volume_mm3", vm}, {"brep_volume_mm3", vb}, {"volume_rel_err", std::fabs(vm - vb) / std::max(std::fabs(vb), 1e-12)}};
}

int main() {
  // OCCT's default messenger prints to std::cout (e.g. STEP translation statistics); stdout carries only the JSON reply
  Message::DefaultMessenger()->RemovePrinters(STANDARD_TYPE(Message_PrinterOStream));
  Message::DefaultMessenger()->AddPrinter(new Message_PrinterOStream("cerr", Standard_False, Message_Warning));  // warnings to stderr
  std::stringstream in; in << std::cin.rdbuf();
  json req, out;
  try {
    req = json::parse(in.str());
    json info;
    TopoDS_Shape s = req.contains("import") ? importStep(req["import"], info) : build(req["tree"]);
    if (req.value("place_on_bed", true)) {
      Bnd_Box b = boundsOf(s); double x0, y0, z0, x1, y1, z1; b.Get(x0, y0, z0, x1, y1, z1);
      gp_Trsf t; t.SetTranslation(gp_Vec(-x0, -y0, -z0)); s = transformed(s, t);
    }
    out["ok"] = true;
    out["report"] = reportOf(s);
    if (req.contains("import")) out["import"] = info;
    std::string dir = req.value("out_dir", std::string("."));
    double lin = req.contains("quality") ? req["quality"].value("linear_mm", 0.01) : 0.01, ang = req.contains("quality") ? req["quality"].value("angular_deg", 5.0) : 5.0;
    for (const auto& f : req.value("formats", json::array())) {
      std::string fmt = f;
      if (fmt == "step") { std::string p = dir + "/part.step"; out["exports"]["step"] = {{"file", p}, {"check", stepExport(s, p)}}; }
      else if (fmt == "stl") { std::string p = dir + "/part.stl"; out["exports"]["stl"] = {{"file", p}, {"check", stlExport(s, p, lin, ang)}}; }
      else if (fmt == "brep") { std::string p = dir + "/part.brep"; BRepTools::Write(s, p.c_str()); out["exports"]["brep"] = {{"file", p}}; }
      else throw CadError("formats", "unknown format " + fmt);
    }
    std::cout << out.dump() << std::endl;
    return 0;
  } catch (const CadError& e) {
    std::cout << json({{"ok", false}, {"error", {{"path", e.path}, {"message", e.what()}}}}).dump() << std::endl;
    return 2;
  } catch (const std::exception& e) {
    std::cout << json({{"ok", false}, {"error", {{"path", "request"}, {"message", e.what()}}}}).dump() << std::endl;
    return 2;
  } catch (const Standard_Failure& e) {
    std::cout << json({{"ok", false}, {"error", {{"path", "model"}, {"message", std::string("OpenCascade: ") + (e.GetMessageString() ? e.GetMessageString() : "failure")}}}}).dump() << std::endl;
    return 2;
  }
}
