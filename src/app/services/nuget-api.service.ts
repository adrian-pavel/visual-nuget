import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { coerce, prerelease, rcompare } from 'semver';

import { ApiIndexResponse } from '../models/api-index-response';
import { PackageRowModel } from '../models/package-row-model';
import { CatalogEntry, PackageMetaResponse, RegistrationLeaf, RegistrationPage } from '../models/package-meta';
import { PackageSource } from '../models/package-source';
import { PackageSearchResult, SearchResults } from '../models/search-results';

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
        return this.executeMetadataGets(packageIds, query, prerelease, metaApiUrl, authHeaders, source.url);
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
    includePrerelease: boolean,
    metaApiUrl: string,
    authHeaders: HttpHeaders,
    sourceUrl: string
  ): Observable<PackageRowModel[]> {
    const requests: Observable<PackageRowModel | null>[] = [];

    // compose a list of requests to start in parallel
    for (const packageId of packageIds) {
      const metaApiFullUrl = new URL(`${packageId.toLowerCase()}/index.json`, metaApiUrl);

      const request: Observable<PackageRowModel | null> = this.http
        .get<PackageMetaResponse>(metaApiFullUrl.toString(), {
          headers: authHeaders,
        })
        //some packages will not exist on some source, for these return null and filter after
        .pipe(
          catchError((_) => of(null)),
          switchMap((packageMeta: PackageMetaResponse | null): Observable<RegistrationLeaf[] | null> => {
            return this.getRegistrationLeafs(packageMeta);
          }),
          map((registrationLeafs: RegistrationLeaf[] | null): CatalogEntry[] | null => {
            return this.getFilteredAndSortedCatalogEntries(registrationLeafs, includePrerelease);
          }),
          map((catalogEntries: CatalogEntry[] | null) => {
            return this.convertCatalogEntriesToPackageRow(catalogEntries, packageId, sourceUrl);
          })
        );
      requests.push(request);
    }

    return forkJoin(requests).pipe(
      map((packageRowResults) => {
        return this.filterAndSortPackageRowResults(packageRowResults, query);
      })
    );
  }

  private getRegistrationLeafs(packageMeta: PackageMetaResponse | null): Observable<RegistrationLeaf[] | null> {
    if (packageMeta === null) {
      return of(null);
    }

    const allLeafsRequests: Observable<RegistrationLeaf[]>[] = [];

    for (const page of packageMeta.items) {
      if (page.items) {
        allLeafsRequests.push(of(page.items));
      } else {
        // need to fetch each page on an individual request to the API
        const regPageRequest = this.http
          .get<RegistrationPage>(page['@id'])
          .pipe(map((registrationPage: RegistrationPage) => registrationPage.items!));
        allLeafsRequests.push(regPageRequest);
      }
    }

    return forkJoin(allLeafsRequests).pipe(
      map((results) => {
        let finalResult: RegistrationLeaf[] = [];
        results.forEach((result) => {
          finalResult = finalResult.concat(result);
        });
        return finalResult;
      })
    );
  }

  private getFilteredAndSortedCatalogEntries(registrationLeafs: RegistrationLeaf[] | null, includePrerelease: boolean): CatalogEntry[] | null {
    if (registrationLeafs === null) {
      return null;
    }

    let filteredRegistrationLeafs: RegistrationLeaf[] = [];
    if (includePrerelease) {
      filteredRegistrationLeafs = registrationLeafs;
    } else {
      filteredRegistrationLeafs = registrationLeafs.filter((rl) => prerelease(rl.catalogEntry.version) === null);
    }

    const allCatalogEntries = filteredRegistrationLeafs.map((rl) => rl.catalogEntry);

    allCatalogEntries.sort((entry1, entry2) => {
      return this.compareSemVers(entry1.version, entry2.version);
    });

    return allCatalogEntries;
  }

  private convertCatalogEntriesToPackageRow(catalogEntries: CatalogEntry[] | null, packageId: string, sourceUrl: string): PackageRowModel | null {
    if (catalogEntries === null) {
      return null;
    }

    const latestCatalogEntry = catalogEntries[0];

    const packageRow: PackageRowModel = {
      id: packageId,
      version: latestCatalogEntry.version,
      description: latestCatalogEntry.description,
      authors: latestCatalogEntry.authors,
      iconUrl: latestCatalogEntry.iconUrl,
      totalDownloads: undefined,
      verified: false,
      isInstalled: false,
      installedVersion: '',
      isOutdated: false,
      sourceUrl: sourceUrl,
      versions: catalogEntries,
    };

    return packageRow;
  }

  private filterAndSortPackageRowResults(packageRowResults: (PackageRowModel | null)[], query: string): PackageRowModel[] {
    // filter out the null results for packages that don't exist on this source
    // also filter based on the query in the same pass
    const filteredSearchResults = packageRowResults.filter((result) => this.resultMatchesQuery(query, result)) as PackageRowModel[];

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
  }

  private resultMatchesQuery(query: string, result: PackageSearchResult | null): boolean {
    if (result === null) {
      return false;
    }

    if (!query.trim()) {
      return true;
    }

    const lowerQuery = query.toLocaleLowerCase();

    return result.id.toLocaleLowerCase().includes(lowerQuery) || result.description.toLowerCase().includes(lowerQuery);
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
    const packagesWithInstalledInfo = packageSearchResults.map((packageSearchResult: PackageSearchResult) => {
      const packageRowModel: PackageRowModel = {
        ...packageSearchResult,
        isInstalled: false,
        installedVersion: '',
        isOutdated: false,
        sourceUrl: source.url,
        versions: versions,
      };
      return packageRowModel;
    });

    return packagesWithInstalledInfo;
  }
}
