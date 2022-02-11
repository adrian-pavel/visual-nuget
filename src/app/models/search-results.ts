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
  totalDownloads: number | undefined;
  verified: boolean;
}
