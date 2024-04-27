import { vec3 } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';

import {
  ProcessingQueueCommandParameters as CommandParams,
  EventType as EventType
} from '../types';

export default async function HdrMaterialsTransform({ document, transformer }: CommandParams, { strength = 5.000 } = {}) {
  for (const { material, gameMaterial } of transformer.getGltfMaterialsWithGameMaterials()) {
    // Filters out any materials that aren't emissive
    if (gameMaterial.files.emissive || gameMaterial.category == 'emissive') {
      transformer.notify(EventType.DEBUG, `Adding HDR properties for "${material.getName()}"...`);

      // Check if our emissive material doesn't have any factor applied
      // In that case, we'll apply whatever the base color is as the emissive factor
      if (!material.getEmissiveFactor().find(value => value > 0.000)) {
        material.setEmissiveFactor(material.getBaseColorFactor().slice(0, 3) as vec3);
      }
      
      // Adds intensity to its emissive so it "shines" in HDR
      material.setExtension(
        'KHR_materials_emissive_strength',
        document.createExtension(KHRMaterialsEmissiveStrength)
          .createEmissiveStrength()
          .setEmissiveStrength(strength)
      );
    }
  }
}