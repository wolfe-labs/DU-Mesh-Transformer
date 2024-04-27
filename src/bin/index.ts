import app from '../lib/ApplicationWrapper.js';
import DuMeshTransformer from '../lib/DuMeshTransformer.js';
import { EventType } from '../lib/types';

app(async function main(modelPath, customGameDirectory) {
  // Loads our mesh
  const meshTransformer = await DuMeshTransformer.fromFile(modelPath);

  // Optionally set our game directory
  if (customGameDirectory && customGameDirectory.length > 0) {
    meshTransformer.setGameInstallationDirectory(customGameDirectory);
  }

  // Print events
  meshTransformer.events().on(EventType.DEBUG, message => console.log('[DEBUG]', message));

  // Processes our mesh as desired
  await meshTransformer
    .withBaseColors()
    .saveToFile(`${modelPath}.out.glb`, false);
});