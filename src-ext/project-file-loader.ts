import * as fs from 'fs';
import * as xml2js from 'xml2js';
import * as path from 'path';

import { Package, Project } from './models/project';

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

  private async readPackagesAsync(projectContent: string): Promise<Package[]> {
    var parsedXml = await xml2js.parseStringPromise(projectContent);
    if (!parsedXml.Project.ItemGroup) {
      return [];
    }
    const packageReferenceGroup = parsedXml.Project.ItemGroup.find((ig: any) => ig.PackageReference !== undefined);

    if (!packageReferenceGroup) {
      return [];
    }

    const packageReferences = packageReferenceGroup.PackageReference as Array<any>;

    const packages = packageReferences.map((prg: any) => {
      return {
        id: prg.$.Include,
        version: prg.$.Version,
      };
    });
    return packages;
  }
}
