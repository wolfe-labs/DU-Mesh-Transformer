import { Vector } from 'vector-math';
import { Accessor, vec3, vec4 } from '@gltf-transform/core';
import { transformMesh } from '@gltf-transform/functions';

// @ts-ignore
import { fromXRotation } from 'gl-matrix/mat4';

import {
  ProcessingQueueCommandParameters as CommandParams,
  EventType as EventType
} from '../types';
import { VectorObject } from 'vector-math/dist/lib/vector';

type TriangleVertices = [vec3, vec3, vec3];

const ROTATION_NONE: vec4 = [1, 0, 0, 0];

const directions = {
  right: new Vector(1, 0, 0),
  left: new Vector(-1, 0, 0),
  top: new Vector(0, 1, 0),
  bottom: new Vector(0, -1, 0),
  front: new Vector(0, 0, -1),
  back: new Vector(0, 0, 1),
};

function vectorToArray(vector: VectorObject): vec3 {
  return [vector.i, vector.j, vector.k];
}

function getFaceDirection(normal: vec3): vec3 {
  let closestDirection: vec3 = [0, 0, 0], closestSimilarity: number = -Infinity;
  let similarity;
  for (const direction of Object.values(directions)) {
    similarity = new Vector(...normal).Dot(direction);
    if (similarity > closestSimilarity) {
      closestDirection = vectorToArray(direction);
      closestSimilarity = similarity;
    }
  }

  return closestDirection;
}

function getPlaneCoordinatesFrom3dPoint(point3d: vec3, direction: vec3, swapYZ: boolean, offsetSize: number) {
  // Those are our mapping of axis to xyz indexes
  const axis = { x: 0, y: 1, z: 2 };

  // Gets the current face axis
  const [depthAxis, sign] = direction.map(
    (xyz, idx) => (xyz !== 0) && [idx, (xyz < 0) ? -1 : 1]
  ).find(idx => idx !== false) as [number, number];

  // When we do the YZ swap, we need to flip all axis again
  const axisXYSign = swapYZ ? -1 : 1;

  // Calculate which of the xyz indexes to use for X and Y coordinates
  // We also need to flip the coordinates in some cases
  let axisX, axisY, axisXSign = 1, axisYSign = 1, axisXOffset = 0, axisYOffset = 0;
  switch (depthAxis) {
    // Lateral view
    case axis.x:
      axisX = 1;
      axisY = 2;
      axisYSign = -1;
      axisXOffset = -2 * offsetSize;

      // Fixes issues caused by YZ swap
      if (swapYZ) {
        axisX = 2;
        axisY = 1;
        axisXSign = -1;
        axisXOffset = 0;
      }

      break;

    // Vertical view
    case axis.y:
      axisX = 0;
      axisY = 2;
      axisYSign = -1;

      // Fixes issues caused by YZ swap
      if (swapYZ) {
        axisXSign = -1;
        axisYSign = 1;
      }

      break;

    // Longitudinal view
    case axis.z:
      axisX = 0;
      axisY = 1;
      axisYSign = -1;
      // Fixes issues caused by YZ swap
      if (swapYZ) {
        axisXSign = -1;
        axisYOffset = 0;
      }

      break;
  }

  // Builds the final X and Y coordinates from our 3D point
  return [
    axisXYSign * axisXSign * point3d[axisX!] + axisXOffset,
    axisXYSign * axisYSign * point3d[axisY!] + axisYOffset,
  ];
}

export default async function CreateUvMapsTransform({ document, transformer }: CommandParams, { swapYZ = false, textureSizeInMeters = 2.000, voxelOffsetSize = 0.125 } = {}) {
  // Swaps Y and Z when necessary (for dealing with DU's Z+-up into glTFs Y+-up)
  const swapYZRads = 90 * Math.PI / 180;
  if (swapYZ) {
    for (const mesh of document.getRoot().listMeshes()) {
      transformer.notify(EventType.DEBUG, `Adjusting rotation for mesh "${mesh.getName()}"...`);

      transformMesh(mesh, fromXRotation([], swapYZRads));
      document.getRoot().listNodes().find(
        node => node.getMesh() == mesh
      )?.setRotation(ROTATION_NONE);
    }
  }

  // Add UV coordinates to the meshes
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      // Skip if we have a UV for this primitive
      if (primitive.getAttribute('TEXCOORD_0')) {
        return;
      }

      transformer.notify(EventType.DEBUG, `Preparing UVs for mesh "${mesh.getName()}", primitive "${primitive.getName()}"...`);

      // Gets list of vertices
      const primitiveVertexIndex = primitive.getIndices()!;
      const primitiveVertexPosition = primitive.getAttribute('POSITION')!;
      const primitiveVertexNormal = primitive.getAttribute('NORMAL')!;

      // And let's create our UV map and set it to our primitive
      const primitiveVertexUV = document.createAccessor()
        .setType(Accessor.Type.VEC2)
        .setArray(new Float32Array(2 * primitiveVertexPosition.getCount()));
      primitive.setAttribute('TEXCOORD_0', primitiveVertexUV);

      // Finally, let's build our UV map, triangle by triangle
      for (let idx = 0; idx < primitiveVertexIndex.getCount(); idx += 3) {
        // Load the vertex indices and positions
        const vertexIds = [
          primitiveVertexIndex.getScalar(idx + 0),
          primitiveVertexIndex.getScalar(idx + 1),
          primitiveVertexIndex.getScalar(idx + 2),
        ];
        const vertexPositions = vertexIds.map(id => primitiveVertexPosition.getElement(id, [])) as TriangleVertices;
        const vertexNormals = vertexIds.map(id => primitiveVertexNormal.getElement(id, [])) as TriangleVertices;
        
        // Calculates and sets UV coordinates for each vertex
        for (let i = 0; i < 3; i++) {
          // Corrects the 1vx difference in core sizes, so that everything is aligned to the right voxel grid
          vertexPositions[i][0] -= voxelOffsetSize;
          vertexPositions[i][1] += voxelOffsetSize;
          vertexPositions[i][2] -= voxelOffsetSize;

          // Gets the XY coordinates from this vertex on a plane that matches its face direction
          const uv = getPlaneCoordinatesFrom3dPoint(vertexPositions[i], getFaceDirection(vertexNormals[i]), swapYZ, voxelOffsetSize)
            .map(xy => xy / textureSizeInMeters);

          // For UV space, we need to flip the Y coordinate, as higher numbers mean lower in the texture
          uv[1] = -uv[1];

          // Update the UV for that vertex
          primitiveVertexUV.setElement(vertexIds[i], uv);
        }
      }
    }
  }
}