import path from 'path';

import app from '../lib/ApplicationWrapper.js';
import DuMeshTransformer from '../lib/DuMeshTransformer.js';
import { EventType } from '../lib/types';

app(async function main(modelPath, customGameDirectory) {
  const isDebugEnabled = !!JSON.parse(process.env.debug || 'false');

  // Loads our mesh
  const meshTransformer = await DuMeshTransformer.fromFile(modelPath);

  // Optionally set our game directory
  if (customGameDirectory && customGameDirectory.length > 0) {
    meshTransformer.setGameInstallationDirectory(customGameDirectory);
  }

  // Always print warnings
  meshTransformer.events().on(EventType.WARNING, message => console.warn('[WARNING]', message));

  // Only show debug stuff with debug env variable
  if (isDebugEnabled) {
    meshTransformer.events().on(EventType.TRANSFORM_START, () => console.log('[STATUS] Model processing started!\n'));
    meshTransformer.events().on(EventType.TRANSFORM_FINISH, () => console.log('[STATUS] Model processing finished!\n'));
    meshTransformer.events().on(EventType.TRANSFORM_NEXT, () => console.log(''));
    meshTransformer.events().on(EventType.DEBUG, message => console.log('[DEBUG]', message));
  }

  // Gets the file names
  const dir = path.dirname(modelPath);
  const basename = path.basename(modelPath, path.extname(modelPath));

  // Processes our mesh as desired
  await meshTransformer
    .withBaseColors()
    .withTextures()
    .withUvMaps()
    .withHdrEmissive()
    .withSeparatedElements()
    .saveToFile(path.join(dir, `${basename}.out`), false);
  console.log('Mesh saved successfully!');
});