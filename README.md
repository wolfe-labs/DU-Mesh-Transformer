# Mesh Transformer for Dual Universe (du-gltf)
🎨 Enhances glTF files exported by Dual Universe's Mesh Exporter so they have proper colors and textures applied to them

## Installation and Usage

Install the command-line utility by running `npm i -g @wolfe-labs/du-gltf`.

After installing, run `du-gltf` to check if the installation was successful. You need to provide your exported glTF file as the first parameter, like this:

```sh
du-gltf "path/to/my.gltf"
```

This assumes you have the game installed at its default ProgramData location, if you don't, you also need to provide a path as the second parameter:

```sh
du-gltf "path/to/my.gltf" "C:/path/to/DualUniverse"
```

You can also enable detailed debugging information of the process by setting the `DEBUG` environment variable, like this Powershell example:

```ps1
$env:DEBUG; du-gltf "path/to/my.gltf" "C:/path/to/DualUniverse"
```

### Installing as a Node library

You can also create your own wrapper around the package and customize all kind of settings yourself.

To do so, install it into your Node project with `npm i --save @wolfe-labs/du-gltf` and follow the example below to get started:

```js
// You can also use the module syntax:
// import DuMeshTransformer from '@wolfe-labs/du-gltf';
const DuMeshTransformer = require('@wolfe-labs/du-gltf').default;

// This function is a wrapper so we can use async/await
async function convert(file) {
  // Loads our mesh
  const meshTransformer = await DuMeshTransformer.fromFile('mesh.gltf');

  // Sets the game directory (optional)
  meshTransformer.setGameInstallationDirectory('C:/games/DualUniverse');

  // Shows debug information
  meshTransformer.events().on(EventType.WARNING, message => console.warn('WARNING:', message));
  meshTransformer.events().on(EventType.TRANSFORM_START, () => console.log('Model processing started!'));
  meshTransformer.events().on(EventType.TRANSFORM_FINISH, () => console.log('Model processing finished!'));
  meshTransformer.events().on(EventType.TRANSFORM_NEXT, () => console.log(''));
  meshTransformer.events().on(EventType.DEBUG, message => console.log(message));

  // Queues a list of transforms we'll want to do and triggers processing (upon saving)
  await meshTransformer
    .withBaseColors()
    .withTextures()
    .withUvMaps()
    .withHdrEmissive()
    .withSeparatedElements()
    .saveToFile('mesh-output.glb');
}

// Runs the actual conversion
convert('my-file.gltf')
  .then(() => console.log('File processed!'));
```