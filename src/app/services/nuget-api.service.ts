import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, EMPTY, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { coerce, prerelease, rcompare } from 'semver';

import { ApiIndexResponse } from '../models/api-index-response';
import { PackageRowModel } from '../models/package-details';
import { CatalogEntry, PackageMetaResponse } from '../models/package-meta';
import { PackageSource } from '../models/package-source';
import { PackageSearchResult, SearchResults, Version } from '../models/search-results';

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

  public search(query: string, prerelease: boolean, source: PackageSource): Observable<PackageRowModel[]> {
    let authHeaders = new HttpHeaders();
    if (source.authorizationHeader) {
      authHeaders = authHeaders.append('authorization', source.authorizationHeader);
    }

    return this.getApiUrl(source, authHeaders, this.searchQueryServiceEndpoints).pipe(
      switchMap((searchApiUrl) => {
        return this.executeSearch(query, prerelease, searchApiUrl, authHeaders);
      }),
      map((results) => {
        return this.mapSearchResultsToPackageRows(results.data, source);
      })
    );
  }

  public searchByPackageIds(packageIds: string[], query: string, prerelease: boolean, source: PackageSource): Observable<PackageRowModel[]> {
    let authHeaders = new HttpHeaders();
    if (source.authorizationHeader) {
      authHeaders = authHeaders.append('authorization', source.authorizationHeader);
    }

    return this.getApiUrl(source, authHeaders, this.registrationsBaseUrlEndpoints).pipe(
      switchMap((metaApiUrl) => {
        return this.executeMetadataGets(packageIds, query, prerelease, metaApiUrl, authHeaders);
      })
    );
  }

  private executeSearch(query: string, prerelease: boolean, searchApiUrl: string, authHeaders: HttpHeaders): Observable<SearchResults> {
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

  private executeMetadataGets(
    packageIds: string[],
    query: string,
    prerelease: boolean,
    metaApiUrl: string,
    authHeaders: HttpHeaders
  ): Observable<PackageRowModel[]> {
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
        const detailsSearchResults = multiResults.map((meta, index) => this.convertMetaToPackageRow(meta, packageIds[index], prerelease));

        // filter out the null results for packages that don't exist on this source
        // also filter based on the query in the same pass
        const filteredSearchResults = detailsSearchResults.filter((result) => this.filterResultsByQuery(query, result)) as PackageRowModel[];

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

        return filteredSearchResults;
      })
    );
  }

  private filterResultsByQuery(query: string, result: PackageSearchResult | null): boolean {
    if (result === null) {
      return false;
    }

    if (!query.trim()) {
      return true;
    }

    const lowerQuery = query.toLocaleLowerCase();

    return result.id.toLocaleLowerCase().includes(lowerQuery) || result.description.toLowerCase().includes(lowerQuery);
  }

  private convertMetaToPackageRow(packageMeta: PackageMetaResponse | null, packageId: string, includePrerelease: boolean): PackageRowModel | null {
    if (packageMeta === null) {
      return null;
    }

    const allCatalogEntries: CatalogEntry[] = [];

    for (const page of packageMeta.items) {
      if (page.items) {
        for (const leaf of page.items) {
          // if includePrerelease === true then include all versions else only include stable ones
          if (includePrerelease || prerelease(leaf.catalogEntry.version) === null) {
            allCatalogEntries.push(leaf.catalogEntry);
          }
        }
      } else {
        // TODO: fetch the page using the page[@id]
      }
    }

    allCatalogEntries.sort((entry1, entry2) => {
      return this.compareSemVers(entry1.version, entry2.version);
    });

    const latestCatalogEntry = allCatalogEntries[0];

    const packageRow: PackageRowModel = {
      id: packageId,
      version: latestCatalogEntry.version,
      description: latestCatalogEntry.description,
      authors: latestCatalogEntry.authors,
      iconUrl: latestCatalogEntry.iconUrl,
      totalDownloads: 0,
      verified: false,
      isInstalled: false,
      installedVersion: '',
      isOutdated: false,
      sourceUrl: '',
      versions: allCatalogEntries,
    };

    return packageRow;
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
    // results.data.forEach((pdsr) =>
    //   pdsr.versions.sort((v1: Version, v2: Version) => {
    //     return this.compareSemVers(v1.version, v2.version);
    //   })
    // );
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

  private mapSearchResultsToPackageRows(
    packageSearchResults: PackageSearchResult[],
    source: PackageSource,
    versions: CatalogEntry[] | undefined = undefined
  ): PackageRowModel[] {
    const packagesWithInstalledInfo = packageSearchResults.map((psr) => {
      const pdm: PackageRowModel = {
        ...psr,
        isInstalled: false,
        installedVersion: '',
        isOutdated: false,
        sourceUrl: source.url,
        versions: versions,
      };
      return pdm;
    });

    return packagesWithInstalledInfo;
  }
}
