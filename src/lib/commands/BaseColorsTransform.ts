import { vec4 } from '@gltf-transform/core';
import {
  ProcessingQueueCommandParameters as CommandParams,
  EventType as EventType
} from '../types';

export default async function BaseColorsTransform({ transformer }: CommandParams) {
  for (const { material, gameMaterial } of transformer.getGltfMaterialsWithGameMaterials()) {
    transformer.notify(EventType.DEBUG, `Applying base color for "${material.getName()}"...`);
    
    // Updates base color, we'll also set alpha (if provided by the game), otherwise just use the value built into the glTF
    const materialBaseColor: vec4 = [
      ...(gameMaterial.albedo || [1, 1, 1]),
      material.getBaseColorFactor()[3] || 1.000,
    ];
    material.setBaseColorFactor(materialBaseColor);
  }
}