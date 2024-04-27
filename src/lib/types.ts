import { Document } from '@gltf-transform/core';
import DuMeshTransformer from './DuMeshTransformer';

export type ProcessingQueueCommandParameters = { document: Document, transformer: DuMeshTransformer };
export type ProcessingQueueCommandFunction = ({ document, transformer }: ProcessingQueueCommandParameters, ...args: any[]) => void;
export type ProcessingQueueCommand = {
  fn: ProcessingQueueCommandFunction,
  args: any[],
};

export enum EventType {
  DEBUG = 'debug',
};