import { PackageDetailsSearchResult } from './search-results';

export interface PackageDetailsModel extends PackageDetailsSearchResult {
  installedVersion: string;
  isInstalled: boolean;
  isOutdated: boolean;
  sourceUrl: string;
}
