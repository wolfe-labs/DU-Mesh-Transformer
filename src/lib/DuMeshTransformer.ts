import path from 'path';
import os from 'os';
import { env } from 'process';
import { existsSync as fileExists, promises as fs } from 'fs';
import EventEmitter from 'node:events';

import { Document, JSONDocument, NodeIO, PlatformIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import BaseColorsTransform from './commands/BaseColorsTransform';
import { EventType, ProcessingQueueCommand, ProcessingQueueCommandFunction } from './types';

export default class DuMeshTransformer {
  // Keeps track of all commands on the current processing queue
  private pendingCommands: ProcessingQueueCommand[] = [];

  // The game installation directory
  private gameInstallationPath: string | null = null;

  // This is an event emitter for debugging
  private eventEmitter = new EventEmitter();

  ///////////////////////////////////////////////////////////////////
  // Internal API
  ///////////////////////////////////////////////////////////////////

  private static getDocumentIo(): NodeIO {
  // This is our reader
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS);
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
    // Copies our commands and clears the queue to avoid double processing
    const queue = [...this.pendingCommands];
    this.pendingCommands = [];

    // Processes each command in sequence
    for (const command of queue) {
      await command.fn.apply(this, [{ document: this.gltfDocument, transformer: this }, ...command.args]);
    }
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
    const basename = path.basename(file, path.extname(file));

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

  ///////////////////////////////////////////////////////////////////
  // Transforms
  ///////////////////////////////////////////////////////////////////

  public withBaseColors() {
    return this.queue(BaseColorsTransform);
  }

  ///////////////////////////////////////////////////////////////////
  // Constructors
  ///////////////////////////////////////////////////////////////////

  private constructor(
    private gltfDocument: Document
  ) {
    // Sets game install directory on Windows
    if (os.platform() == 'win32') {
      const defaultGameInstall = path.join(env.ProgramData || 'C:\\ProgramData', 'Dual Universe');

      if (fileExists(defaultGameInstall) && fileExists(path.join(defaultGameInstall, 'Game', 'data'))) {
        this.setGameInstallationDirectory(defaultGameInstall);
      }
    }
  }

  /**
   * Loads a glTF exported mesh from a GLTF Transform Document
   * @returns 
   */
  public static fromDocument(document: Document): DuMeshTransformer {
    return new DuMeshTransformer(document);
  }

  /**
   * Loads a glTF exported mesh from a .gltf/.glb file
   * @returns 
   */
  public static async fromFile(file: string): Promise<DuMeshTransformer> {
    return DuMeshTransformer.fromDocument(
      await DuMeshTransformer.getDocumentIo().read(file)
    );
  }

  /**
   * Loads a glTF exported mesh from a JSON string
   * @returns 
   */
  public static async fromGltfJson(json: string|JSONDocument): Promise<DuMeshTransformer> {
    return DuMeshTransformer.fromDocument(
      await DuMeshTransformer.getDocumentIo().readJSON(
        (typeof json === 'string')
          ? JSON.parse(json)
          : json
      )
    );
  }

  /**
   * Loads a glTF exported mesh from a GLB binary
   * @returns 
   */
  public static async fromGlbBinary(binaryData: Uint8Array): Promise<DuMeshTransformer> {
    return DuMeshTransformer.fromDocument(
      await DuMeshTransformer.getDocumentIo().readBinary(binaryData)
    );
  }
}