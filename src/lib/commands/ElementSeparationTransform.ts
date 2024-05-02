import { Accessor, Mesh, Node, vec4 } from '@gltf-transform/core';
import { transformMesh } from '@gltf-transform/functions';

// @ts-ignore
import { fromTranslation } from 'gl-matrix/mat4';

import {
  ProcessingQueueCommandParameters as CommandParams,
  EventType as EventType
} from '../types';
import { vec2 } from 'gl-matrix';

export default async function ElementSeparationTransform({ document, transformer }: CommandParams) {
  // Ensure we only have one Mesh for certain operations
  if (document.getRoot().listMeshes().length != 1) {
    transformer.notify(EventType.WARNING, `You must have exactly one mesh in the file for element separation to work. Skipping...`);
    return;
  }

  // Extracts the default mesh and its corresponding node
  // If the node is not present, we can create it, no issues
  const defaultMesh = document.getRoot().listMeshes()[0];
  const defaultMeshNode = document.getRoot().listNodes().find(
    (node) => node.getMesh() == defaultMesh
  ) || document.createNode().setMesh(defaultMesh);

  // Ensure we also have a default material
  if (document.getRoot().listMaterials().length == 0) {
    transformer.notify(EventType.WARNING, `You must have at least one material for separation to work. Skipping...`);
    return;
  }

  // Let's get the "default" material that would be assigned to any exported Elements
  const defaultMaterial = document.getRoot().listMaterials()[0];

  // Let's have a "default scene", too
  const defaultScene = document.getRoot().getDefaultScene() || document.createScene();

  // Loads the buffer we'll be working on
  const documentBuffer = document.getRoot().listBuffers()[0] || document.createBuffer();

  // Fixes the centering so that it happens in the Mesh Primitives themselves, not in the Nodes
  // The main reason for this is so that the origin is correct and rotation doesn't break in apps like Blender
  const baseTranslation = defaultMeshNode.getTranslation();
  baseTranslation[2] = -baseTranslation[2];
  transformMesh(defaultMesh, fromTranslation([], baseTranslation));
  defaultMeshNode.setTranslation([0, 0, 0]);

  // Let's create a map between Materials and Meshes
  const meshesPerMaterial: Record<string, Mesh> = {};
  const nodesPerMaterial: Record<string, Node> = {};
  const nodesForIslands: Node[] = [];
  defaultMesh.setName(defaultMaterial.getName());
  defaultMeshNode.setName(defaultMesh.getName());
  meshesPerMaterial[defaultMaterial.getName()] = defaultMesh;
  nodesPerMaterial[defaultMaterial.getName()] = defaultMeshNode;

  // Let's assign one Mesh per Material
  transformer.notify(EventType.DEBUG, `Starting mesh separation process for "${defaultMesh.getName()}"...`);
  for (const primitive of defaultMesh.listPrimitives()) {
    const primitiveMaterial = primitive.getMaterial();
    if (primitiveMaterial && primitiveMaterial.getName() != defaultMesh.getName()) {
      // Let's cache the default name
      const primitiveMaterialName = primitiveMaterial.getName();

      // Create a new Mesh as needed
      if (!meshesPerMaterial[primitiveMaterialName]) {
        // const mesh = defaultMaterialMesh.clone();
        const mesh = document.createMesh(primitiveMaterialName);
        const meshNode = document.createNode(primitiveMaterialName)
          .setMesh(mesh)
          .setTranslation(defaultMeshNode.getTranslation())
          .setRotation(defaultMeshNode.getRotation());
        meshesPerMaterial[primitiveMaterialName] = mesh;
        nodesPerMaterial[primitiveMaterialName] = meshNode;
        defaultScene.addChild(meshNode);
      }

      // Assigns our primitive to the new mesh, removes from default mesh
      meshesPerMaterial[primitiveMaterialName].addPrimitive(primitive);
      defaultMesh.removePrimitive(primitive);
    } else {
      // When handling the default mesh, we'll want to separate elements from build materials
      // One idea here is to loop through the indices (which should be the triangles of vertices) and find "islands" of isolated vertices
      const primitiveIndices = primitive.getIndices()!;

      // Let's also load the raw vertex positions
      const primitiveVertexPositions = primitive.getAttribute('POSITION')!;

      // Let's load the UV data for those vertices
      const primitiveVertexUV = primitive.getAttribute('TEXCOORD_0')!;

      // Helper function to get a hash of the vertex position
      function getVertexPositionHash(vertexId: number): string {
        return primitiveVertexPositions.getElement(vertexId, [])
          .map(component => component.toFixed(3))
          .join('|');
      }

      // Let's first get a list of all triangles and any vertices they share
      // Let's also build a list of all vertices and the triangles they share
      const trianglesPerVertex: Record<number, Set<number>> = {};
      const verticesPerTriangle: Record<number, Set<number>> = {};
      const verticesPerPosition: Record<string, Set<number>> = {};
      const triangleSize = 3;
      const triangleCount = primitiveIndices.getCount() / triangleSize;
      let vertexId = null;
      for (let i = 0; i < triangleCount; i++) {
        for (let o = 0; o < triangleSize; o++) {
          vertexId = primitiveIndices.getScalar(i * triangleSize + o);
          
          trianglesPerVertex[vertexId] = trianglesPerVertex[vertexId] || new Set();
          trianglesPerVertex[vertexId].add(i);
          
          verticesPerTriangle[i] = verticesPerTriangle[i] || new Set();
          verticesPerTriangle[i].add(vertexId);
        }
      }
      
      // Finally, let's build a list of vertices based on their vertex position
      Object.keys(trianglesPerVertex).map(id => parseInt(id))
        .forEach(vertexId => {
          const positionHash = getVertexPositionHash(vertexId);
          verticesPerPosition[positionHash] = verticesPerPosition[positionHash] || new Set();
          verticesPerPosition[positionHash].add(vertexId);
        });

      // Let's find the actual "islands"
      const triangleIslands = [];
      const triangleIdsToProcess = new Set(Object.keys(verticesPerTriangle).map(index => parseInt(index)));
      while (triangleIdsToProcess.size > 0) {
        // Create a new "island"
        const islandTriangleIds = new Set<number>();

        // Those are our triangles to process next
        const nextTriangles = new Set<number>([triangleIdsToProcess.values().next().value]);

        // This is our starting point
        let currentTriangleId = null;
        while (nextTriangles.size > 0) {
          // Gets the next triangle
          currentTriangleId = nextTriangles.values().next().value;

          // Saves triangle id as part of our "island"
          islandTriangleIds.add(currentTriangleId);

          // Removes triangle from next buffer and from pending list
          nextTriangles.delete(currentTriangleId);
          triangleIdsToProcess.delete(currentTriangleId);

          // Processes each of the vertices, queueing them for processing
          Array.from(verticesPerTriangle[currentTriangleId] || [])
            .forEach(
              triangleVertexId => (verticesPerPosition[getVertexPositionHash(triangleVertexId)] || [])
                .forEach(
                  vertexId => (trianglesPerVertex[vertexId] || [])
                    .forEach(
                      nextTriangleId => (!islandTriangleIds.has(nextTriangleId)) && nextTriangles.add(nextTriangleId)
                    )
                )
            );
        }

        // Isolates our "island" from everything else
        transformer.notify(EventType.DEBUG, `Finished grouping #${triangleIslands.length} with ${islandTriangleIds.size} triangles, ${triangleIdsToProcess.size} triangles remaining`);
        triangleIslands.push(islandTriangleIds);
      }

      // Let's rebuild the geometry as individual meshes for each "island"
      transformer.notify(EventType.DEBUG, `Building ${triangleIslands.length} primitives, meshes and nodes...`);
      triangleIslands.forEach(
        (triangleIds, islandId) => {
          // Builds our Primitive's Acessors
          const newTriangleCount = triangleIds.size;
          const newVertexCount = newTriangleCount * triangleSize;
          const newPrimitiveIndices = document.createAccessor()
            .setArray(new Uint16Array(newVertexCount))
            .setType(Accessor.Type.SCALAR)
            .setBuffer(documentBuffer);
          const newPrimitiveVertexPositions = document.createAccessor()
            .setArray(new Float32Array(newVertexCount * 3))
            .setType(Accessor.Type.VEC3)
            .setBuffer(documentBuffer);
          const newPrimitiveVertexUVs = document.createAccessor()
            .setArray(new Float32Array(newVertexCount * 2))
            .setType(Accessor.Type.VEC2)
            .setBuffer(documentBuffer);

          // Builds the Primitive's actual vertex/triangle data
          [...triangleIds].forEach((triangleId, idx) => {
            const originalIndices = [
              primitiveIndices.getScalar(triangleSize * triangleId + 0),
              primitiveIndices.getScalar(triangleSize * triangleId + 1),
              primitiveIndices.getScalar(triangleSize * triangleId + 2),
            ];
            const originalVertexPositions = [
              primitiveVertexPositions.getElement(originalIndices[0], []),
              primitiveVertexPositions.getElement(originalIndices[1], []),
              primitiveVertexPositions.getElement(originalIndices[2], []),
            ];
            const originalVertexUVs = [
              primitiveVertexUV.getElement(originalIndices[0], []),
              primitiveVertexUV.getElement(originalIndices[1], []),
              primitiveVertexUV.getElement(originalIndices[2], []),
            ];

            originalVertexPositions.forEach((position, i) => {
              const index = triangleSize * idx + i;
              newPrimitiveVertexPositions.setElement(index, position);
              newPrimitiveIndices.setScalar(index, index);
            });

            originalVertexUVs.forEach((uv, i) => {
              const index = triangleSize * idx + i;
              newPrimitiveVertexUVs.setElement(index, uv);
            });
          });

          // Registers our new nodes
          const newName = `${defaultMaterial.getName()} (Group ${islandId})`;
          const newPrimitive = document.createPrimitive()
            .setName(newName)
            .setAttribute('POSITION', newPrimitiveVertexPositions)
            .setAttribute('TEXCOORD_0', newPrimitiveVertexUVs)
            .setIndices(newPrimitiveIndices)
            .setMaterial(defaultMaterial);
          const newMesh = document.createMesh()
            .setName(newName)
            .addPrimitive(newPrimitive);
          const newNode = document.createNode()
            .setName(newName)
            .setMesh(newMesh)
            .setRotation(defaultMeshNode.getRotation());
          nodesForIslands.push(newNode);
          defaultScene.addChild(newNode);

          transformer.notify(EventType.DEBUG, `Created new primitive, mesh and node for "${newName}"`);
        }
      );

      // Clean-up, leaving only the final islands behind
      primitive.dispose();
    }
  }

  // Renames our mesh nodes to keep them organized
  for (const node of [...Object.values(nodesPerMaterial), ...nodesForIslands]) {
    const name = `${transformer.getName()}: ${node.getName()}`;
    node.setName(name);
  }

  // Clean-up empty meshes
  document.getRoot().listMeshes()
    .filter(mesh => mesh.listPrimitives().length == 0)
    .forEach(mesh => {
      document.getRoot().listNodes()
        .forEach(node => (node.getMesh() == mesh) && node.dispose());
      mesh.dispose();
    });
}