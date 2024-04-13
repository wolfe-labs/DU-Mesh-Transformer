import { parseDDSHeader, decodeImage } from 'dds-ktx-parser';
import RgbaBuffer from './RgbaBuffer.js';

export default class DdsConverter {
  static convertToRgba(ddsStream) {
    const dds = parseDDSHeader(ddsStream);

    if (!dds) {
      throw new Error('Invalid DDS image!');
    }
    
    // Creates the new image
    const layer = dds.layers[0];
    return new RgbaBuffer(layer.shape.width, layer.shape.height, decodeImage(ddsStream, dds.format, layer));
  }

  static async convertToJimp(ddsStream) {
    return await this.convertToRgba(ddsStream).toJimpImage();
  }

  static async convertToPng(ddsStream) {
    return (await this.convertToJimp(ddsStream)).getBufferAsync('image/png');
  }
}