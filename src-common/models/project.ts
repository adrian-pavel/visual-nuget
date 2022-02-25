export interface Project {
  name: string;
  fsPath: string;
  packages: InstalledPackage[];
}

export interface InstalledPackage {
  id: string;
  version: string;
}
