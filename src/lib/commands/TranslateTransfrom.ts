import { vec3 } from '@gltf-transform/core';
import { transformMesh } from '@gltf-transform/functions';

// @ts-ignore
import { fromTranslation } from 'gl-matrix/mat4';

import {
  ProcessingQueueCommandParameters as CommandParams
} from '../types';

export default async function TranslateTransform({ document }: CommandParams, translation: vec3 = [0, 0, 0]) {
  // Let's translate all meshes at once
  for (const mesh of document.getRoot().listMeshes()) {
    transformMesh(mesh, fromTranslation([], translation));
  }
}