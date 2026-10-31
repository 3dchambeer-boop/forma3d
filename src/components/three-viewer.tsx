'use client';

import { useRef, useState, Suspense, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Html, useProgress, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  Loader2, AlertTriangle, RotateCcw, Maximize2, Grid3x3,
  Axis3d, Box, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// =====================================================================
// Geometry types
// =====================================================================

export type ModelGeometryKind = 'gear' | 'frame' | 'bracket' | 'vase' | 'stand' | 'clip';

export interface ModelStats {
  vertexCount: number;
  faceCount: number;
  boundingBoxX: number;
  boundingBoxY: number;
  boundingBoxZ: number;
  fileSizeBytes?: number;
}

// =====================================================================
// Procedural geometries (used when no real file URL is provided)
// =====================================================================

function GearGeometry() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.15;
  });
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const teeth = 12;
    const innerR = 0.9;
    const outerR = 0.98;
    const segments = 200;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * Math.PI * 2;
      const toothT = (angle * teeth) % (Math.PI * 2 / teeth) / (Math.PI * 2 / teeth);
      const r = toothT < 0.5 ? outerR : innerR;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.18, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return s;
  }, []);

  return (
    <group ref={ref}>
      <mesh castShadow receiveShadow>
        <extrudeGeometry args={[shape, { depth: 0.25, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3 }]} />
        <meshStandardMaterial color="#5dd9e8" metalness={0.65} roughness={0.3} />
      </mesh>
    </group>
  );
}

function FrameGeometry() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.1;
  });
  return (
    <group ref={ref}>
      {[45, 135, 225, 315].map(deg => (
        <mesh key={deg} rotation={[0, 0, (deg * Math.PI) / 180]} castShadow>
          <boxGeometry args={[2.4, 0.06, 0.06]} />
          <meshStandardMaterial color="#8b5cf6" metalness={0.7} roughness={0.25} />
        </mesh>
      ))}
      <mesh castShadow>
        <boxGeometry args={[0.5, 0.5, 0.1]} />
        <meshStandardMaterial color="#5dd9e8" metalness={0.6} roughness={0.3} />
      </mesh>
      {[[0.85, 0.85, 0], [-0.85, 0.85, 0], [-0.85, -0.85, 0], [0.85, -0.85, 0]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.12, 24]} />
          <meshStandardMaterial color="#e879f9" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function BracketGeometry() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.12;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.4, 0.1, 1.0]} />
        <meshStandardMaterial color="#5dd9e8" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0.7, 0.55, 0]} castShadow>
        <boxGeometry args={[0.1, 1.1, 1.0]} />
        <meshStandardMaterial color="#5dd9e8" metalness={0.5} roughness={0.35} />
      </mesh>
      {[[-0.5, 0, 0], [0.5, 0, 0]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.06, p[1]]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.12, 16]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.1} />
        </mesh>
      ))}
      <mesh position={[0.7, 0.95, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.12, 16]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

function VaseGeometry() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.2;
  });
  const geometry = useMemo(() => {
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const y = t * 2.4;
      const r = 0.4 + Math.sin(t * Math.PI * 1.5) * 0.25 + Math.cos(t * Math.PI * 6) * 0.05;
      points.push(new THREE.Vector2(Math.max(0.05, r), y));
    }
    return new THREE.LatheGeometry(points, 64);
  }, []);
  return (
    <mesh ref={ref} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#a78bfa" metalness={0.3} roughness={0.4} side={THREE.DoubleSide} />
    </mesh>
  );
}

function StandGeometry() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.12;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, -0.5, 0]} castShadow>
        <boxGeometry args={[1.2, 0.08, 0.8]} />
        <meshStandardMaterial color="#5dd9e8" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[-0.4, 0.2, 0]} rotation={[0, 0, -0.3]} castShadow>
        <boxGeometry args={[0.08, 1.4, 0.8]} />
        <meshStandardMaterial color="#8b5cf6" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0.15, 0.3, 0]} rotation={[0, 0, 0.3]} castShadow>
        <boxGeometry args={[1.0, 0.06, 0.6]} />
        <meshStandardMaterial color="#5dd9e8" metalness={0.4} roughness={0.4} />
      </mesh>
    </group>
  );
}

