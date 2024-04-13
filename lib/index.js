import path, { basename, resolve } from 'path';
import { promises as fs, existsSync as fileExists } from 'fs';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength, KHRMaterialsSpecular } from '@gltf-transform/extensions';

import DdsConverter from './DdsConverter.js';
import RgbaBuffer from './RgbaBuffer.js';

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

export async function convert({ sourceFile, destinationFile, gameDirectory, itemDefinitions, textureMode }) {
  // Parse texturing options
  textureMode = readEnum(textureMode, ['color-only', 'textured']);
  const texturesEnabled = (textureMode == 'textured');

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

    // TODO: Special processing steps for MRAO (Metal - Roughness - Ambient Occlusion)
    if (textureType == 'mrao') {
      // return;
    }

    // Loads our texture
    let textureBytes = await fs.readFile(textureFile);
    // For MRAO we want to reorder the channels from Metallic-Roughness-AO to AO-Roughness-Metallic
    if (textureType == 'mrao') {
      let textureRGBA;
      if (textureFileExtension == '.dds') {
        textureRGBA = DdsConverter.convertToRgba(textureBytes);
      } else {
        textureRGBA = RgbaBuffer.fromFileBuffer(textureBytes);
      }

      // Swaps the channels
      textureRGBA.transform(channels => [channels[2], channels[1], channels[0], channels[3]]);

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
      // Let's get the base color for this material, as it may have useful information
      const [baseR, baseG, baseB, baseA] = material.getBaseColorFactor();

      // Updates base color, we'll also set alpha (if provided by the game), otherwise just use the value built into the glTF
      const materialBaseColor = [ ...(materialData.albedo || [1, 1, 1]) ];
      materialBaseColor[3] = materialBaseColor[3] || material.getBaseColorFactor()[3];
      material.setBaseColorFactor(materialBaseColor);

      // Texture processing
      let textures = {};
      if (texturesEnabled) {
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
        if (texturesEnabled && textures.mrao) {
          // When a MRAO texture is present, let's set factors to 1.000 so we only use the texture data
          // The glTF seems to have built-in factors, but they don't seem to be very reliable
          material.setMetallicFactor(1.000);
          material.setRoughnessFactor(1.000);
        }
      }

      // Checks if material is emissive
      const materialHasEmissive = (texturesEnabled && textures.emissive) || material.category === 'emissive';

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

  // For .gltf files, the exporter generates a bunch of image files, let's group them into a directory instead
  if (path.extname(destinationFile) == '.gltf') {
    await fs.mkdir(destinationFile);
    destinationFile = path.join(destinationFile, path.basename(destinationFile));
  }

  // Saves the finished glTF
  await io.write(destinationFile, document);
}