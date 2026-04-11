import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { X, RotateCcw, Grid3x3, Sun, Eye, EyeOff, Download, Upload, Thermometer } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import type { WallSegment } from '../store/useCadStore';
import { fmtLength, fmtArea } from '../../../utils/units';
import {
  createDoorModel,
  createWindowModel,
  createSupplyRegisterModel,
  createReturnGrilleModel,
  createAirHandlerModel,
  createCondenserModel,
  createThermostatModel,
  createDuctRunModel,
  createPipeModel,
} from '../utils/assetModels';
import { exportSceneAsSTL, exportSceneAsOBJ } from '../utils/stlExporter';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Viewer3DProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TooltipData {
  x: number;
  y: number;
  type: string;
  details: string[];
}

// ── Color constants ────────────────────────────────────────────────────────────
const WALL_COLORS: Record<string, number> = {
  insulated_stud: 0x4ade80,
  cmu: 0x94a3b8,
  concrete: 0x64748b,
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function wallLength(w: WallSegment, pxPerFt: number): number {
  const dx = (w.x2 - w.x1) / pxPerFt;
  const dy = (w.y2 - w.y1) / pxPerFt;
  return Math.sqrt(dx * dx + dy * dy);
}

function wallAngle(w: WallSegment): number {
  return Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
}

function wallCenter(w: WallSegment, pxPerFt: number): [number, number] {
  return [
    ((w.x1 + w.x2) / 2) / pxPerFt,
    ((w.y1 + w.y2) / 2) / pxPerFt,
  ];
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function Viewer3D({ isOpen, onClose }: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const hoveredRef = useRef<THREE.Mesh | null>(null);
  const dirtyRef = useRef(true);

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showShadows, setShowShadows] = useState(true);
  const [visibleFloors, setVisibleFloors] = useState<Set<string>>(new Set());
  const [showAllFloors, setShowAllFloors] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [thermalMode, setThermalMode] = useState(false);
  const [roofStyle, setRoofStyle] = useState<'none' | 'flat' | 'gable' | 'hip'>('none');
  const [roofPitch, setRoofPitch] = useState<number>(4);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importedGroupsRef = useRef<THREE.Group[]>([]);

  const floors = useCadStore((s) => s.floors);
  const pxPerFt = useCadStore((s) => s.projectScale.pxPerFt);
  const activeProjectName = useProjectStore((s) => s.activeProjectName);

  // Initialize visible floors
  useEffect(() => {
    if (isOpen) {
      setVisibleFloors(new Set(floors.map((f) => f.id)));
      setShowAllFloors(true);
    }
  }, [isOpen, floors]);

  // ── Build Scene ──────────────────────────────────────────────────────────────
  const buildScene = useCallback(
    (scene: THREE.Scene) => {
      // Clear previous meshes
      meshesRef.current.forEach((m) => {
        m.geometry.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          (m.material as THREE.Material).dispose();
        }
        scene.remove(m);
      });
      meshesRef.current = [];

      // Remove old groups
      const toRemove: THREE.Object3D[] = [];
      scene.traverse((child) => {
        if (child.userData.__floorGeometry) toRemove.push(child);
      });
      toRemove.forEach((obj) => scene.remove(obj));

      const floorsToShow = floors.filter(
        (f) => showAllFloors || visibleFloors.has(f.id),
      );

      // Track bounding box for camera
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

      floorsToShow.forEach((floor) => {
        const floorOffset = floor.index * floor.heightFt;
        const group = new THREE.Group();
        group.userData.__floorGeometry = true;

        // ── Walls ──────────────────────────────────────────────────────────
        floor.walls.forEach((wall) => {
          const len = wallLength(wall, pxPerFt);
          if (len < 0.01) return;
          const angle = wallAngle(wall);
          const [cx, cz] = wallCenter(wall, pxPerFt);
          const thicknessFt = wall.thicknessIn / 12;

          const geo = new THREE.BoxGeometry(len, floor.heightFt, thicknessFt);

          // Thermal mode: color walls by R-value grade
          let wallColor = WALL_COLORS[wall.material] ?? 0x94a3b8;
          if (thermalMode) {
            if (wall.rValue >= 21) wallColor = 0x22c55e;      // excellent - green
            else if (wall.rValue >= 13) wallColor = 0x3b82f6;  // good - blue
            else if (wall.rValue >= 7) wallColor = 0xf59e0b;   // fair - amber
            else wallColor = 0xef4444;                          // poor - red
          }

          const mat = new THREE.MeshStandardMaterial({
            color: wallColor,
            transparent: true,
            opacity: thermalMode ? 0.92 : 0.85,
            wireframe: showWireframe,
            roughness: 0.7,
            metalness: 0.1,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(cx, floorOffset + floor.heightFt / 2, cz);
          mesh.rotation.y = -angle;
          mesh.castShadow = showShadows;
          mesh.receiveShadow = showShadows;
          mesh.userData = {
            id: wall.id,
            objectType: 'wall',
            material: wall.material,
            thickness: wall.thicknessIn,
            rValue: wall.rValue,
            length: len.toFixed(1),
          };
          group.add(mesh);
          meshesRef.current.push(mesh);

          // Update bounds
          minX = Math.min(minX, cx - len / 2);
          maxX = Math.max(maxX, cx + len / 2);
          minZ = Math.min(minZ, cz - len / 2);
          maxZ = Math.max(maxZ, cz + len / 2);
        });

        // ── Openings ───────────────────────────────────────────────────────
        floor.openings.forEach((opening) => {
          const parentWall = floor.walls.find((w) => w.id === opening.wallId);
          if (!parentWall) return;

          const wAngle = wallAngle(parentWall);
          const thicknessFt = parentWall.thicknessIn / 12;
          const widthFt = opening.widthIn / 12;
          const heightFt = opening.heightIn / 12;

          // Position along wall
          const t = opening.positionAlongWall;
          const wx1 = parentWall.x1 / pxPerFt;
          const wy1 = parentWall.y1 / pxPerFt;
          const wx2 = parentWall.x2 / pxPerFt;
          const wy2 = parentWall.y2 / pxPerFt;
          const ox = wx1 + (wx2 - wx1) * t;
          const oz = wy1 + (wy2 - wy1) * t;

          if (opening.type === 'window') {
            const windowGroup = createWindowModel(widthFt, heightFt, thicknessFt + 0.1, showWireframe);
            windowGroup.position.set(ox, floorOffset + 4 + heightFt / 2, oz);
            windowGroup.rotation.y = -wAngle;
            windowGroup.userData = {
              id: opening.id,
              objectType: 'window',
              width: opening.widthIn,
              height: opening.heightIn,
              uFactor: opening.uFactor,
              shgc: opening.shgc,
              glassType: opening.glassType,
            };
            // Collect child meshes for raycasting
            windowGroup.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.userData = { ...windowGroup.userData };
                child.castShadow = showShadows;
                child.receiveShadow = showShadows;
                meshesRef.current.push(child);
              }
            });
            group.add(windowGroup);
          } else {
            // Door or sliding door — enhanced model
            const swing = (opening.swingDirection as 'left' | 'right') || 'left';
            const doorGroup = createDoorModel(widthFt, heightFt, swing, showWireframe);
            doorGroup.position.set(ox, floorOffset, oz);
            doorGroup.rotation.y = -wAngle;
            doorGroup.userData = {
              id: opening.id,
              objectType: opening.type,
              width: opening.widthIn,
              height: opening.heightIn,
              swing: opening.swingDirection,
            };
            doorGroup.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.userData = { ...doorGroup.userData };
                child.castShadow = showShadows;
                child.receiveShadow = showShadows;
                meshesRef.current.push(child);
              }
            });
            group.add(doorGroup);
          }
        });

        // ── HVAC Units ─────────────────────────────────────────────────────
        floor.hvacUnits.forEach((unit) => {
          const ux = unit.x / pxPerFt;
          const uz = unit.y / pxPerFt;

          let assetGroup: THREE.Group;
          let yOffset = 0;

          switch (unit.type) {
            case 'supply_register':
              assetGroup = createSupplyRegisterModel(showWireframe);
              yOffset = floorOffset;
              break;
            case 'return_grille':
              assetGroup = createReturnGrilleModel(showWireframe);
              yOffset = floorOffset;
              break;
            case 'air_handler':
              assetGroup = createAirHandlerModel(showWireframe);
              yOffset = floorOffset;
              break;
            case 'condenser':
              assetGroup = createCondenserModel(showWireframe);
              yOffset = floorOffset;
              break;
            case 'thermostat':
              assetGroup = createThermostatModel(showWireframe);
              yOffset = floorOffset + 4.5;
              break;
            case 'duct_run':
              assetGroup = createDuctRunModel(showWireframe);
              yOffset = floorOffset + floor.heightFt - 1;
              break;
            default: {
              assetGroup = new THREE.Group();
              const geo = new THREE.BoxGeometry(1, 1, 1);
              const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, wireframe: showWireframe });
              const fallback = new THREE.Mesh(geo, mat);
              assetGroup.add(fallback);
              yOffset = floorOffset + 0.5;
            }
          }

          assetGroup.position.set(ux, yOffset, uz);
          const ud = {
            id: unit.id,
            objectType: unit.type,
            cfm: unit.cfm,
            label: unit.label,
          };
          assetGroup.userData = ud;
          assetGroup.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = showShadows;
              child.receiveShadow = showShadows;
              child.userData = { ...ud };
              meshesRef.current.push(child);
            }
          });
          group.add(assetGroup);

          minX = Math.min(minX, ux - 2);
          maxX = Math.max(maxX, ux + 2);
          minZ = Math.min(minZ, uz - 2);
          maxZ = Math.max(maxZ, uz + 2);
        });

        // ── Floor planes ───────────────────────────────────────────────────
        if (floor.rooms.length > 0) {
          floor.rooms.forEach((room) => {
            const rx = room.centroid.x / pxPerFt;
            const rz = room.centroid.y / pxPerFt;
            const size = Math.sqrt(room.areaSqFt);
            const geo = new THREE.PlaneGeometry(size, size);
            const mat = new THREE.MeshStandardMaterial({
              color: room.color || '#334155',
              transparent: true,
              opacity: 0.25,
              side: THREE.DoubleSide,
              wireframe: showWireframe,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(rx, floorOffset + 0.01, rz);
            mesh.receiveShadow = showShadows;
            mesh.userData = {
              id: room.id,
              objectType: 'room',
              name: room.name,
              area: room.areaSqFt,
            };
            group.add(mesh);
            meshesRef.current.push(mesh);
          });
        } else {
          // Fallback: generic floor plane
          const size = Math.max(maxX - minX, maxZ - minZ, 20);
          const centerX = isFinite(minX) ? (minX + maxX) / 2 : 0;
          const centerZ = isFinite(minZ) ? (minZ + maxZ) / 2 : 0;
          const geo = new THREE.PlaneGeometry(size + 10, size + 10);
          const mat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            wireframe: showWireframe,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(centerX, floorOffset + 0.01, centerZ);
          mesh.receiveShadow = showShadows;
          mesh.userData = { objectType: 'floor_plane', floor: floor.name };
          group.add(mesh);
          meshesRef.current.push(mesh);
        }

        // ── Piping ─────────────────────────────────────────────────────────
        const pipingLayer = useCadStore.getState().layers.find(l => l.id === 'piping');
        if (pipingLayer?.visible && floor.pipes) {
          floor.pipes.forEach((pipe) => {
            const len = wallLength(pipe as any, pxPerFt);
            if (len < 0.01) return;
            const angle = wallAngle(pipe as any);
            const [cx, cz] = wallCenter(pipe as any, pxPerFt);
            
            // Mounting height: default to floor level for now, or HVAC unit height
            const y = floorOffset + 0.1; // slightly above floor to avoid z-fighting
            
            const pipeGroup = createPipeModel(len, pipe.diameterIn, pipe.material, showWireframe);
            pipeGroup.position.set(cx - (len/2 * Math.cos(angle)), y, cz - (len/2 * Math.sin(angle)));
            pipeGroup.rotation.y = -angle;

            const ud = {
              id: pipe.id,
              objectType: 'pipe',
              material: pipe.material,
              diameter: pipe.diameterIn,
              length: len.toFixed(1),
            };
            pipeGroup.userData = ud;
            pipeGroup.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = showShadows;
                child.receiveShadow = showShadows;
                child.userData = { ...ud };
                child.material.transparent = true;
                child.material.opacity *= (pipingLayer.opacity ?? 1);
                meshesRef.current.push(child);
              }
            });
            group.add(pipeGroup);
          });
        }

        // ── Floor Slab (Physical structure between floors) ────────────────
        if (isFinite(minX) && isFinite(maxX) && isFinite(minZ) && isFinite(maxZ)) {
          const slabGeo = new THREE.BoxGeometry(maxX - minX + 10, 0.4, maxZ - minZ + 10);
          const slabMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            transparent: true,
            opacity: 0.15,
            roughness: 0.9,
          });
          const slab = new THREE.Mesh(slabGeo, slabMat);
          slab.position.set((minX + maxX) / 2, floorOffset - 0.2, (minZ + maxZ) / 2);
          slab.receiveShadow = true;
          group.add(slab);
        }

        scene.add(group);
      });

      // ── Procedural Roof ──────────────────────────────────────────────────────────
      if (roofStyle !== 'none' && isFinite(minX) && floorsToShow.length > 0) {
        const maxFloor = floorsToShow.reduce((prev, current) => (prev.index > current.index) ? prev : current, floorsToShow[0]);
        const roofBaseY = (maxFloor.index + 1) * maxFloor.heightFt;
        const roofW = maxX - minX + 2; // 1ft overhang each side
        const roofD = maxZ - minZ + 2;
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;

        const roofGroup = new THREE.Group();
        const roofMat = new THREE.MeshStandardMaterial({
          color: 0x475569, // Slate 600
          roughness: 0.9,
          wireframe: showWireframe,
        });

        if (roofStyle === 'flat') {
          const rMesh = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.5, roofD), roofMat);
          rMesh.position.set(cx, roofBaseY + 0.25, cz);
          rMesh.castShadow = showShadows;
          rMesh.receiveShadow = showShadows;
          roofGroup.add(rMesh);
        } else if (roofStyle === 'gable') {
          const roofHeight = (roofW / 2) * (roofPitch / 12);
          const shape = new THREE.Shape();
          shape.moveTo(-roofW / 2, 0);
          shape.lineTo(0, roofHeight);
          shape.lineTo(roofW / 2, 0);
          shape.lineTo(-roofW / 2, 0);
          const extrudeSettings = { depth: roofD, bevelEnabled: false };
          const rGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
          const rMesh = new THREE.Mesh(rGeo, roofMat);
          rMesh.position.set(cx, roofBaseY, cz - roofD / 2);
          rMesh.castShadow = showShadows;
          rMesh.receiveShadow = showShadows;
          roofGroup.add(rMesh);
        } else if (roofStyle === 'hip') {
          const roofHeight = (Math.min(roofW, roofD) / 2) * (roofPitch / 12);
          const rGeo = new THREE.BufferGeometry();
          const ridgeLen = Math.max(0, roofW - roofD);
          if (roofW >= roofD) {
            const ridgeX1 = -ridgeLen / 2;
            const ridgeX2 = ridgeLen / 2;
            const vertices = new Float32Array([
              -roofW/2, 0, -roofD/2,  roofW/2, 0, -roofD/2,
              roofW/2, 0, roofD/2,   -roofW/2, 0, roofD/2,
              ridgeX1, roofHeight, 0, ridgeX2, roofHeight, 0,
            ]);
            // CCW triangles
            const indices = [
              0, 5, 1,  0, 4, 5,
              1, 5, 2,
              2, 5, 4,  2, 4, 3,
              3, 4, 0,
              0, 1, 2,  0, 2, 3
            ];
            rGeo.setIndex(indices);
            rGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            rGeo.computeVertexNormals();
            const rMesh = new THREE.Mesh(rGeo, roofMat);
            rMesh.position.set(cx, roofBaseY, cz);
            rMesh.castShadow = showShadows;
            rMesh.receiveShadow = showShadows;
            roofGroup.add(rMesh);
          } else {
            const ridgeZ1 = -Math.max(0, roofD - roofW) / 2;
            const ridgeZ2 = Math.max(0, roofD - roofW) / 2;
            const vertices = new Float32Array([
              -roofW/2, 0, -roofD/2,  roofW/2, 0, -roofD/2,
              roofW/2, 0, roofD/2,   -roofW/2, 0, roofD/2,
              0, roofHeight, ridgeZ1, 0, roofHeight, ridgeZ2,
            ]);
            const indices = [
              0, 4, 1,
              1, 4, 5, 1, 5, 2,
              2, 5, 3,
              3, 5, 4, 3, 4, 0,
              0, 1, 2, 0, 2, 3
            ];
            rGeo.setIndex(indices);
            rGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            rGeo.computeVertexNormals();
            const rMesh = new THREE.Mesh(rGeo, roofMat);
            rMesh.position.set(cx, roofBaseY, cz);
            rMesh.castShadow = showShadows;
            rMesh.receiveShadow = showShadows;
            roofGroup.add(rMesh);
          }
        }
        scene.add(roofGroup);
      }

      dirtyRef.current = true;
      return { minX, maxX, minZ, maxZ };
    },
    // Stabilize visibleFloors Set by converting to sorted string key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floors, pxPerFt, showWireframe, showShadows, showAllFloors, [...visibleFloors].sort().join(','), thermalMode, roofStyle, roofPitch],
  );

  // ── Init Three.js ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.003);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = showShadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 500;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controlsRef.current = controls;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfff8e7, 0.8);
    dirLight.position.set(30, 50, 20);
    dirLight.castShadow = showShadows;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -80;
    dirLight.shadow.camera.right = 80;
    dirLight.shadow.camera.top = 80;
    dirLight.shadow.camera.bottom = -80;
    scene.add(dirLight);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362f2f, 0.3);
    scene.add(hemi);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = showShadows;
    ground.userData = { objectType: 'ground' };
    scene.add(ground);

    // Grid helper
    const grid = new THREE.GridHelper(200, 200, 0x334155, 0x1e293b);
    grid.position.y = -0.02;
    scene.add(grid);

    // Build geometry
    const bounds = buildScene(scene);

    // Position camera
    const cx = isFinite(bounds.minX) ? (bounds.minX + bounds.maxX) / 2 : 0;
    const cz = isFinite(bounds.minZ) ? (bounds.minZ + bounds.maxZ) / 2 : 0;
    const span = isFinite(bounds.maxX) ? Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 20) : 40;
    camera.position.set(cx + span * 0.8, span * 0.7, cz + span * 0.8);
    controls.target.set(cx, 0, cz);
    controls.update();

    // Render loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      // Always render when controls are damping
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      dirtyRef.current = true;
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      renderer.dispose();
      // Dispose all meshes
      meshesRef.current.forEach((m) => {
        m.geometry.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          (m.material as THREE.Material).dispose();
        }
      });
      meshesRef.current = [];
      groundGeo.dispose();
      groundMat.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Rebuild geometry when settings change ────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !sceneRef.current) return;
    buildScene(sceneRef.current);
  }, [isOpen, buildScene]);

  // ── Toggle shadows on renderer ───────────────────────────────────────────────
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.shadowMap.enabled = showShadows;
      rendererRef.current.shadowMap.needsUpdate = true;
      dirtyRef.current = true;
    }
  }, [showShadows]);

  // ── Raycaster / hover ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const intersects = raycasterRef.current.intersectObjects(meshesRef.current, false);

      // Reset previous hover
      if (hoveredRef.current) {
        const mat = hoveredRef.current.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x000000);
        hoveredRef.current = null;
      }

      if (intersects.length > 0) {
        const hit = intersects[0].object as THREE.Mesh;
        if (hit.userData.objectType && hit.userData.objectType !== 'ground' && hit.userData.objectType !== 'floor_plane') {
          const mat = hit.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x333333);
          hoveredRef.current = hit;

          const details: string[] = [];
          const ud = hit.userData;
          if (ud.material) details.push(`Material: ${ud.material}`);
          if (ud.thickness) details.push(`Thickness: ${ud.thickness}"`);
          if (ud.rValue) details.push(`R-Value: ${ud.rValue}`);
          if (ud.length) details.push(`Length: ${fmtLength(parseFloat(ud.length))}`);
          if (ud.width) details.push(`Width: ${ud.width}"`);
          if (ud.height) details.push(`Height: ${ud.height}"`);
          if (ud.uFactor) details.push(`U-Factor: ${ud.uFactor}`);
          if (ud.shgc) details.push(`SHGC: ${ud.shgc}`);
          if (ud.glassType) details.push(`Glass: ${ud.glassType}`);
          if (ud.cfm) details.push(`CFM: ${ud.cfm}`);
          if (ud.label) details.push(`Label: ${ud.label}`);
          if (ud.name) details.push(`Name: ${ud.name}`);
          if (ud.area) details.push(`Area: ${fmtArea(ud.area)}`);
          if (ud.swing) details.push(`Swing: ${ud.swing}`);

          setTooltip({
            x: e.clientX,
            y: e.clientY,
            type: ud.objectType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            details,
          });
        } else {
          setTooltip(null);
        }
      } else {
        setTooltip(null);
      }

      dirtyRef.current = true;
    },
    [],
  );

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // ── Camera reset ─────────────────────────────────────────────────────────────
  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    // Recompute bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    meshesRef.current.forEach((m) => {
      const p = m.position;
      minX = Math.min(minX, p.x - 5);
      maxX = Math.max(maxX, p.x + 5);
      minZ = Math.min(minZ, p.z - 5);
      maxZ = Math.max(maxZ, p.z + 5);
    });
    const cx = isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cz = isFinite(minZ) ? (minZ + maxZ) / 2 : 0;
    const span = isFinite(maxX) ? Math.max(maxX - minX, maxZ - minZ, 20) : 40;
    cameraRef.current.position.set(cx + span * 0.8, span * 0.7, cz + span * 0.8);
    controlsRef.current.target.set(cx, 0, cz);
    controlsRef.current.update();
    dirtyRef.current = true;
  }, []);

  // ── Toggle floor visibility ──────────────────────────────────────────────────
  const toggleFloor = useCallback((floorId: string) => {
    setShowAllFloors(false);
    setVisibleFloors((prev) => {
      const next = new Set(prev);
      if (next.has(floorId)) {
        next.delete(floorId);
      } else {
        next.add(floorId);
      }
      return next;
    });
  }, []);

  const toggleAllFloors = useCallback(() => {
    setShowAllFloors(true);
    setVisibleFloors(new Set(floors.map((f) => f.id)));
  }, [floors]);

  const handleExportSTL = useCallback(() => {
    if (sceneRef.current) {
      exportSceneAsSTL(sceneRef.current);
      setShowExportMenu(false);
    }
  }, []);

  const handleExportOBJ = useCallback(() => {
    if (sceneRef.current) {
      exportSceneAsOBJ(sceneRef.current);
      setShowExportMenu(false);
    }
  }, []);

  const handle3DFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sceneRef.current) return;
    e.target.value = ''; // reset for re-upload

    const MAX_3D_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_3D_SIZE) {
      setUploadStatus(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`);
      setTimeout(() => setUploadStatus(null), 4000);
      return;
    }

    const scene = sceneRef.current;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const url = URL.createObjectURL(file);
    setUploadStatus(`Loading ${file.name}...`);

    const addToScene = (object: THREE.Object3D, name: string) => {
      // Normalize scale — compute bounding box and fit to ~10 ft
      const box = new THREE.Box3().setFromObject(object);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const targetSize = 10; // ~10 ft
        const scale = targetSize / maxDim;
        object.scale.multiplyScalar(scale);
      }

      // Center on ground
      const box2 = new THREE.Box3().setFromObject(object);
      const center = new THREE.Vector3();
      box2.getCenter(center);
      object.position.sub(center);
      object.position.y += (box2.max.y - box2.min.y) / 2;

      // Apply default material if needed, enable shadows
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (!child.material || (child.material as THREE.Material).type === 'MeshBasicMaterial') {
            child.material = new THREE.MeshStandardMaterial({
              color: 0xb0b8c4,
              roughness: 0.5,
              metalness: 0.3,
            });
          }
          child.castShadow = true;
          child.receiveShadow = true;
          child.userData = {
            objectType: 'imported_model',
            name,
            file: file.name,
          };
          meshesRef.current.push(child);
        }
      });

      const group = new THREE.Group();
      group.add(object);
      group.userData = { __importedModel: true, name };
      importedGroupsRef.current.push(group);
      scene.add(group);
      dirtyRef.current = true;
      setUploadStatus(null);
      URL.revokeObjectURL(url);
    };

    const onError = (err: unknown) => {
      console.error('3D import error:', err);
      setUploadStatus(`Failed to load ${file.name}`);
      setTimeout(() => setUploadStatus(null), 3000);
      URL.revokeObjectURL(url);
    };

    try {
      if (ext === 'stl') {
        new STLLoader().load(url, (geometry) => {
          const mat = new THREE.MeshStandardMaterial({ color: 0xb0b8c4, roughness: 0.5, metalness: 0.3 });
          const mesh = new THREE.Mesh(geometry, mat);
          addToScene(mesh, file.name.replace(/\.stl$/i, ''));
        }, undefined, onError);
      } else if (ext === 'obj') {
        new OBJLoader().load(url, (obj) => {
          addToScene(obj, file.name.replace(/\.obj$/i, ''));
        }, undefined, onError);
      } else if (ext === 'gltf' || ext === 'glb') {
        new GLTFLoader().load(url, (gltf) => {
          addToScene(gltf.scene, file.name.replace(/\.(gltf|glb)$/i, ''));
        }, undefined, onError);
      } else if (ext === 'fbx') {
        new FBXLoader().load(url, (fbx) => {
          addToScene(fbx, file.name.replace(/\.fbx$/i, ''));
        }, undefined, onError);
      } else {
        setUploadStatus(`Unsupported format: .${ext}`);
        setTimeout(() => setUploadStatus(null), 3000);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      onError(err);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 pointer-events-auto">
      {/* Three.js canvas container — behind everything */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        onMouseMove={handleMouseMove}
      />

      {/* ── Top-left: Title + Floor selector ─────────────────────────────── */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
        <div className="glass-panel rounded-xl px-4 py-3 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <h2 className="text-lg font-bold text-slate-100 tracking-wide mb-2">
            {activeProjectName ? `${activeProjectName} — 3D View` : '3D View'}
          </h2>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={toggleAllFloors}
              className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all ${
                showAllFloors
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
              }`}
            >
              <Eye className="w-3 h-3" />
              All Floors
            </button>
            {floors.map((f) => (
              <button
                key={f.id}
                onClick={() => toggleFloor(f.id)}
                className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all ${
                  !showAllFloors && visibleFloors.has(f.id)
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    : !showAllFloors && !visibleFloors.has(f.id)
                    ? 'text-slate-600 hover:text-slate-400 hover:bg-slate-800/50 border border-transparent'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
                }`}
              >
                {!showAllFloors && visibleFloors.has(f.id) ? (
                  <Eye className="w-3 h-3" />
                ) : !showAllFloors ? (
                  <EyeOff className="w-3 h-3" />
                ) : (
                  <Eye className="w-3 h-3" />
                )}
                {f.name}
              </button>
            ))}

            <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-slate-700/50">
              <h3 className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Roof Model</h3>
              <select
                className="bg-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 border border-slate-700 outline-none focus:border-sky-500"
                value={roofStyle}
                onChange={(e) => setRoofStyle(e.target.value as any)}
              >
                <option value="none">No Roof</option>
                <option value="flat">Flat Roof</option>
                <option value="gable">Gable Roof</option>
                <option value="hip">Hip Roof</option>
              </select>
              {roofStyle !== 'none' && roofStyle !== 'flat' && (
                <div className="flex gap-2 items-center mt-1 px-1">
                  <span className="text-xs text-slate-400">Pitch:</span>
                  <input
                    type="number"
                    min="1" max="18"
                    className="bg-slate-800 text-xs text-slate-200 rounded-md w-14 px-2 py-1 border border-slate-700 outline-none"
                    value={roofPitch}
                    onChange={(e) => setRoofPitch(Number(e.target.value) || 4)}
                  />
                  <span className="text-xs text-slate-500">/12</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Top-right: Close + View controls ─────────────────────────────── */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <div className="glass-panel rounded-xl px-3 py-2 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl flex items-center gap-2">
          <button
            onClick={() => setShowWireframe((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${
              showWireframe ? 'text-sky-400 bg-sky-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Toggle Wireframe"
          >
            <Grid3x3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setThermalMode((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${
              thermalMode ? 'text-red-400 bg-red-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Thermal Mode — color walls by R-value"
          >
            <Thermometer className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowShadows((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${
              showShadows ? 'text-amber-400 bg-amber-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Toggle Shadows"
          >
            <Sun className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900/80 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-red-500/20 hover:border-red-500/30 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)] backdrop-blur-md"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── Bottom: Camera reset + Export + Controls hint ──────────────── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3">
        <button
          onClick={resetCamera}
          className="flex items-center gap-2 glass-panel rounded-xl px-4 py-2.5 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl text-slate-300 text-sm hover:text-white hover:bg-slate-800 transition-all"
        >
          <RotateCcw className="w-4 h-4" />
          Reset View
        </button>
        <div className="relative">
          <button
            onClick={() => setShowExportMenu((v) => !v)}
            className="flex items-center gap-2 glass-panel rounded-xl px-4 py-2.5 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl text-slate-300 text-sm hover:text-white hover:bg-slate-800 transition-all"
          >
            <Download className="w-4 h-4" />
            Export 3D
          </button>
          {showExportMenu && (
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 glass-panel rounded-xl border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden min-w-[160px]">
              <button
                onClick={handleExportSTL}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Export as STL
              </button>
              <button
                onClick={handleExportOBJ}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border-t border-slate-700/50"
              >
                Export as OBJ
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 glass-panel rounded-xl px-4 py-2.5 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl text-slate-300 text-sm hover:text-white hover:bg-slate-800 transition-all"
        >
          <Upload className="w-4 h-4" />
          Import 3D
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".stl,.obj,.gltf,.glb,.fbx"
          onChange={handle3DFileUpload}
          className="hidden"
        />
        <div className="glass-panel rounded-xl px-4 py-2.5 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <span className="text-[11px] text-slate-500 font-mono tracking-wide">
            Orbit: drag &nbsp;|&nbsp; Pan: right-drag &nbsp;|&nbsp; Zoom: scroll
          </span>
        </div>
      </div>

      {/* Upload status toast */}
      {uploadStatus && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 glass-panel rounded-xl px-5 py-3 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <span className="text-sm text-slate-200 font-medium">{uploadStatus}</span>
        </div>
      )}

      {/* ── Tooltip ──────────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-[110] glass-panel rounded-lg px-3 py-2 border border-slate-600/50 shadow-[0_5px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl max-w-xs"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <div className="text-sm font-semibold text-slate-100 mb-1">{tooltip.type}</div>
          {tooltip.details.map((d, i) => (
            <div key={i} className="text-[11px] text-slate-400 font-mono">{d}</div>
          ))}
        </div>
      )}
    </div>
  );
}
