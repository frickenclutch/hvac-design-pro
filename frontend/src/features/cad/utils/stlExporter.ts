import * as THREE from 'three';

/**
 * Collects all Mesh objects from a scene, applying world transforms.
 * Returns an array of { positions: Float32Array (world-space), normals: Float32Array (world-space) }
 * where every 9 consecutive floats in positions form one triangle (3 vertices x 3 components).
 */
function collectTriangles(
  scene: THREE.Scene
): Array<{ positions: number[]; normals: number[] }> {
  const results: Array<{ positions: number[]; normals: number[] }> = [];

  scene.updateMatrixWorld(true);

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const mesh = object as THREE.Mesh;
    let geometry = mesh.geometry;

    if (!geometry || !geometry.attributes.position) return;

    // Clone geometry so we can apply the world matrix without mutating the original
    geometry = geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);

    const posAttr = geometry.attributes.position;
    const normalAttr = geometry.attributes.normal;
    const index = geometry.index;

    const positions: number[] = [];
    const normals: number[] = [];

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();

    if (index) {
      // Indexed geometry
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);

        vA.fromBufferAttribute(posAttr, a);
        vB.fromBufferAttribute(posAttr, b);
        vC.fromBufferAttribute(posAttr, c);

        positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);

        // Compute face normal
        if (normalAttr) {
          const nA = new THREE.Vector3().fromBufferAttribute(normalAttr, a);
          const nB = new THREE.Vector3().fromBufferAttribute(normalAttr, b);
          const nC = new THREE.Vector3().fromBufferAttribute(normalAttr, c);
          // Average vertex normals to get face normal
          const faceNormal = nA.add(nB).add(nC).normalize();
          normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
        } else {
          cb.subVectors(vC, vB);
          ab.subVectors(vA, vB);
          cb.cross(ab).normalize();
          normals.push(cb.x, cb.y, cb.z);
        }
      }
    } else {
      // Non-indexed geometry
      for (let i = 0; i < posAttr.count; i += 3) {
        vA.fromBufferAttribute(posAttr, i);
        vB.fromBufferAttribute(posAttr, i + 1);
        vC.fromBufferAttribute(posAttr, i + 2);

        positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);

        if (normalAttr) {
          const nA = new THREE.Vector3().fromBufferAttribute(normalAttr, i);
          const nB = new THREE.Vector3().fromBufferAttribute(normalAttr, i + 1);
          const nC = new THREE.Vector3().fromBufferAttribute(normalAttr, i + 2);
          const faceNormal = nA.add(nB).add(nC).normalize();
          normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
        } else {
          cb.subVectors(vC, vB);
          ab.subVectors(vA, vB);
          cb.cross(ab).normalize();
          normals.push(cb.x, cb.y, cb.z);
        }
      }
    }

    results.push({ positions, normals });
  });

  return results;
}

/**
 * Triggers a browser file download from a Blob.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports the current 3D scene as an ASCII STL file for 3D printing.
 *
 * Traverses the scene collecting all Mesh objects, applies world transforms,
 * and writes triangle data in STL format.
 *
 * @param scene - The THREE.Scene to export
 * @param filename - Output filename (default: "hvac-model.stl")
 */
export function exportSceneAsSTL(
  scene: THREE.Scene,
  filename: string = 'hvac-model.stl'
): void {
  const meshData = collectTriangles(scene);

  const lines: string[] = [];
  lines.push('solid hvac-model');

  for (const { positions, normals } of meshData) {
    const triangleCount = normals.length / 3;

    for (let t = 0; t < triangleCount; t++) {
      const nx = normals[t * 3];
      const ny = normals[t * 3 + 1];
      const nz = normals[t * 3 + 2];

      const baseIdx = t * 9;
      const v1x = positions[baseIdx];
      const v1y = positions[baseIdx + 1];
      const v1z = positions[baseIdx + 2];
      const v2x = positions[baseIdx + 3];
      const v2y = positions[baseIdx + 4];
      const v2z = positions[baseIdx + 5];
      const v3x = positions[baseIdx + 6];
      const v3y = positions[baseIdx + 7];
      const v3z = positions[baseIdx + 8];

      lines.push(`  facet normal ${nx} ${ny} ${nz}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${v1x} ${v1y} ${v1z}`);
      lines.push(`      vertex ${v2x} ${v2y} ${v2z}`);
      lines.push(`      vertex ${v3x} ${v3y} ${v3z}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }

  lines.push('endsolid hvac-model');

  const stlString = lines.join('\n');
  const blob = new Blob([stlString], { type: 'application/sla' });
  downloadBlob(blob, filename);
}

/**
 * Exports the current 3D scene as a Wavefront OBJ file.
 *
 * Traverses the scene collecting all Mesh objects, applies world transforms,
 * and writes vertex/normal/face data in OBJ format.
 *
 * @param scene - The THREE.Scene to export
 * @param filename - Output filename (default: "hvac-model.obj")
 */
export function exportSceneAsOBJ(
  scene: THREE.Scene,
  filename: string = 'hvac-model.obj'
): void {
  const meshData = collectTriangles(scene);

  const lines: string[] = [];
  lines.push('# HVAC Design Pro - OBJ Export');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  let vertexOffset = 1; // OBJ indices are 1-based
  let normalOffset = 1;

  for (const { positions, normals } of meshData) {
    const triangleCount = normals.length / 3;

    // Write vertices
    for (let i = 0; i < positions.length; i += 3) {
      lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
    }

    // Write normals (one per face, but OBJ expects per-vertex references)
    for (let t = 0; t < triangleCount; t++) {
      const nx = normals[t * 3];
      const ny = normals[t * 3 + 1];
      const nz = normals[t * 3 + 2];
      lines.push(`vn ${nx} ${ny} ${nz}`);
    }

    // Write faces
    for (let t = 0; t < triangleCount; t++) {
      const v1 = vertexOffset + t * 3;
      const v2 = vertexOffset + t * 3 + 1;
      const v3 = vertexOffset + t * 3 + 2;
      const n = normalOffset + t;
      lines.push(`f ${v1}//${n} ${v2}//${n} ${v3}//${n}`);
    }

    vertexOffset += triangleCount * 3;
    normalOffset += triangleCount;
  }

  const objString = lines.join('\n');
  const blob = new Blob([objString], { type: 'text/plain' });
  downloadBlob(blob, filename);
}
