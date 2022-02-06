export interface Project {
  name: string;
  packages: Package[];
}

export interface Package {
  id: string;
  version: string;
}
