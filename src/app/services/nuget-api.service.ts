import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { coerce, prerelease, rcompare } from 'semver';

import { ApiIndexResponse, ApiResource } from '../models/api-index-response';
import { PackageRowModel } from '../models/package-row-model';
import { CatalogEntry, PackageMetaResponse, RegistrationLeaf, RegistrationPage } from '../models/package-meta';
import { PackageSource } from '../../../src-common/models/package-source';
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
  private readonly AUTHORIZATION_HEADER: string = 'authorization';

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
    const requestHeaders = this.composeRequestHeaders(source.authorizationHeader);

    return this.getApiUrl(source.url, requestHeaders, this.searchQueryServiceEndpoints).pipe(
      switchMap((searchApiUrl: string) => {
        return this.executeSearch(query, prerelease, searchApiUrl, requestHeaders);
      }),
      map((results: SearchResults) => {
        return this.mapSearchResultsToPackageRows(results.data, source.url);
      })
    );
  }

  public searchByPackageIds(packageIds: string[], query: string, prerelease: boolean, source: PackageSource): Observable<PackageRowModel[]> {
    const requestHeaders = this.composeRequestHeaders(source.authorizationHeader);

    return this.getApiUrl(source.url, requestHeaders, this.registrationsBaseUrlEndpoints).pipe(
      switchMap((metaApiUrl: string) => {
        return this.executeMetadataGets(packageIds, query, prerelease, metaApiUrl, requestHeaders, source.url);
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
        .pipe(
          //some packages will not exist on some sources, for these return null and filter after
          catchError(() => of(null)),
          switchMap((packageMeta: PackageMetaResponse | null): Observable<RegistrationLeaf[] | null> => {
            return this.getRegistrationLeafs(packageMeta);
          }),
          map((registrationLeafs: RegistrationLeaf[] | null): CatalogEntry[] | null => {
            return this.getFilteredAndSortedCatalogEntries(registrationLeafs, includePrerelease);
          }),
          map((catalogEntries: CatalogEntry[] | null): PackageRowModel | null => {
            return this.convertCatalogEntriesToPackageRow(catalogEntries, packageId, sourceUrl);
          })
        );
      requests.push(request);
    }

    return forkJoin(requests).pipe(
      map((packageRowResults: (PackageRowModel | null)[]) => {
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
      // if the leafs for this page are present in the index, then just return them
      if (page.items) {
        allLeafsRequests.push(of(page.items));
      } else {
        // need to fetch each page on an individual request to the API
        const registrationPageRequest = this.http
          .get<RegistrationPage>(page['@id'])
          .pipe(map((registrationPage: RegistrationPage): RegistrationLeaf[] => registrationPage?.items ?? []));
        allLeafsRequests.push(registrationPageRequest);
      }
    }

    // request all pages in parallel and then concatenate the results into one list
    return forkJoin(allLeafsRequests).pipe(
      map((results: RegistrationLeaf[][]): RegistrationLeaf[] => {
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
    // registration leafs contain prerelease versions by default
    if (includePrerelease) {
      filteredRegistrationLeafs = registrationLeafs;
    } else {
      // filter out prerelease versions
      filteredRegistrationLeafs = registrationLeafs.filter(
        (registrationLeaf: RegistrationLeaf): boolean => prerelease(registrationLeaf.catalogEntry.version) === null
      );
    }

    // filter out unlisted packages, compare with false explicitly since undefined means it's true/listed
    filteredRegistrationLeafs = filteredRegistrationLeafs.filter(
      (registrationLeaf: RegistrationLeaf): boolean => registrationLeaf.catalogEntry.listed !== false
    );

    const allCatalogEntries = filteredRegistrationLeafs.map((registrationLeaf: RegistrationLeaf): CatalogEntry => registrationLeaf.catalogEntry);

    allCatalogEntries.sort((entry1: CatalogEntry, entry2: CatalogEntry): number => {
      return this.compareSemVers(entry1.version, entry2.version);
    });

    return allCatalogEntries;
  }

  private convertCatalogEntriesToPackageRow(catalogEntries: CatalogEntry[] | null, packageId: string, sourceUrl: string): PackageRowModel | null {
    if (catalogEntries === null) {
      return null;
    }

    // use the latest version to set the main fields of the package row model
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
    const filteredSearchResults = packageRowResults.filter((result: PackageRowModel | null) =>
      this.resultMatchesQuery(query, result)
    ) as PackageRowModel[];

    // sort the results alphabetically
    filteredSearchResults.sort((a: PackageRowModel, b: PackageRowModel) => {
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

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return true;
    }

    const trimmedLowerQuery = trimmedQuery.toLowerCase();
    const lowerId = result.id.toLowerCase();
    const lowerDescription = result.description.toLowerCase();

    return lowerId.includes(trimmedLowerQuery) || lowerDescription.includes(trimmedLowerQuery);
  }

  private getApiUrl(sourceUrl: string, requestHeaders: HttpHeaders, preferedEndpoints: string[]): Observable<string> {
    return this.http
      .get<ApiIndexResponse>(sourceUrl, {
        headers: requestHeaders,
      })
      .pipe(
        map((result: ApiIndexResponse): string => {
          let endpointToUse = '';
          for (const ep of preferedEndpoints) {
            const foundEndpoint = result.resources.find((apiResource: ApiResource): boolean => apiResource['@type'].startsWith(ep));
            if (foundEndpoint) {
              endpointToUse = foundEndpoint['@id'];
              break;
            }
          }
          return endpointToUse;
        })
      );
  }

  private compareSemVers(v1: string, v2: string): 0 | 1 | -1 {
    try {
      // try comparing the versions directly
      return rcompare(v1, v2, { includePrerelease: true, loose: true });
    } catch {
      // some versions do not respect the semver format, so coerce them and then compare
      const cleanV1 = coerce(v1);
      const cleanV2 = coerce(v2);
      // if was not able to extract a version just consider them equal as a fallback
      if (cleanV1 === null || cleanV2 === null) {
        return 0;
      }
      return rcompare(cleanV1, cleanV2, { includePrerelease: true, loose: true });
    }
  }

  private mapSearchResultsToPackageRows(
    packageSearchResults: PackageSearchResult[],
    sourceUrl: string,
    versions: CatalogEntry[] | undefined = undefined
  ): PackageRowModel[] {
    const packagesWithInstalledInfo = packageSearchResults.map((packageSearchResult: PackageSearchResult) => {
      const packageRowModel: PackageRowModel = {
        ...packageSearchResult,
        isInstalled: false,
        installedVersion: '',
        isOutdated: false,
        sourceUrl: sourceUrl,
        versions: versions,
      };
      return packageRowModel;
    });

    return packagesWithInstalledInfo;
  }

  private composeRequestHeaders(sourceAuthorizationHeader: string | undefined) {
    let headers = new HttpHeaders();
    if (sourceAuthorizationHeader) {
      headers = headers.append(this.AUTHORIZATION_HEADER, sourceAuthorizationHeader);
    }
    return headers;
  }
}
