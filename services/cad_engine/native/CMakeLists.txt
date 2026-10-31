# forma_occ — OpenCascade executor for FormaCAD plans.
#   Linux/macOS:  cmake -S . -B build -DOpenCASCADE_DIR=<occt>/lib/cmake/opencascade && cmake --build build -j
#   Windows (conda):  conda install -c conda-forge occt cmake ninja  then the same two commands from the conda prompt
#   Without an installed OCCT config: -DOCCT_INCLUDE_DIR=<dir with gp_Pnt.hxx> -DOCCT_LIBRARY_DIR=<dir with libTKernel>
cmake_minimum_required(VERSION 3.16)
project(forma_occ CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
set(OCCT_LIBS TKDESTEP TKXSBase TKBO TKBool TKFillet TKOffset TKFeat TKMesh TKShHealing TKPrim TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKDESTL TKDE)
add_executable(forma_occ forma_occ.cpp)
if(OCCT_INCLUDE_DIR AND OCCT_LIBRARY_DIR)
  target_include_directories(forma_occ PRIVATE ${OCCT_INCLUDE_DIR})
  target_link_directories(forma_occ PRIVATE ${OCCT_LIBRARY_DIR})
  target_link_libraries(forma_occ PRIVATE ${OCCT_LIBS})
else()
  find_package(OpenCASCADE REQUIRED)
  target_include_directories(forma_occ PRIVATE ${OpenCASCADE_INCLUDE_DIR})
  target_link_libraries(forma_occ PRIVATE ${OCCT_LIBS})
endif()
