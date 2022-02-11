import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import { Package, Project } from './models/project';

export default class ProjectFileLoader {
  public async loadProjectAsync(projectName: string): Promise<Project> {
    const files = await vscode.workspace.findFiles(projectName);
    const projectFilePath = files[0].fsPath;
    const projectContent = fs.readFileSync(projectFilePath, 'utf8');
    const packages = await this.readPackagesAsync(projectContent);
    return {
      name: projectName,
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
