import path, { resolve } from 'path';
import { promises as fs, existsSync as fileExists } from 'fs';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

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

        // Ensure the file exists
        if (!fileExists(textureFile)) {
          throw new Error(`Tried to load texture file into glTF, but it was not found: ${textureFile}`);
        }

        // TODO: Special processing steps for MRAO (Metal - Roughness - Ambient Occlusion)
        if (textureType == 'mrao') {
          // continue;
        }

        // Let's load the textures from the file
        textureData[textureType] = document.createTexture(`${materialId}_${textureType}`)
          .setImage(await fs.readFile(textureFile));
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
      
      // To make things easier, let's rename the material
      material.setName(materialData.title || materialData.materialId || itemId);
    }
  }

  // Saves the finished glTF
  await io.write(destinationFile, document);
}