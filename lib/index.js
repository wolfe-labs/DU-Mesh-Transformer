import path, { basename, resolve } from 'path';
import { promises as fs, existsSync as fileExists } from 'fs';

import { Accessor, Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { transformMesh, weldPrimitive } from '@gltf-transform/functions';

import DdsConverter from './DdsConverter.js';
import RgbaBuffer from './RgbaBuffer.js';
import { Vector } from 'vector-math';
import { fromXRotation, fromTranslation } from 'gl-matrix/cjs/mat4.js';

function findCommonWords(a, b) {
  a = a.split('');
  b = b.split('');

  a[0] = a[0].toUpperCase();
  b[0] = b[0].toUpperCase();

  a = a.join('');
  b = b.join('');

  const wordsA = Array.from(a.matchAll(/([A-Z_]+[a-z0-9]+)/g)).map(match => match[0]);
  const wordsB = Array.from(b.matchAll(/([A-Z_]+[a-z0-9]+)/g)).map(match => match[0]);

  const wordsASet = new Set(wordsA);
  const wordsBSet = new Set(wordsB);
  const commonWordsSet = new Set();
  wordsASet.forEach(word => wordsBSet.has(word) && commonWordsSet.add(word));
  wordsBSet.forEach(word => wordsASet.has(word) && commonWordsSet.add(word));

  const result = [];
  for (let indexA = 0, indexB = 0; indexA < Math.max(wordsA.length, wordsB.length); indexA++, indexB++) {
    if (!commonWordsSet.has(wordsA[indexA]) && !commonWordsSet.has(wordsB[indexB])) {
      indexA++;
    } else if (!commonWordsSet.has(wordsA[indexA])) {
      indexA++;
    } else if (!commonWordsSet.has(wordsB[indexA])) {
      indexB++;
    }

    if (!wordsA[indexA] || !wordsB[indexB]) {
      break;
    }

    if (wordsA[indexA] != wordsB[indexB]) {
      if (wordsA[indexA + 1] == wordsB[indexB]) {
        indexA++;
      } else if (wordsA[indexA] == wordsB[indexB + 1]) {
        indexB++;
      } else {
        continue;
      }
    }

    result.push(wordsA[indexA]);
  }

  return result;
}

function readEnum(value, options, defaultOption) {
  return options.includes(value || null)
    ? value
    : options[defaultOption || 0];
}

export async function convert({ sourceFile, destinationFile, gameDirectory, itemDefinitions, textureMode, objectName, convertTextures, splitMeshes = true, swapYZ = true }) {
  // Set default object name to the filename if not passed
  objectName = objectName || path.basename(sourceFile, path.extname(sourceFile));

  // Parse texturing options
  textureMode = readEnum(textureMode, ['flat', 'color-only', 'textured']);
  const texturesEnabled = ['flat', 'textured'].includes(textureMode);
  const texturesShouldBeFlat = (textureMode == 'flat');

  const resolveMaterial = ('function' == typeof itemDefinitions)
    ? itemDefinitions
    : (id) => itemDefinitions[id];

  // This is our reader
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS);

  // This is the game's data directory
  const gameDataDirectory = path.join(gameDirectory, 'Game', 'data');

  // Reads the source glTF
  const document = await io.read(sourceFile);
  const documentBuffer = document.getRoot().listBuffers()[0] || document.createBuffer();

  // Those are the textures we'll be using, we want to map them here to avoid issues
  const gameTextures = {};
  const gameTextureFiles = {};

  // Loads individual textures
  async function loadTexture(textureFile, materialId, textureType) {
    let textureFileExtension = path.extname(textureFile);

    let textureId = `${materialId}_${textureType}`;
    const makeTextureUri = () => `textures/${textureId}${textureFileExtension}`;

    // Check the cache per filename
    const existingTextureByFile = gameTextureFiles[textureFile];
    if (existingTextureByFile) {
      textureId = `${findCommonWords(existingTextureByFile.getName(), materialId).join('')}_${textureType}`;
      textureFileExtension = path.extname(existingTextureByFile.getURI());
      return existingTextureByFile
        .setName(textureId)
        .setURI(makeTextureUri());
    }

    // Ensure the file exists
    if (!fileExists(textureFile)) {
      throw new Error(`Tried to load texture file into glTF, but it was not found: ${textureFile}`);
    }

    // Loads our texture
    let textureBytes = await fs.readFile(textureFile);

    // For MRAO we want to reorder the channels from Metallic-Roughness-AO to AO-Roughness-Metallic
    if ((convertTextures && textureType != 'normal') || textureType == 'mrao') {
      let textureRGBA;
      if (textureFileExtension == '.dds') {
        textureRGBA = DdsConverter.convertToRgba(textureBytes);
      } else {
        textureRGBA = await RgbaBuffer.fromFileBuffer(textureBytes);
      }

      // Swaps the channels for MRAO
      if (textureType == 'mrao') {
        textureRGBA.transform(channels => [channels[2], channels[1], channels[0], channels[3]]);
      }

      // Stores the resulting bytes
      textureFileExtension = '.png';
      textureBytes = await textureRGBA.toConvertedBuffer('image/png');
    }

    // Let's load the textures from the file
    const newTexture = document.createTexture(textureId)
      .setName(textureId)
      .setImage(textureBytes);

    // Updates texture name
    newTexture.setURI(makeTextureUri());
    gameTextureFiles[textureFile] = newTexture;

    // For flat textures, we'll do extra processing here to extract the colors, we'll replace them when saving the file
    if (['color', 'mrao', 'emissive'].includes(textureType) && texturesShouldBeFlat) {
      let textureRGBA;
      if (textureFileExtension == '.dds') {
        textureRGBA = DdsConverter.convertToRgba(textureBytes);
      } else {
        textureRGBA = await RgbaBuffer.fromFileBuffer(textureBytes);
      }

      // Resizes our texture to 1x1 so we have an average "flat" color
      let flatImage = await textureRGBA.toJimpImage();
      flatImage = await flatImage.resize(1, 1);

      // We'll finish by converting the values from 0-255 to 0.0-1.0 range, so we can use it as a factor
      const flatRGBFactor = [...flatImage.bitmap.data.subarray(0, 3)]
        .map(value0255 => value0255 / 255);

      // Saves the new "flat" values into the texture metadata
      newTexture.setExtras({
        flatColorFactor: flatRGBFactor,
      });
    }

    // Done!
    return newTexture;
  }

  // Gets a list of textures for a material
  async function getGameTextureForItemId(itemId) {
    const material = resolveMaterial(itemId);

    // Default to empty texture set if the material is not found
    if (!material) {
      return {};
    }

    // If we don't have the textures cached, we'll need to create and cache them first
    const materialId = material.materialId;
    if (!gameTextures[materialId]) {
      const textureData = {};
      for (const textureType in material.files) {
        const textureFile = path.join(gameDataDirectory, material.files[textureType]);
        textureData[textureType] = await loadTexture(textureFile, materialId, textureType);
      }

      // Saves the data on cache
      gameTextures[materialId] = textureData;
    }

    // Returns final cached texture
    return gameTextures[materialId];
  }

  // Remove light/camera that's exported along with model
  document.getRoot().listNodes().forEach(
    node => ['Camera', 'Light'].includes(node.getName()) && node.dispose()
  );

  // Processes the materials
  for (const material of document.getRoot().listMaterials()) {
    const itemId = material.getName();

    // Gets the game data for this material
    const materialData = resolveMaterial(itemId);
    if (materialData) {
      console.log(`Processing material '${itemId}': ${materialData.title}`);

      // Let's get the base color for this material, as it may have useful information
      const [baseR, baseG, baseB, baseA] = material.getBaseColorFactor();

      // Updates base color, we'll also set alpha (if provided by the game), otherwise just use the value built into the glTF
      const materialBaseColor = [ ...(materialData.albedo || [1, 1, 1]) ];
      materialBaseColor[3] = materialBaseColor[3] || material.getBaseColorFactor()[3];
      material.setBaseColorFactor(materialBaseColor);

      // Texture processing
      let textures = {};
      if (texturesEnabled) {
        console.log('Loading material textures...');

        // Loads the textures we'll be using
        textures = await getGameTextureForItemId(itemId);

        // Applies textures as needed
        material.setBaseColorTexture(textures.color);
        material.setNormalTexture(textures.normal);
        material.setMetallicRoughnessTexture(textures.mrao);
        material.setOcclusionTexture(textures.mrao);
        material.setEmissiveTexture(textures.emissive);
      }

      if (materialData.category == 'emissive') {
        // Luminescent materials
        material.setEmissiveFactor(materialData.albedo || [1, 1, 1]);
        material.setMetallicFactor(0.000);
        material.setRoughnessFactor(1.000);
      } else {
        // Standard materials
        if (false && texturesEnabled && textures.mrao) {
          // When a MRAO texture is present, let's set factors to 1.000 so we only use the texture data
          // The glTF seems to have built-in factors, but they don't seem to be very reliable
          material.setMetallicFactor(1.000);
          material.setRoughnessFactor(1.000);
        }
      }

      // Checks if material is emissive
      const materialHasEmissive = (texturesEnabled && textures.emissive) || materialData.category === 'emissive';

      // Enables HDR for emissives
      if (materialHasEmissive) {
        material.setExtension(
          'KHR_materials_emissive_strength',
          document.createExtension(KHRMaterialsEmissiveStrength)
            .createEmissiveStrength()
            .setEmissiveStrength(5.0)
        );
      }
      
      // To make things easier, let's rename the material
      material.setName(materialData.title || materialData.materialId || itemId);
    }
  }

  // Applies texture flattening as needed
  if (texturesShouldBeFlat) {
    document.getRoot().listMaterials().forEach(
      material => {
        const textureColor = material.getBaseColorTexture();
        const textureMetallicRoughness = material.getMetallicRoughnessTexture();
        const textureAmbientOcclusion = material.getOcclusionTexture();
        const textureEmissive = material.getEmissiveTexture();

        // Helpers to get the flat color and its components
        function getFlatColor(texture) {
          return textureColor.getExtras()['flatColorFactor'];
        }
        function getFlatColorComponent(texture, component, defaultValue) {
          return getFlatColor(texture)[component] || defaultValue;
        }

        // Base Color
        if (textureColor && getFlatColor(textureColor)) {
          material.setBaseColorTexture(null);
          material.setBaseColorFactor(
            material.getBaseColorFactor().map((value, component) => value * getFlatColorComponent(textureColor, component, 1))
          );
        }

        // Metallic / Roughness
        if (textureMetallicRoughness && getFlatColor(textureMetallicRoughness)) {
          material.setMetallicRoughnessTexture(null);
          material.setMetallicFactor(material.getMetallicFactor() * getFlatColorComponent(textureMetallicRoughness, 2, 1));
          material.setRoughnessFactor(material.getRoughnessFactor() * getFlatColorComponent(textureMetallicRoughness, 1, 1));
        }

        // Emissive
        if (textureEmissive && getFlatColor(textureEmissive)) {
          material.setEmissiveTexture(null);
          material.setEmissiveFactor(
            material.getEmissiveFactor().map((value, component) => value * getFlatColorComponent(textureEmissive, component, 1))
          );
        }
      }
    );
  }

  /***************************************************************************
   * START: WIP, MIGHT BE REMOVED OR REFACTORED!
   ***************************************************************************/

  // Ensure we only have one Mesh for certain operations
  const onlyHasOneMesh = (document.getRoot().listMeshes().length == 1);

  // When only one Mesh is present, let's fix its centering and do some extra processing
  if (splitMeshes && onlyHasOneMesh) {
    const defaultMesh = document.getRoot().listMeshes()[0];
    const defaultMeshNode = document.getRoot().listNodes().find(node => node.getMesh() == defaultMesh);

    // Fixes the centering so that it happens in the Mesh Primitives themselves, not in the Nodes
    // The main reason for this is so that the origin is correct and rotation doesn't break in apps like Blender
    if (defaultMeshNode) {
      const baseTranslation = defaultMeshNode.getTranslation();
      baseTranslation[2] = -baseTranslation[2];
      transformMesh(defaultMesh, fromTranslation([], baseTranslation));
      defaultMeshNode.setTranslation([0, 0, 0]);
    }

    // Let's get the "default" material that would be assigned to any exported Elements
    const defaultMaterial = document.getRoot().listMaterials()[0];

    // With that in hand, let's try to find any relation to the elements themselves
    if (defaultMaterial) {
      // Let's create a map between Materials and Meshes
      const meshesPerMaterial = {};
      const nodesPerMaterial = {};
      const nodesForIslands = [];
      defaultMesh.setName(defaultMaterial.getName());
      defaultMeshNode.setName(defaultMesh.getName());
      meshesPerMaterial[defaultMaterial.getName()] = defaultMesh;
      nodesPerMaterial[defaultMaterial.getName()] = defaultMeshNode;

      // Let's assign one Mesh per Material
      defaultMesh.listPrimitives().forEach(
        (primitive, idx) => {
          const primitiveMaterial = primitive.getMaterial();
          const primitiveMaterialName = primitiveMaterial.getName();
          if (primitiveMaterial.getName() != defaultMesh.getName()) {
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
              document.getRoot().getDefaultScene().addChild(meshNode);
            }

            // Assigns our primitive to the new mesh, removes from default mesh
            meshesPerMaterial[primitiveMaterialName].addPrimitive(primitive);
            defaultMesh.removePrimitive(primitive);
          } else {
            // When handling the default mesh, we'll want to separate elements from build materials
            // One idea here is to loop through the indices (which should be the triangles of vertices) and find "islands" of isolated vertices
            const primitiveIndices = primitive.getIndices();

            // Let's also load the raw vertex positions
            const primitiveVertexPositions = primitive.getAttribute('POSITION');

            // Helper function to get a hash of the vertex position
            function getVertexPositionHash(vertexId) {
              return primitiveVertexPositions.getElement(vertexId, [])
                .map(component => component.toFixed(3))
                .join('|');
            }

            // Let's first get a list of all triangles and any vertices they share
            // Let's also build a list of all vertices and the triangles they share
            const trianglesPerVertex = {};
            const verticesPerTriangle = {};
            const verticesPerPosition = {};
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
              console.log('Processing island:', triangleIslands.length);

              // Create a new "island"
              const islandTriangleIds = new Set();

              // Those are our triangles to process next
              const nextTriangles = new Set([triangleIdsToProcess.values().next().value]);

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
              console.log('Island', islandTriangleIds.size, triangleIdsToProcess.size);
              triangleIslands.push(islandTriangleIds);
            }

            // Let's rebuild the geometry as individual meshes for each "island"
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

                  originalVertexPositions.forEach((position, i) => {
                    const index = triangleSize * idx + i;
                    newPrimitiveVertexPositions.setElement(index, position);
                    newPrimitiveIndices.setScalar(index, index);
                  });

                  originalVertexPositions.forEach((position, i) => {
                    const index = triangleSize * idx + i;
                    newPrimitiveVertexPositions.setElement(index, position);
                    newPrimitiveIndices.setScalar(index, index);
                  });
                });

                // Registers our new nodes
                const newName = `${defaultMaterial.getName()} (Island ${islandId})`;
                const newPrimitive = document.createPrimitive()
                  .setName(newName)
                  .setAttribute('POSITION', newPrimitiveVertexPositions)
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
                document.getRoot().getDefaultScene().addChild(newNode);
              }
            );

            // Clean-up, leaving only the final islands behind
            primitive.dispose();
          }
        }
      );

      // Renames our mesh nodes to keep them organized
      for (const node of [...Object.values(nodesPerMaterial), ...nodesForIslands]) {
        const name = `${objectName}: ${node.getName()}`;
        node.setName(name);
      }
    }
  }

  // Clean-up empty meshes
  document.getRoot().listMeshes()
    .filter(mesh => mesh.listPrimitives().length == 0)
    .forEach(mesh => {
      document.getRoot().listNodes()
        .forEach(node => (node.getMesh() == mesh) && node.dispose());
      mesh.dispose();
    });

  /***************************************************************************
   * END: WIP, MIGHT BE REMOVED OR REFACTORED!
   ***************************************************************************/

  // Swaps Y and Z when necessary (for dealing with DU's Z+-up into glTFs Y+-up)
  const ROTATION_NONE = [1, 0, 0, 0];
  const swapYZRads = 90 * Math.PI / 180;
  if (swapYZ) {
    document.getRoot().listMeshes().forEach(mesh => {
      transformMesh(mesh, fromXRotation([], swapYZRads));
      document.getRoot().listNodes().find(node => node.getMesh() == mesh).setRotation(ROTATION_NONE);
    });
  }

  // Add UV coordinates to the meshes
  if (texturesEnabled) {
    const textureSizeInMeters = 2.000;
    const voxelOffsetSize = 0.125;
    const directions = {
      right: new Vector(1, 0, 0),
      left: new Vector(-1, 0, 0),
      top: new Vector(0, 1, 0),
      bottom: new Vector(0, -1, 0),
      front: new Vector(0, 0, -1),
      back: new Vector(0, 0, 1),
    };

    function vectorToArray(vector) {
      return [vector.i, vector.j, vector.k];
    }

    function getFaceDirection(normal) {
      let closestDirection = [0, 0, 0], closestSimilarity = -Infinity;
      let similarity;
      for (const direction of Object.values(directions)) {
        similarity = new Vector(...normal).Dot(direction);
        if (similarity > closestSimilarity) {
          closestDirection = direction;
          closestSimilarity = similarity;
        }
      }

      return vectorToArray(closestDirection);
    }

    function calculateTriangleNormal(vertexPositions) {
      const vectors = {
        a: new Vector(...vertexPositions[0]),
        b: new Vector(...vertexPositions[2]),
        c: new Vector(...vertexPositions[1]),
      };

      const result = vectors.b.Subtract(vectors.a)
        .Cross(vectors.b.Subtract(vectors.c));

      return result.unitVector ? vectorToArray(result.unitVector) : [0, 0, 0];
    }

    function getPlaneCoordinatesFrom3dPoint(point3d, direction) {
      // Those are our mapping of axis to xyz indexes
      const axis = { x: 0, y: 1, z: 2 };

      // Gets the current face axis
      const [depthAxis, sign] = direction.map(
        (xyz, idx) => (xyz !== 0) && [idx, (xyz < 0) ? -1 : 1]
      ).find(idx => idx !== false);

      // When we do the YZ swap, we need to flip all axis again
      const axisXYSign = swapYZ ? -1 : 1;

      // Calculate which of the xyz indexes to use for X and Y coordinates
      // We also need to flip the coordinates in some cases
      let axisX, axisY, axisXSign = 1, axisYSign = 1;
      switch (depthAxis) {
        // Lateral view
        case axis.x:
          axisX = 2;
          axisY = 1;
          axisXSign = -1;
          break;

        // Vertical view
        case axis.y:
          axisX = 0;
          axisY = 2;
          axisYSign = -1;
          break;

        // Longitudinal view
        case axis.z:
          axisX = 0;
          axisY = 1;
          break;
      }

      // Builds the final X and Y coordinates from our 3D point
      return [
        axisXYSign * axisXSign * sign * point3d[axisX],
        axisXYSign * axisYSign * point3d[axisY],
      ];
    }

    document.getRoot().listMeshes().forEach(mesh => {
      mesh.listPrimitives().forEach(primitive => {
        // Skip if we have a UV for this primitive
        if (primitive.getAttribute('TEXCOORD_0')) {
          return;
        }

        console.log(`Adding UV coordintes: ${mesh.getName()}.${primitive.getName()}`);

        // Gets list of vertices
        const primitiveVertexIndex = primitive.getIndices();
        const primitiveVertexPosition = primitive.getAttribute('POSITION');

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
          const vertexPositions = vertexIds.map(id => primitiveVertexPosition.getElement(id, []));

          // Calculate our triangle's normal
          const normal = calculateTriangleNormal(vertexPositions);
          const normalDirection = getFaceDirection(normal);
          
          // Calculates and sets UV coordinates for each vertex
          for (let i = 0; i < 3; i++) {
            // Corrects the 1vx difference in core sizes, so that everything is aligned to the right voxel grid
            vertexPositions[i][0] -= voxelOffsetSize;
            vertexPositions[i][1] += voxelOffsetSize;
            vertexPositions[i][2] -= voxelOffsetSize;

            // Gets the XY coordinates from this vertex on a plane that matches its face direction
            const uv = getPlaneCoordinatesFrom3dPoint(vertexPositions[i], normalDirection)
              .map(xy => xy / textureSizeInMeters);

            // For UV space, we need to flip the Y coordinate, as higher numbers mean lower in the texture
            uv[1] = -uv[1];

            // Update the UV for that vertex
            primitiveVertexUV.setElement(vertexIds[i], uv);
          }
        }
      });
    });
  }

  // Clean-up unused nodes
  [
    ...document.getRoot().listNodes(),
    ...document.getRoot().listMaterials(),
    ...document.getRoot().listTextures(),
    ...document.getRoot().listMeshes(),
    ...document.getRoot().listScenes(),
    ...document.getRoot().listSkins(),
    ...document.getRoot().listAccessors(),
  ].forEach(graphNode => {
    if (graphNode.listParents().length == 0 || (graphNode.listParents().length == 1 && graphNode.listParents[0] == document.getRoot())) {
      graphNode.dispose();
    }
  });
  

  // For .gltf files, the exporter generates a bunch of image files, let's group them into a directory instead
  if (path.extname(destinationFile) == '.gltf') {
    await fs.mkdir(destinationFile);
    destinationFile = path.join(destinationFile, path.basename(destinationFile));
  }

  // Saves the finished glTF
  await io.write(destinationFile, document);
}