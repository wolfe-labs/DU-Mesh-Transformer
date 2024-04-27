import { parseDDSHeader, decodeImage } from 'dds-ktx-parser';
import RgbaBuffer from './RgbaBuffer.js';

export default class DdsConverter {
  static convertToRgba(ddsStream: Buffer) {
    const dds = parseDDSHeader(ddsStream);

    if (!dds) {
      throw new Error('Invalid DDS image!');
    }
    
    // Creates the new image
    const layer = dds.layers[0];
    return new RgbaBuffer(layer.shape.width, layer.shape.height, decodeImage(ddsStream, dds.format, layer));
  }

  static async convertToJimp(ddsStream: Buffer) {
    return await this.convertToRgba(ddsStream).toJimpImage();
  }

  static async convertToPng(ddsStream: Buffer) {
    return (await this.convertToJimp(ddsStream)).getBufferAsync('image/png');
  }
}