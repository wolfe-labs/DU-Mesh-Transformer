import fs from 'fs';
import path from 'path';

/**
 * Functions for internal use only
 */
export default class Package {
  // The cached package.json data
  private static package: any = null;

  /**
   * Gets the package's metadata
   */
  public static getPackageJson(): any {
    if (!this.package) {
      this.package = JSON.parse(
        fs.readFileSync(path.join(this.getRootDirectory(), 'package.json'))
          .toString()
      );
    }

    return this.package;
  }

  /**
   * Gets the package's version string
   */
  public static getVersion(): string {
    return this.getPackageJson().version;
  }

  /**
   * Gets the package's root directory
   */
  public static getRootDirectory(): string {
    return path.join(__dirname, '..');
  }

  /**
   * Gets the package's data directory
   */
  public static getDataDirectory(): string {
    return path.join(this.getRootDirectory(), 'data');
  }
}