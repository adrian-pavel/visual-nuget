export type PackageVersionSource = 'project' | 'central' | 'override' | 'mixed' | 'unknown';
export type PackageLevel = 'direct' | 'transitive' | 'mixed' | 'unknown';

export interface TargetFrameworkPackageVersion {
  targetFramework: string;
  version: string;
  requestedVersion?: string;
  versionSource: PackageVersionSource;
  centralVersionDefinitionCount?: number;
  packageLevel?: 'direct' | 'transitive';
  condition?: string;
  versionFilePath?: string;
}

export interface Project {
  name: string;
  fsPath: string;
  packages: InstalledPackage[];
  targetFrameworks?: string[];
  managePackageVersionsCentrally?: boolean;
  packageMetadataComplete?: boolean;
  packageListWarning?: string;
}

export interface InstalledPackage {
  id: string;
  version: string;
  versionSource?: PackageVersionSource;
  packageLevel?: PackageLevel;
  targetFrameworkVersions?: TargetFrameworkPackageVersion[];
  versionFilePath?: string;
}

export interface ProjectLoadFailure {
  projectPath: string;
  message: string;
}

export interface Solution {
  name: string;
  fsPath: string;
  projects: Project[];
  unsupportedProjects: string[];
  loadFailures: ProjectLoadFailure[];
}
