import { CatalogEntry } from './package-meta';
import { PackageSearchResult } from './search-results';

export interface PackageRowModel extends PackageSearchResult {
  installedVersion: string;
  isInstalled: boolean;
  isOutdated: boolean;
  sourceUrl: string;

  versions: CatalogEntry[] | undefined;
}
