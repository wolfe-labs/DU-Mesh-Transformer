import Jimp from 'jimp';

export default class RgbaBuffer {
  constructor(width, height, buffer) {
    this.width = width;
    this.height = height;
    this.buffer = buffer;
  }

  getPixelIndex(x, y) {
    x = x - 1;
    y = y - 1;
    return this.width * y + x;
  }

  getPixelOffsetByIndex(index) {
    return index * 4;
  }

  getPixelOffset(x, y) {
    return this.getPixelOffsetByIndex(getPixelIndex(x, y));
  }

  getPixelByIndex(index) {
    const offset = this.getPixelOffsetByIndex(index);
    return [
      this.buffer[offset + 0],
      this.buffer[offset + 1],
      this.buffer[offset + 2],
      this.buffer[offset + 3],
    ];
  }

  getPixel(x, y) {
    return this.getPixelByIndex(this.getPixelIndex(x, y));
  }

  setPixelByIndex(index, rgba) {
    if (!Array.isArray(rgba) && typeof rgba == 'object') {
      rgba = [rgba.r, rgba.g, rgba.b, rgba.a || 255];
    }

    const [r, g, b, a] = rgba;
    const offset = this.getPixelOffsetByIndex(index);

    this.buffer[offset + 0] = r;
    this.buffer[offset + 1] = g;
    this.buffer[offset + 2] = b;
    this.buffer[offset + 3] = a || 255;
  }

  setPixel(x, y, rgba) {
    return this.setPixelByIndex(this.getPixelIndex(x, y), rgba);
  }

  transformArea(x, y, width, height, callback) {
    const finalX = Math.min(x + width, this.width);
    const finalY = Math.min(y + height, this.height);

    for (let cY = y; cY <= finalY; cY++) {
      let index = null;
      for (let cX = x; cX <= finalX; cX++) {
        // Gets next pixel index
        index = index
          ? index + 1
          : this.getPixelIndex(cX, cY);

        // Processes pixel
        this.setPixelByIndex(
          index,
          callback(
            this.getPixelByIndex(index),
            { x: cX, y: cY },
          ),
        );
      }
    }
  }

  transform(callback) {
    this.transformArea(1, 1, this.width, this.height, callback);
  }

  async toJimpImage() {
    const image = await Jimp.create(this.width, this.height);
    const imageBuffer = image.bitmap.data;
    for (let i = 0; i < imageBuffer.length; i++) {
      imageBuffer[i] = this.buffer[i];
    }
    return image;
  }

  async toConvertedBuffer(mime) {
    return await (await this.toJimpImage()).getBufferAsync(mime);
  }

  static fromJimpImage(image) {
    return new this(image.getWidth(), image.getHeight(), image.bitmap.data);
  }

  static async fromFileBuffer(buffer) {
    return this.fromJimpImage(
      await Jimp.create(buffer)
    );
  }
}