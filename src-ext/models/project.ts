export interface Project {
  name: string;
  fsPath: string;
  packages: Package[];
}

export interface Package {
  id: string;
  version: string;
}
