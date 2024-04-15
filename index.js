import app from './AppWrapper.js';
import { convert } from './lib/index.js';

import { promises as fs, existsSync as fileExists } from 'fs';
import path from 'path';
import os from 'os';
import { env } from 'process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function tempFile(fileName) {
  return path.join(__dirname, 'temp', fileName);
}

app(async function main(modelPath, customGameDirectory) {
  // Ensure we have a model
  if (!modelPath || modelPath.length == 0) {
    throw new Error('Please provide a glTF model path!');
  }

  // Let's try to figure out a game directory
  let gameDirectoryPath = null;
  if (os.platform == 'win32') {
    gameDirectoryPath = path.join(env.ProgramData, 'Dual Universe');
  }
  if (customGameDirectory && customGameDirectory.length > 0) {
    gameDirectoryPath = customGameDirectory;
  }

  // Test if that directory exists
  if (
    !gameDirectoryPath ||
    gameDirectoryPath.length == 0 ||
    !fileExists(gameDirectoryPath)
  ) {
    throw new Error(`Could not find game directory!\nFor non-Windows users, make sure you provide a valid path as the second argument!\nCurrent game path: ${gameDirectoryPath || '*none*'}`);
  }

  // Reads materials file
  const itemMaterialsPath = tempFile('item-materials.json');
  if (!fileExists(itemMaterialsPath)) {
    throw new Error('TODO: Implement download of item materials file');
  }
  const { items: itemData } = await fs.readFile(itemMaterialsPath).then(JSON.parse);
  
  // Reads the glTF
  if (!fileExists(modelPath)) {
    throw new Error('Could not find the provided glTF file!');
  }

  // Converts
  const result = await convert({
    sourceFile: modelPath,
    destinationFile: path.join(path.dirname(modelPath), `${path.basename(modelPath, path.extname(modelPath))}.out.glb`),
    // destinationFile: path.join(path.dirname(modelPath), `${path.basename(modelPath, path.extname(modelPath))}.out.gltf`),
    gameDirectory: gameDirectoryPath,
    itemDefinitions: itemData,
    // textureMode: 'textured',
  });
});