function ClipGeometry() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.15;
  });
  return (
    <group ref={ref}>
      {[0, 1, 2, 3, 4, 5].map(i => {
        const x = (i % 3 - 1) * 0.5;
        const y = Math.floor(i / 3 - 0.5) * 0.5;
        return (
          <group key={i} position={[x, y, 0]}>
            <mesh castShadow>
              <torusGeometry args={[0.15, 0.04, 12, 32]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#5dd9e8' : '#a78bfa'} metalness={0.3} roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.18, 0]} castShadow>
              <boxGeometry args={[0.25, 0.06, 0.05]} />
              <meshStandardMaterial color="#8b5cf6" metalness={0.3} roughness={0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ProceduralMesh({ kind }: { kind: ModelGeometryKind }) {
  switch (kind) {
    case 'gear': return <GearGeometry />;
    case 'frame': return <FrameGeometry />;
    case 'bracket': return <BracketGeometry />;
    case 'vase': return <VaseGeometry />;
    case 'stand': return <StandGeometry />;
    case 'clip': return <ClipGeometry />;
    default: return <GearGeometry />;
  }
}

// =====================================================================
// Real STL loader
// =====================================================================

function STLMesh({ url, onStats, onError }: {
  url: string;
  onStats: (stats: ModelStats) => void;
  onError: (msg: string) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => {
        if (cancelled) return;
        // Auto-center & normalize size for display
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        const bbox = geo.boundingBox!;
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 2.0;
        const scale = maxDim > 0 ? targetSize / maxDim : 1;
        // Apply transform: center + scale
        const matrix = new THREE.Matrix4();
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        matrix.makeScale(scale, scale, scale);
        matrix.setPosition(-center.x * scale, -center.y * scale, -center.z * scale);
        geo.applyMatrix4(matrix);
        geo.computeBoundingBox();
        setGeometry(geo);

        // Report stats in original units (before normalization)
        onStats({
          vertexCount: geo.attributes.position.count,
          faceCount: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3,
          boundingBoxX: parseFloat(size.x.toFixed(2)),
          boundingBoxY: parseFloat(size.y.toFixed(2)),
          boundingBoxZ: parseFloat(size.z.toFixed(2)),
        });
      },
      undefined,
      (err) => {
        if (cancelled) return;
        onError(`Failed to load STL: ${(err as Error).message || 'unknown error'}`);
      }
    );
    return () => {
      cancelled = true;
      if (geometry) geometry.dispose();
    };
     
  }, [url]);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.1;
  });

  if (!geometry) return null;
  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#5dd9e8" metalness={0.4} roughness={0.45} />
    </mesh>
  );
}

// =====================================================================
// Real GLB loader
// =====================================================================

function GLBMesh({ url, onStats, onError }: {
  url: string;
  onStats: (stats: ModelStats) => void;
  onError: (msg: string) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  // useGLTF caches; force-load with suspense
  const gltf = useGLTF(url);

  useEffect(() => {
    if (!gltf?.scene) return;
    // Compute stats from the scene
    let vertices = 0;
    let faces = 0;
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    // Auto-center & normalize
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 2.0;
    const scale = maxDim > 0 ? targetSize / maxDim : 1;
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geom = child.geometry;
        if (geom?.attributes?.position) {
          vertices += geom.attributes.position.count;
          faces += geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
        }
      }
    });
    gltf.scene.scale.setScalar(scale);
    gltf.scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

    onStats({
      vertexCount: vertices,
      faceCount: Math.floor(faces),
      boundingBoxX: parseFloat(size.x.toFixed(2)),
      boundingBoxY: parseFloat(size.y.toFixed(2)),
      boundingBoxZ: parseFloat(size.z.toFixed(2)),
    });
  }, [gltf, onStats]);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.1;
  });

   
  return <group ref={ref}>{(gltf as any).scene ? <primitive object={(gltf as any).scene} /> : null}</group>;
}

// =====================================================================
// Wrapper that decides which loader to use
// =====================================================================

interface ModelLoaderProps {
  url?: string;
  format?: 'STL' | 'GLB' | 'OBJ' | 'PLY';
  proceduralKind?: ModelGeometryKind;
  onStats?: (stats: ModelStats) => void;
  onError?: (msg: string) => void;
  wireframe?: boolean;
}

function ModelLoader({ url, format, proceduralKind = 'gear', onStats, onError, wireframe }: ModelLoaderProps) {
  const statsCb = useCallback((s: ModelStats) => { onStats?.(s); }, [onStats]);
  const errCb = useCallback((m: string) => { onError?.(m); }, [onError]);

  // No URL → procedural
  if (!url || url.startsWith('mock://')) {
    return <ProceduralMesh kind={proceduralKind} />;
  }

  // Rewrite /models/... URLs to /api/models/... so newly-generated files
  // are served fresh on every request (next start caches /public at boot).
  let loaderUrl = url;
  if (url.startsWith('/models/')) {
    const filename = url.replace('/models/', '');
    loaderUrl = `/api/models/${filename}`;
  }

  // Real URL: pick loader by format
  if (format === 'STL') {
    return <STLMesh url={loaderUrl} onStats={statsCb} onError={errCb} />;
  }
  if (format === 'GLB') {
    return (
      <Suspense fallback={<LoaderOverlay />}>
        <GLBMesh url={loaderUrl} onStats={statsCb} onError={errCb} />
      </Suspense>
    );
  }
  // OBJ/PLY not implemented — fall back to procedural with a one-shot effect
  return <UnsupportedFormatNotice format={format} proceduralKind={proceduralKind} onError={errCb} />;
}

function UnsupportedFormatNotice({ format, proceduralKind, onError }: {
  format?: 'OBJ' | 'PLY' | 'STL' | 'GLB';
  proceduralKind: ModelGeometryKind;
  onError: (msg: string) => void;
}) {
  useEffect(() => {
    onError(`${format} format loading is not yet supported — showing procedural preview`);
  }, [format, onError]);
  return <ProceduralMesh kind={proceduralKind} />;
}

