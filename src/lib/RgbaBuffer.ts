import Jimp from 'jimp';

export type ColorVec3 = [number, number, number];
export type ColorVec4 = [number, number, number, number];
export type ColorAsVec = ColorVec3 | ColorVec4;

export type ColorRGB = { r: number, g: number, b: number };
export type ColorRGBA = { r: number, g: number, b: number, a: number };
export type ColorAsObject = ColorRGB | ColorRGBA;

export type ColorAny = ColorAsVec | ColorAsObject;

export type TransformCallback = (color: ColorVec4, { x, y }: { x: number, y: number }) => ColorAny;

export type ImageMimeType = 'image/jpeg' | 'image/png';

export default class RgbaBuffer {
  constructor(
    private width: number,
    private height: number,
    private buffer: Buffer
  ) {}

  public getWidth(): number {
    return this.width;
  }

  public getHeight(): number {
    return this.height;
  }

  public getPixelIndex(x: number, y: number) {
    x = x - 1;
    y = y - 1;
    return this.width * y + x;
  }

  public getPixelOffsetByIndex(index: number) {
    return index * 4;
  }

  public getPixelOffset(x: number, y: number) {
    return this.getPixelOffsetByIndex(this.getPixelIndex(x, y));
  }

  public getPixelByIndex(index: number): ColorVec4 {
    const offset = this.getPixelOffsetByIndex(index);
    return [
      this.buffer[offset + 0],
      this.buffer[offset + 1],
      this.buffer[offset + 2],
      this.buffer[offset + 3],
    ];
  }

  public getPixel(x: number, y: number): ColorVec4 {
    return this.getPixelByIndex(this.getPixelIndex(x, y));
  }

  public setPixelByIndex(index: number, rgba: ColorAny) {
    if (!Array.isArray(rgba) && typeof rgba == 'object') {
      // @ts-ignore
      rgba = [rgba.r, rgba.g, rgba.b, rgba.a || 255];
    }

    const [r, g, b, a] = rgba;
    const offset = this.getPixelOffsetByIndex(index);

    this.buffer[offset + 0] = r;
    this.buffer[offset + 1] = g;
    this.buffer[offset + 2] = b;
    this.buffer[offset + 3] = a || 255;
  }

  public setPixel(x: number, y: number, rgba: ColorAny) {
    return this.setPixelByIndex(this.getPixelIndex(x, y), rgba);
  }

  public transformArea(x: number, y: number, width: number, height: number, callback: TransformCallback) {
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

  public transform(callback: TransformCallback) {
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

  async toConvertedBuffer(mime: ImageMimeType) {
    return await (await this.toJimpImage()).getBufferAsync(mime);
  }

  static fromJimpImage(image: Jimp) {
    return new this(image.getWidth(), image.getHeight(), image.bitmap.data);
  }

  static async fromFileBuffer(buffer: Buffer) {
    return this.fromJimpImage(
      await Jimp.create(buffer)
    );
  }
}