import { CatalogEntry } from './package-meta';
import { PackageSearchResult } from './search-results';
import { PackageLevel, PackageVersionSource, TargetFrameworkPackageVersion } from '../../../src-common/models/project';

export interface SolutionProjectPackageState {
  projectPath: string;
  projectName: string;
  isInstalled: boolean;
  isDirectlyInstalled?: boolean;
  installedVersion: string;
  versionSource?: PackageVersionSource;
  packageLevel?: PackageLevel;
  managePackageVersionsCentrally?: boolean;
  targetFrameworkVersions?: TargetFrameworkPackageVersion[];
  packageListWarning?: string;
}

export interface PackageRowModel extends PackageSearchResult {
  description: string;
  iconUrl: string;
  verified: boolean;
  installedVersion: string;
  isInstalled: boolean;
  isOutdated: boolean;
  sourceUrl: string;
  versionSource?: PackageVersionSource;
  packageLevel?: PackageLevel;

  versions: CatalogEntry[] | undefined;
  solutionProjectStates?: SolutionProjectPackageState[];
}
