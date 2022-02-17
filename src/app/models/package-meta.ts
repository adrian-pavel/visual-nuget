export interface PackageMetaResponse {
  count: number;
  items: RegistrationPage[];
}

export interface RegistrationPage {
  '@id': string;
  count: number;
  items: RegistrationLeaf[] | undefined;
}

export interface RegistrationLeaf {
  '@id': string;
  catalogEntry: CatalogEntry;
}

export interface CatalogEntry {
  '@id': string;
  id: string;
  version: string;
  description: string;
  authors: string | string[];
  iconUrl: string;
  licenseUrl: string;
  projectUrl: string;
  tags: string | string[];
  dependencyGroups: PackageDependencyGroup[] | undefined;
  published: string;
}

export interface PackageDependencyGroup {
  targetFramework: string;
  dependencies: PackageDependency[] | undefined;
}

export interface PackageDependency {
  id: string;
  range: string;
}
