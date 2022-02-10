export interface SearchResults {
  totalHits: number;
  data: PackageSearchResult[];
}

export interface PackageSearchResult {
  id: string;
  version: string;
  description: string;
  authors: string | string[];
  iconUrl: string;
  totalDownloads: number;
  verified: boolean;
}

export interface Version {
  '@id': string;
  version: string;
  downloads: number;
}
