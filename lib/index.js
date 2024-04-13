import path, { basename, resolve } from 'path';
import { promises as fs, existsSync as fileExists } from 'fs';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength, KHRMaterialsSpecular } from '@gltf-transform/extensions';

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

export async function convert({ sourceFile, destinationFile, gameDirectory, itemDefinitions }) {
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

  // Those are the textures we'll be using, we want to map them here to avoid issues
  const gameTextures = {};
  const gameTextureFiles = {};

  // Loads individual textures
  async function loadTexture(textureFile, materialId, textureType) {
    const textureFileExtension = path.extname(textureFile);

    let textureId = `${materialId}_${textureType}`;
    const makeTextureUri = () => `textures/${textureId}${textureFileExtension}`;

    // Check the cache per filename
    const existingTextureByFile = gameTextureFiles[textureFile];
    if (existingTextureByFile) {
      textureId = findCommonWords(existingTextureByFile.getName(), textureId).join('');
      return existingTextureByFile
        .setName(textureId)
        .setURI(makeTextureUri());
    }

    // Ensure the file exists
    if (!fileExists(textureFile)) {
      throw new Error(`Tried to load texture file into glTF, but it was not found: ${textureFile}`);
    }

    // TODO: Special processing steps for MRAO (Metal - Roughness - Ambient Occlusion)
    if (textureType == 'mrao') {
      // return;
    }

    // Let's load the textures from the file
    const newTexture = document.createTexture(textureId)
      .setName(textureId)
      .setImage(await fs.readFile(textureFile))
      .setURI(makeTextureUri());
    gameTextureFiles[textureFile] = newTexture;
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

  // Processes the materials
  for (const material of document.getRoot().listMaterials()) {
    const itemId = material.getName();

    // Gets the game data for this material
    const materialData = resolveMaterial(itemId);
    if (materialData) {
      // Let's get the base color for this material, as it may have useful information
      const [baseR, baseG, baseB, baseA] = material.getBaseColorFactor();

      // Updates base color, we'll also set alpha (if provided by the game), otherwise just use the value built into the glTF
      const materialBaseColor = [ ...(materialData.albedo || [1, 1, 1]) ];
      materialBaseColor[3] = materialBaseColor[3] || material.getBaseColorFactor()[3];
      material.setBaseColorFactor(materialBaseColor);

      // Loads the textures we'll be using
      const textures = await getGameTextureForItemId(itemId);

      // Applies textures as needed
      material.setBaseColorTexture(textures.color);
      material.setNormalTexture(textures.normal);
      material.setMetallicRoughnessTexture(textures.mrao);
      material.setOcclusionTexture(textures.mrao);
      material.setEmissiveTexture(textures.emissive);

      if (materialData.category == 'emissive') {
        // Luminescent materials
        material.setEmissiveFactor(materialData.albedo || [1, 1, 1]);
        material.setMetallicFactor(0.000);
        material.setRoughnessFactor(1.000);
      } else {
        // Standard materials
        material.setMetallicFactor(baseG);
        material.setRoughnessFactor(baseB);

        // Removes specular
        material.setExtension('KHR_materials_specular', document.createExtension(KHRMaterialsSpecular).createSpecular()
          .setSpecularFactor(0.000)
        );
      }

      // Enables HDR for emissives
      if (textures.emissive) {
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

  // For .gltf files, the exporter generates a bunch of image files, let's group them into a directory instead
  if (path.extname(destinationFile) == '.gltf') {
    await fs.mkdir(destinationFile);
    destinationFile = path.join(destinationFile, path.basename(destinationFile));
  }

  // Saves the finished glTF
  await io.write(destinationFile, document);
}