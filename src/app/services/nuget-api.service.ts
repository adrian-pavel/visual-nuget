import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, EMPTY, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { coerce, rcompare } from 'semver';

import { ApiIndexResponse } from '../models/api-index-response';
import { CatalogEntry, PackageMetaResponse } from '../models/package-meta';
import { PackageSource } from '../models/package-source';
import { PackageDetailsSearchResult, SearchResults, Version } from '../models/search-results';

@Injectable({
  providedIn: 'root',
})
export class NuGetApiService {
  private readonly VERSIONED: string = 'Versioned';
  private readonly VERSION360: string = '3.6.0';
  private readonly VERSION350: string = '3.5.0';
  private readonly VERSION200: string = '2.0.0';

  private readonly SEARCH_QUERY_SERVICE: string = 'SearchQueryService';
  private readonly REGISTRATIONS_BASE_URL: string = 'RegistrationsBaseUrl';

  private readonly searchQueryServiceEndpoints = [
    `${this.SEARCH_QUERY_SERVICE}/${this.VERSIONED}`,
    `${this.SEARCH_QUERY_SERVICE}/${this.VERSION350}`,
    this.SEARCH_QUERY_SERVICE,
  ];
  private readonly registrationsBaseUrlEndpoints = [
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSIONED}`,
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSION360}`,
    this.REGISTRATIONS_BASE_URL,
  ];

  constructor(private http: HttpClient) {}

  public search(query: string, prerelease: boolean, source: PackageSource): Observable<SearchResults> {
    let authHeaders = new HttpHeaders();
    if (source.authorizationHeader) {
      authHeaders = authHeaders.append('authorization', source.authorizationHeader);
    }

    return this.getApiUrl(source, authHeaders, this.searchQueryServiceEndpoints).pipe(
      switchMap((searchApiUrl) => {
        return this.executeSearch(query, prerelease, searchApiUrl, authHeaders);
      }),
      map((results) => {
        return this.sortVersionsOnResults(results);
      })
    );
  }

  public searchByPackageIds(packageIds: string[], source: PackageSource): Observable<SearchResults> {
    let authHeaders = new HttpHeaders();
    if (source.authorizationHeader) {
      authHeaders = authHeaders.append('authorization', source.authorizationHeader);
    }

    return this.getApiUrl(source, authHeaders, this.registrationsBaseUrlEndpoints).pipe(
      switchMap((metaApiUrl) => {
        return this.executeMetadataGets(packageIds, metaApiUrl, authHeaders);
      })
    );
  }

  private executeSearch(query: string, prerelease: boolean, searchApiUrl: string, authHeaders: HttpHeaders) {
    const searchParams = {
      q: query,
      prerelease: prerelease,
      semVerLevel: this.VERSION200,
    };

    return this.http.get<SearchResults>(searchApiUrl, {
      headers: authHeaders,
      params: searchParams,
    });
  }

  private executeMetadataGets(packageIds: string[], metaApiUrl: string, authHeaders: HttpHeaders): Observable<SearchResults> {
    const requests: Observable<PackageMetaResponse | null>[] = [];

    // compose a list of requests to start in parallel
    for (const packageId of packageIds) {
      const metaApiFullUrl = new URL(`${packageId.toLowerCase()}/index.json`, metaApiUrl);

      const request = this.http
        .get<PackageMetaResponse>(metaApiFullUrl.toString(), {
          headers: authHeaders,
        })
        //some packages will not exist on some source, for these return null and filter after
        .pipe(catchError((_) => of(null)));
      requests.push(request);
    }

    return forkJoin(requests).pipe(
      map((multiResults) => {
        let mergedResults: SearchResults = {
          totalHits: 0,
          data: [],
        };

        const detailsSearchResults = multiResults.map((meta, index) => this.convertMetaToDetailsSearchResult(meta, packageIds[index]));

        // filter out the null results for packages that don't exist on this source
        const filteredSearchResults = detailsSearchResults.filter((x) => x !== null) as PackageDetailsSearchResult[];

        // sort the results alphabetically
        filteredSearchResults.sort((a, b) => {
          if (a.id < b.id) {
            return -1;
          }
          if (a.id > b.id) {
            return 1;
          }
          return 0;
        });

        mergedResults.data = filteredSearchResults;
        mergedResults.totalHits = filteredSearchResults.length;

        return mergedResults;
      })
    );
  }

  private convertMetaToDetailsSearchResult(packageMeta: PackageMetaResponse | null, packageId: string): PackageDetailsSearchResult | null {
    if (packageMeta === null) {
      return null;
    }

    const allCatalogEntries: CatalogEntry[] = [];

    for (const page of packageMeta.items) {
      if (page.items) {
        for (const leaf of page.items) {
          allCatalogEntries.push(leaf.catalogEntry);
        }
      } else {
        // TODO: fetch the page using the page[@id]
      }
    }

    allCatalogEntries.sort((entry1, entry2) => {
      return this.compareSemVers(entry1.version, entry2.version);
    });

    const latestCatalogEntry = allCatalogEntries[0];
    const versions = allCatalogEntries.map((entry) => {
      const version: Version = {
        '@id': 'Replace this',
        downloads: 0,
        version: entry.version,
      };
      return version;
    });

    return {
      id: packageId,
      version: latestCatalogEntry.version,
      description: latestCatalogEntry.description,
      versions: versions,
      authors: latestCatalogEntry.authors,
      iconUrl: latestCatalogEntry.iconUrl,
      licenseUrl: latestCatalogEntry.licenseUrl,
      projectUrl: latestCatalogEntry.projectUrl,
      tags: latestCatalogEntry.tags,
      totalDownloads: 0,
      verified: false,
    };
  }

  private getApiUrl(source: PackageSource, authHeaders: HttpHeaders, preferedEndpoints: string[]): Observable<string> {
    return this.http
      .get<ApiIndexResponse>(source.url, {
        headers: authHeaders,
      })
      .pipe(
        map((result) => {
          let endpointToUse = '';
          for (const ep of preferedEndpoints) {
            const foundEndpoint = result.resources.find((r) => r['@type'].startsWith(ep));
            if (foundEndpoint) {
              endpointToUse = foundEndpoint['@id'];
              break;
            }
          }
          return endpointToUse;
        })
      );
  }

  private sortVersionsOnResults(results: SearchResults) {
    results.data.forEach((pdsr) =>
      pdsr.versions.sort((v1: Version, v2: Version) => {
        return this.compareSemVers(v1.version, v2.version);
      })
    );
    return results;
  }

  private compareSemVers(v1: string, v2: string) {
    try {
      return rcompare(v1, v2, { includePrerelease: true, loose: true });
    } catch {
      const cleanV1 = coerce(v1);
      const cleanV2 = coerce(v2);
      if (cleanV1 === null || cleanV2 === null) {
        return 0;
      }
      return rcompare(cleanV1, cleanV2, { includePrerelease: true, loose: true });
    }
  }
}
