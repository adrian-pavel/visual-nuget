/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as path from 'path';
import { InstalledPackage, Project } from '../src-common/models/project';

export default class ProjectFileLoader {
  public async loadProjectAsync(projectFilePath: string): Promise<Project> {
    const projectContent = fs.readFileSync(projectFilePath, 'utf8');
    const packages = await this.readPackagesAsync(projectContent);

    const projectName = path.basename(projectFilePath);

    return {
      name: projectName,
      fsPath: projectFilePath,
      packages: packages,
    };
  }

  private async readPackagesAsync(projectContent: string): Promise<InstalledPackage[]> {
    const parsedXml = await xml2js.parseStringPromise(projectContent);
    if (!parsedXml.Project.ItemGroup) {
      return [];
    }

    const packageReferences = parsedXml.Project.ItemGroup.filter((itemGroup: any) => itemGroup.PackageReference !== undefined).flatMap((itemGroup: { PackageReference: Array<any> }) => itemGroup.PackageReference);

    const packages = packageReferences.map((packageReference: any) => {
      return {
        id: packageReference.$.Include,
        version: packageReference.$.Version,
      };
    });
    return packages;
  }
}
