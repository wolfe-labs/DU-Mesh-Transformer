import {
  ProcessingQueueCommandParameters as CommandParams,
  EventType as EventType
} from '../types';

export default async function BaseColorsTransform({ document, transformer }: CommandParams) {
  transformer.notify(EventType.DEBUG, 'Hello, world!');
}