function LoaderOverlay() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2 px-4 py-3 rounded-lg bg-card/95 border border-border backdrop-blur">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-glow" />
        <span className="text-xs text-muted-foreground">{progress.toFixed(0)}%</span>
      </div>
    </Html>
  );
}

// =====================================================================
// Main exported viewer
// =====================================================================

export interface ThreeViewerProps {
  geometry?: ModelGeometryKind;
  modelUrl?: string;
  modelFormat?: 'STL' | 'GLB' | 'OBJ' | 'PLY';
  wireframe?: boolean;
  showGrid?: boolean;
  showAxes?: boolean;
  className?: string;
  onStats?: (stats: ModelStats) => void;
  onError?: (msg: string) => void;
}

export function ThreeViewer({
  geometry = 'gear',
  modelUrl,
  modelFormat,
  wireframe = false,
  showGrid = true,
  showAxes = true,
  className,
  onStats,
  onError,
}: ThreeViewerProps) {
  const [error, setError] = useState<string | null>(null);

  // Check WebGL support lazily on first render
  const webglFailed = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !gl;
    } catch {
      return true;
    }
  }, []);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    onError?.(msg);
  }, [onError]);

  if (webglFailed) {
    return (
      <div className={cn('flex items-center justify-center bg-card/40 border border-border rounded-lg', className)}>
        <div className="text-center p-6 max-w-xs">
          <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">WebGL unavailable</p>
          <p className="text-xs text-muted-foreground">
            Your browser does not support WebGL, which is required for 3D rendering.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center bg-card/40 border border-destructive/30 rounded-lg', className)}>
        <div className="text-center p-6 max-w-xs">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Failed to load model</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative bg-gradient-to-br from-card/80 to-background/80 rounded-lg overflow-hidden', className)}>
      <Canvas
        shadows
        camera={{ position: [3, 2, 3], fov: 50 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0a0a0f']} />
        <fog attach="fog" args={['#0a0a0f', 8, 18]} />

        <ambientLight intensity={0.35} />
        <directionalLight
          position={[5, 8, 5]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-far={20}
          shadow-camera-left={-5}
          shadow-camera-right={5}
          shadow-camera-top={5}
          shadow-camera-bottom={-5}
        />
        <pointLight position={[-5, 3, -3]} intensity={0.4} color="#5dd9e8" />
        <pointLight position={[5, 3, -3]} intensity={0.3} color="#a78bfa" />

        <Suspense fallback={<LoaderOverlay />}>
          <group>
            <ModelLoader
              url={modelUrl}
              format={modelFormat}
              proceduralKind={geometry}
              onStats={onStats}
              onError={handleError}
              wireframe={wireframe}
            />
            {wireframe && (
              <mesh>
                <sphereGeometry args={[1.8, 16, 16]} />
                <meshBasicMaterial color="#5dd9e8" wireframe transparent opacity={0.05} />
              </mesh>
            )}
          </group>

          {showGrid && (
            <Grid
              position={[0, -1.3, 0]}
              args={[20, 20]}
              cellSize={0.5}
              cellThickness={0.5}
              cellColor="#1a1a2a"
              sectionSize={2}
              sectionThickness={1}
              sectionColor="#5dd9e8"
              fadeDistance={20}
              fadeStrength={1.5}
              infiniteGrid
            />
          )}

          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            minDistance={1.5}
            maxDistance={12}
            maxPolarAngle={Math.PI * 0.85}
          />

          {showAxes && (
            <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
              <GizmoViewport
                axisColors={['#5dd9e8', '#a78bfa', '#f59e0b']}
                labelColor="white"
              />
            </GizmoHelper>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}

// =====================================================================
// Viewer controls
// =====================================================================

export function ViewerControls({
  wireframe, onToggleWireframe,
  showGrid, onToggleGrid,
  showAxes, onToggleAxes,
  onReset,
  onFit,
  onDownload,
}: {
  wireframe: boolean;
  onToggleWireframe: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  showAxes: boolean;
  onToggleAxes: () => void;
  onReset: () => void;
  onFit: () => void;
  onDownload?: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        variant="outline" size="sm"
        className={cn('h-8 gap-1.5', wireframe && 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow')}
        onClick={onToggleWireframe}
      >
        <Box className="h-3.5 w-3.5" />
        Wireframe
      </Button>
      <Button
        variant="outline" size="sm"
        className={cn('h-8 gap-1.5', showGrid && 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow')}
        onClick={onToggleGrid}
      >
        <Grid3x3 className="h-3.5 w-3.5" />
        Grid
      </Button>
      <Button
        variant="outline" size="sm"
        className={cn('h-8 gap-1.5', showAxes && 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow')}
        onClick={onToggleAxes}
      >
        <Axis3d className="h-3.5 w-3.5" />
        Axes
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onFit}>
        <Maximize2 className="h-3.5 w-3.5" />
        Fit
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </Button>
      {onDownload && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      )}
    </div>
  );
}
