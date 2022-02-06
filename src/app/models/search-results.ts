export interface SearchResults {
  totalHits: number;
  data: PackageDetailsSearchResult[];
}

export interface PackageDetailsSearchResult {
  id: string;
  version: string;
  description: string;
  summary: string;
  versions: Version[];
  authors: string | string[];
  iconUrl: string;
  licenseUrl: string;
  owners: string | string[];
  projectUrl: string;
  tags: string | string[];
  title: string;
  totalDownloads: number;
  verified: boolean;
}

export interface Version {
  '@id': string;
  version: string;
  downloads: number;
}
