import path from 'path';
import os from 'os';
import { env } from 'process';
import { existsSync as fileExists, promises as fs } from 'fs';
import EventEmitter from 'node:events';

import { Document, JSONDocument, Material, NodeIO, Root, vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import BaseColorsTransform from './commands/BaseColorsTransform';

import { CoreSize, EventType, MaterialDefinition, MaterialDefinitions, MaterialPair, MeshType, ProcessingQueueCommand, ProcessingQueueCommandFunction } from './types';
import TexturesTransform from './commands/TexturesTransform';
import CreateUvMapsTransform from './commands/CreateUvMapsTransfrom';
import HdrMaterialsTransform from './commands/HdrMaterialsTransform';
import ElementSeparationTransform from './commands/ElementSeparationTransform';
import Package from './Package';
import TranslateTransform from './commands/TranslateTransfrom';

export default class DuMeshTransformer {
  // Keeps track of all commands on the current processing queue
  private pendingCommands: ProcessingQueueCommand[] = [];

  // The game installation directory
  private gameInstallationPath: string | null = null;

  // This is an event emitter for debugging
  private eventEmitter = new EventEmitter();

  // Let's store cached data here
  private cachedData: Record<string, any> = {};

  // This is our object's name
  private objectName: string = 'Unnamed';

  // The construct type
  private type: MeshType = MeshType.NORMAL;

  // The construct size
  private coreSize: number;

  ///////////////////////////////////////////////////////////////////
  // Internal API
  ///////////////////////////////////////////////////////////////////

  private static getDocumentIo(): NodeIO {
  // This is our reader
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS);
  }

  /**
   * Queues a custom command for transforming the document
   */
  public queueTransform(command: ProcessingQueueCommandFunction, ...args: any[]): DuMeshTransformer {
    return this.queue(command, args);
  }

  /**
   * Queues a command for transforming the document
   */
  private queue(command: ProcessingQueueCommandFunction, ...args: any[]): DuMeshTransformer {
    // Queues the next command in the line
    this.pendingCommands.push({
      fn: command,
      args: args,
    });

    // Retuns a copy of this instance for chaining
    return this;
  }

  /**
   * Processes the current command queue, transforming the document
   */
  private async processQueue() {
    this.notify(EventType.TRANSFORM_START);

    // Copies our commands and clears the queue to avoid double processing
    const queue = [...this.pendingCommands];
    this.pendingCommands = [];

    // Processes each command in sequence
    for (const command of queue) {
      await command.fn.apply(this, [{ document: this.gltfDocument, transformer: this }, ...command.args]);
      this.notify(EventType.TRANSFORM_NEXT);
    }
    
    this.notify(EventType.TRANSFORM_FINISH);
  }

  /**
   * Sends an event for upstream debugging
   */
  public notify(type: EventType, ...args: any[]) {
    this.events().emit(type, ...args);
  }

  ///////////////////////////////////////////////////////////////////
  // Public API
  ///////////////////////////////////////////////////////////////////

  /**
   * Gets the object name
   */
  public getName(): string {
    return this.objectName;
  }

  /**
   * Sets the object name
   */
  public setName(name: string): DuMeshTransformer {
    this.objectName = name;
    return this;
  }

  /**
   * Gets the underlying glTF document
   */
  public getDocument(): Document {
    return this.gltfDocument;
  }

  /**
   * Gets the underlying glTF document
   */
  public getDocumentRoot(): Root {
    return this.getDocument().getRoot();
  }

  /**
   * Returns a list of material definitions
   */
  public getMaterialDefinitions(): MaterialDefinitions {
    return this.materialDefinitions;
  }

  /**
   * Returns a game item id from a glTF material
   */
  public getGameItemIdFromGltfMaterial(material: Material): string {
    return (material.getExtras()['item_id'] as string) || material.getName();
  }

  /**
   * Returns a game material based on its game item id
   */
  public getGameMaterialFromItemId(itemId: string): MaterialDefinition | null {
    return this.getMaterialDefinitions().items[itemId] || null;
  }

  /**
   * Returns a game material from a glTF material
   */
  public getGameMaterialFromGltfMaterial(material: Material): MaterialDefinition | null {
    return this.getGameMaterialFromItemId(
      this.getGameItemIdFromGltfMaterial(material)
    );
  }

  /**
   * Returns materials who have game materials paired to them
   */
  public getGltfMaterialsWithGameMaterials(): MaterialPair[]
  {
    return this.gltfDocument.getRoot().listMaterials()
      .map((material) => {
        const gameMaterial = this.getGameMaterialFromGltfMaterial(material);
        
        return gameMaterial
          ? { material: material, gameMaterial: gameMaterial }
          : null;
      })
      .filter((pair) => !!pair) as MaterialPair[];
  }

  /**
   * Allows for listening for events from the mesh transformer
   */
  public events(): EventEmitter {
    return this.eventEmitter;
  }

  /**
   * Gets whether the game directory has been set
   */
  public isGameInstallationDirectorySet(): boolean
  {
    return !!this.gameInstallationPath;
  }

  /**
   * Sets the game installation directory to a custom path
   */
  public setGameInstallationDirectory(directory: string): DuMeshTransformer {
    // Checks if we have a valid data directory
    if (
      !fileExists(path.join(directory, 'Game', 'data'))
    ) {
      throw new Error(`Invalid game directory: ${directory}`);
    }

    // Saves and allows for the next command
    this.gameInstallationPath = directory;
    return this;
  }

  /**
   * Gets the game's data directory (if provided)
   */
  public getDataDirectory(): string | null
  {
    return this.isGameInstallationDirectorySet()
      ? path.join(this.gameInstallationPath!, 'Game', 'data')
      : null;
  }

  /**
   * Saves the file into a .glb or .gltb file
   * @param file The file you're saving to
   * @param saveAsJson Saves the file as .gltf instead of .glb, when enabled, a new directory is created per-mesh
   */
  public async saveToFile(file: string, saveAsJson: boolean = false) {
    // Processes any pending changes
    await this.processQueue();

    // Gets the file names
    const dir = path.dirname(file);
    const ext = path.extname(file).toLowerCase();
    const basename = ['.glb', '.gltf'].includes(ext)
      ? path.basename(file, path.extname(file))
      : path.basename(file);

    // Writes the document
    if (saveAsJson) {
      // Creates the directory so we can isolate all the files properly
      const finaldir = path.join(dir, basename);
      if (!fileExists(finaldir)) {
        await fs.mkdir(finaldir);
      }

      // Writes actual file as .gltf
      await DuMeshTransformer.getDocumentIo().write(
        path.join(finaldir, `${basename}.gltf`),
        this.gltfDocument,
      );
    } else {
      // Let's just write a single-file .glb
      await DuMeshTransformer.getDocumentIo().write(
        path.join(dir, `${basename}.glb`),
        this.gltfDocument,
      );
    }
  }

  /**
   * Accesses cached data, optionally providing a function to update it when nothing is found
   */
  public async remember<T>(key: string, fn?: () => T) {
    if (this.cachedData[key] === undefined && fn) {
      this.cachedData[key] = await fn();
    }

    return this.cachedData[key];
  }

  /**
   * Accesses cached data, optionally providing a function to update it when nothing is found
   * This variant allows for remembering multiple things under the same "category"
   */
  public async rememberMany<T>(category: string, key: string, fn?: () => T) {
    if (this.cachedData[category] === undefined) {
      this.cachedData[category] = {};
    }

    if (this.cachedData[category][key] === undefined && fn) {
      this.cachedData[category][key] = await fn();
    }

    return this.cachedData[category][key];
  }

  /**
   * Overwrites cached data
   */
  public setRemember<T>(key: string, data: T) {
    this.cachedData[key] = data;
  }

  /**
   * Overwrites cached data
   * This variant allows for caching multiple things under the same "category"
   */
  public setRememberMany<T>(category: string, key: string, data: T) {
    if (this.cachedData[category] === undefined) {
      this.cachedData[category] = {};
    }

    this.cachedData[category][key] = data;
  }

  /**
   * Gets the core size in meters
   */
  public getCoreSizeInMeters(): number
  {
    return this.coreSize;
  }

  /**
   * Gets the core size in voxels
   */
  public getCoreSizeInVoxels(): number
  {
    return this.coreSize * 4 - 1;
  }

  /**
   * Gets the mesh type
   */
  public getMeshType(): MeshType
  {
    return this.type;
  }

  ///////////////////////////////////////////////////////////////////
  // Transforms
  ///////////////////////////////////////////////////////////////////

  /**
   * Applies the base material colors to the model
   */
  public withBaseColors() {
    return this.queue(BaseColorsTransform);
  }

  /**
   * Applies textures to the model, requires the game directory to be present
   */
  public withTextures() {
    return this.queue(TexturesTransform);
  }

  /**
   * Generates any missing UV maps for the model, via triplanar mapping
   */
  public withUvMaps({ swapYZ = undefined, textureSizeInMeters = 2.000, voxelOffsetSize = 0.125 }: { swapYZ?: boolean, textureSizeInMeters?: number, voxelOffsetSize?: number } = {}) {
    // Sorts default swapping
    if (typeof swapYZ !== 'boolean') {
      swapYZ = (this.getMeshType() === MeshType.EXTERNAL)
        ? true
        : false;
    }
    
    return this.queue(CreateUvMapsTransform, { swapYZ, textureSizeInMeters, voxelOffsetSize });
  }

  /**
   * Applies HDR emissive strenght to the emissive materials
   */
  public withHdrEmissive({ strength = 5.000 } = {}) {
    return this.queue(HdrMaterialsTransform, ...arguments);
  }

  /**
   * Attempts to separate elements from honeycomb, to assist when texturing
   */
  public withSeparatedElements() {
    return this.queue(ElementSeparationTransform, ...arguments);
  }

  /**
   * Translates (moves) the meshes by an amount 
   */
  public withTranslation(translation: vec3) {
    return this.queue(TranslateTransform, ...arguments);
  }

  ///////////////////////////////////////////////////////////////////
  // Constructors
  ///////////////////////////////////////////////////////////////////

  private constructor(
    private gltfDocument: Document,
    private materialDefinitions: MaterialDefinitions,
  ) {
    // Sets game install directory on Windows
    if (os.platform() == 'win32') {
      const defaultGameInstall = path.join(env.ProgramData || 'C:\\ProgramData', 'Dual Universe');

      if (fileExists(defaultGameInstall) && fileExists(path.join(defaultGameInstall, 'Game', 'data'))) {
        this.setGameInstallationDirectory(defaultGameInstall);
      }
    }
    
    // Removes default light/camera that are exported along with model
    for (const node of gltfDocument.getRoot().listNodes()) {
      if (['Camera', 'Light'].includes(node.getName())) {
        node.dispose();
      }
    }

    // This is our main mesh
    const mainNode = gltfDocument.getRoot().listNodes()[0];

    // Gets the core size
    this.coreSize = Math.abs(Math.max(...mainNode.getTranslation()));

    // If we don't have a valid core size, set type as external, as it might not even be a valid Mesh Exporter file
    if (this.coreSize <= 0) {
      this.type = MeshType.EXTERNAL;

      // Let's figure out the right core based on the vertex min/max values
      const baseNode = gltfDocument.getRoot().listNodes().find(node => !!node.getMesh());
      if (baseNode) {
        const baseMesh = baseNode.getMesh();
        const basePrimitive = baseMesh.listPrimitives()[0];
        const vertexPositions = basePrimitive.getAttribute('POSITION')!;

        let posAvg: number[] = [0, 0, 0];
        const factor = 1 / vertexPositions.getCount();
        for (let idx = 0; idx < vertexPositions.getCount(); idx++) {
          const vertex = vertexPositions.getElement(idx, [])
          const min = Math.min(...vertex);
          const max = Math.max(...vertex);

          posAvg[0] += vertex[0] * factor;
          posAvg[1] += vertex[1] * factor;
          posAvg[2] += vertex[2] * factor;
        }

        let posMin: number | undefined, posMax: number | undefined;
        for (let idx = 0; idx < vertexPositions.getCount(); idx++) {
          const vertex = vertexPositions.getElement(idx, [])
          vertex[0] -= posAvg[0];
          vertex[1] -= posAvg[1];
          vertex[2] -= posAvg[2];

          const min = Math.min(...vertex);
          const max = Math.max(...vertex);

          posMin = (posMin !== undefined)
            ? Math.min(posMin, min)
            : min;

          posMax = (posMax !== undefined)
            ? Math.max(posMax, max)
            : max;
        }

        // Let's estimate the size here
        const sizeDelta = (posMax || 0) - (posMin || 0);
        for (const coreSize of [CoreSize.XS, CoreSize.S, CoreSize.M, CoreSize.L]) {
          this.coreSize = coreSize;

          if (sizeDelta >= coreSize) {
            continue;
          }

          break;
        }

        // Applies centering, if not already provided
        const baseTranslation = baseNode.getTranslation();
        if (baseTranslation[0] === 0 && baseTranslation[1] === 0 && baseTranslation[2] === 0) {
          this.withTranslation([-this.coreSize, -this.coreSize, -this.coreSize]);
        }
      }
    }

    // Pre-processes materials so we attach their item ids for later usage
    for (const material of gltfDocument.getRoot().listMaterials()) {
      const itemId = this.getGameItemIdFromGltfMaterial(material);
      const itemMaterial = itemId
        ? this.getGameMaterialFromItemId(itemId)
        : null;

      if (itemId && itemMaterial) {
        // Renames the material to the right name
        material.setName(itemMaterial.title);

        // Sets a metadata field with the original item id
        material.setExtras({
          ...material.getExtras(),
          item_id: itemId,
        })
      }
    }
  }

  /**
   * Loads a glTF exported mesh from a GLTF Transform Document
   * @returns 
   */
  public static async fromDocument(document: Document, materialDefinitions?: MaterialDefinitions): Promise<DuMeshTransformer> {
    return new DuMeshTransformer(
      document,
      materialDefinitions || await fs.readFile(path.join(Package.getDataDirectory(), 'materials.json')).then((data) => JSON.parse(data.toString())),
    );
  }

  /**
   * Loads a glTF exported mesh from a .gltf/.glb file
   * @returns 
   */
  public static async fromFile(file: string, materialDefinitions?: MaterialDefinitions): Promise<DuMeshTransformer> {
    return (
      await DuMeshTransformer.fromDocument(
        await DuMeshTransformer.getDocumentIo().read(file),
        materialDefinitions,
      )
    ).setName(path.basename(file, path.extname(file)));
  }

  /**
   * Loads a glTF exported mesh from a JSON string
   * @returns 
   */
  public static async fromGltfJson(json: string|JSONDocument, materialDefinitions?: MaterialDefinitions): Promise<DuMeshTransformer> {
    return await DuMeshTransformer.fromDocument(
      await DuMeshTransformer.getDocumentIo().readJSON(
        (typeof json === 'string')
          ? JSON.parse(json)
          : json
      ),
      materialDefinitions,
    );
  }

  /**
   * Loads a glTF exported mesh from a GLB binary
   * @returns 
   */
  public static async fromGlbBinary(binaryData: Uint8Array, materialDefinitions?: MaterialDefinitions): Promise<DuMeshTransformer> {
    return DuMeshTransformer.fromDocument(
      await DuMeshTransformer.getDocumentIo().readBinary(binaryData),
      materialDefinitions,
    );
  }
}