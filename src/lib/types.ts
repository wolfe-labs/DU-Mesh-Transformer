import { Document, vec3 } from '@gltf-transform/core';
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

export enum MaterialTextureTypes {
  COLOR = 'color',
  NORMAL = 'normal',
  METALLIC_ROUGHNESS_AMBIENT_OCCLUSION = 'mrao',
  EMISSIVE = 'emissive',
};

export type MaterialDefinition = {
  materialId: string;
  title: string;
  icon: string;
  category: string;
  soundMaterial: string;
  texture: string;
  albedo: vec3;
  files: Record<MaterialTextureTypes, string>;
};
export type MaterialDefinitions = {
  items: Record<string, MaterialDefinition>;
};