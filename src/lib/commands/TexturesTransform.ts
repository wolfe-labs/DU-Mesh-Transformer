import path from 'path';
import { existsSync as fileExists, promises as fs } from 'fs';

import { Texture, vec4 } from '@gltf-transform/core';
import {
  ProcessingQueueCommandParameters as CommandParams,
  EventType as EventType,
  MaterialDefinition,
  MaterialTextureTypes
} from '../types';

import DuMeshTransformer from '../DuMeshTransformer';
import { findCommonWords } from '../CommonWords';
import RgbaBuffer from '../RgbaBuffer';
import DdsConverter from '../DdsConverter';

// Loads individual textures
async function loadTexture(transformer: DuMeshTransformer, textureFile: string, materialId: string, textureType: string) {
  let textureFileExtension = path.extname(textureFile);

  let textureId = `${materialId}_${textureType}`;
  const makeTextureUri = () => `textures/${textureId}${textureFileExtension}`;

  // Check the cache per filename
  const existingTextureByFile = await transformer.rememberMany<Texture>('texture_files', textureFile);
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
  if ((true && textureType != MaterialTextureTypes.NORMAL_MAP) || textureType == MaterialTextureTypes.METALLIC_ROUGHNESS_AMBIENT_OCCLUSION) {
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
  const newTexture = transformer.getDocument().createTexture(textureId)
    .setName(textureId)
    .setImage(textureBytes);

  // Updates texture name
  newTexture.setURI(makeTextureUri());

  // Saves texture data for later
  transformer.setRememberMany('texture_files', textureFile, newTexture);

  // Done!
  return newTexture;
}

// Gets a list of textures for a material
async function getGameTextures(transformer: DuMeshTransformer, gameMaterial: MaterialDefinition) {
  return await transformer.rememberMany('textures', gameMaterial.materialId, async () => {
    const dataDir = transformer.getDataDirectory();
    
    // Ensure we have a valid game directory
    if (!dataDir) {
      throw new Error(`Can't apply textures when game directory is missing!`);
    }
      
    const textureData: Record<string, Texture> = {};
    for (const textureType in gameMaterial.files) {
      const textureFile = path.join(dataDir, gameMaterial.files[textureType]);
      textureData[textureType] = await loadTexture(transformer, textureFile, gameMaterial.materialId, textureType);
    }
    return textureData;
  });
}

export default async function TexturesTransform({ document, transformer }: CommandParams) {
  for (const { material, gameMaterial } of transformer.getGltfMaterialsWithGameMaterials()) {
    transformer.notify(EventType.DEBUG, `Processing textures for "${material.getName()}"...`);
    
    // Loads the textures we'll be using
    const textures = await getGameTextures(transformer, gameMaterial);

    // Applies textures as needed
    material.setBaseColorTexture(textures.color);
    material.setNormalTexture(textures.normal);
    material.setMetallicRoughnessTexture(textures.mrao);
    material.setOcclusionTexture(textures.mrao);
    material.setEmissiveTexture(textures.emissive);
  }
}