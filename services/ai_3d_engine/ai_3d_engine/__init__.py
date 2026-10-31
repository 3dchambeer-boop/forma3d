"""ai_3d_engine — text → printable geometry → validated STL.

The package is deliberately split into small, independently testable parts:

* ``geometry``  — mesh data structure, file I/O (STL/GLB/OBJ) and an exact CSG kernel.
* ``validation`` — the ``mesh_validation_service`` (checks + safe repairs).
* ``spec``      — turns an Arabic/English description into a structured ``DesignSpec``.
* ``templates`` — parametric CAD templates that build geometry from a spec.
* ``pipeline``  — orchestrates generation, conversion, export and re-validation.
"""

__version__ = "0.1.0"
