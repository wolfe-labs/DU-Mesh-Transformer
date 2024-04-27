#!/usr/bin/env node

import path from 'path';

import app from '../lib/ApplicationWrapper.js';
import DuMeshTransformer from '../lib/DuMeshTransformer.js';
import { EventType } from '../lib/types';

app(async function main(modelPath, customGameDirectory) {
  const isDebugEnabled = !!JSON.parse(process.env.debug || 'false');

  // Intro
  const introText = `glTF Mesh Converter for Dual Universe by Wolfe Labs`;
  console.log(`+-${'-'.repeat(introText.length)}-+`)
  console.log(`| ${introText} |`)
  console.log(`+-${'-'.repeat(introText.length)}-+`)
  console.log(``)

  // Handles cases where no model is passed
  if (!modelPath || modelPath.length == 0) {
    console.info(`Missing model path as first parameter, make sure you supply a valid glTF file!`);
    console.info(`Optionally, you can also supply the game directory if you have a custom installation.`);
    return;
  }

  // Loads our mesh
  console.log(`Loading file for processing: ${modelPath}`);
  const meshTransformer = await DuMeshTransformer.fromFile(modelPath);

  // Optionally set our game directory
  if (customGameDirectory && customGameDirectory.length > 0) {
    meshTransformer.setGameInstallationDirectory(customGameDirectory);
  }

  // Always print warnings
  meshTransformer.events().on(EventType.WARNING, message => console.warn('[WARNING]', message));

  // Only show debug stuff with debug env variable
  if (isDebugEnabled) {
    meshTransformer.events().on(EventType.TRANSFORM_START, () => console.log('\n[STATUS] Model processing started!\n'));
    meshTransformer.events().on(EventType.TRANSFORM_FINISH, () => console.log('[STATUS] Model processing finished!\n'));
    meshTransformer.events().on(EventType.TRANSFORM_NEXT, () => console.log(''));
    meshTransformer.events().on(EventType.DEBUG, message => console.log('[DEBUG]', message));
  }

  // Gets the file names
  const dir = path.dirname(modelPath);
  const basename = path.basename(modelPath, path.extname(modelPath));

  // Processes our mesh as desired and saves it
  const outputFile = path.join(dir, `${basename}.out`);
  if (!isDebugEnabled) {
    console.log('Mesh processing started!');
  }
  await meshTransformer
    .withBaseColors()
    .withTextures()
    .withUvMaps()
    .withHdrEmissive()
    .withSeparatedElements()
    .saveToFile(outputFile, false);
  console.log(`Mesh saved successfully!`);
  console.log(`Save location: ${outputFile}`);
});