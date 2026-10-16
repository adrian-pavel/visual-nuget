import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, from, map, mergeMap, Observable, of, shareReplay, switchMap, tap, throwError, toArray } from 'rxjs';
import { prerelease } from 'semver';

import { PackageSource } from '../../../src-common/models/package-source';
import { SessionCacheKeyPart, SessionCacheKind } from '../../../src-common/models/ui-message';
import { ApiIndexResponse, ApiResource } from '../models/api-index-response';
import { CatalogEntry, PackageMetaResponse, RegistrationLeaf, RegistrationPage } from '../models/package-meta';
import { PackageRowModel } from '../models/package-row-model';
import { PackageSearchResult, SearchResults } from '../models/search-results';
import { VscodeService } from './vscode.service';
import { VersionService } from './version.service';

type SessionCacheEntryKind = 'package-data' | 'service-index';

interface CacheParseResult {
  valid: boolean;
  value?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiIndexResponse(value: unknown): value is ApiIndexResponse {
  return (
    isRecord(value) &&
    Array.isArray(value['resources']) &&
    value['resources'].every(
      (resource: unknown) =>
        isRecord(resource) && typeof resource['@id'] === 'string' && typeof resource['@type'] === 'string'
    )
  );
}

function isPackageRowModel(value: unknown): value is PackageRowModel {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['version'] === 'string' &&
    typeof value['description'] === 'string' &&
    typeof value['iconUrl'] === 'string' &&
    typeof value['verified'] === 'boolean' &&
    typeof value['installedVersion'] === 'string' &&
    typeof value['isInstalled'] === 'boolean' &&
    typeof value['isOutdated'] === 'boolean' &&
    typeof value['sourceUrl'] === 'string' &&
    (value['authors'] === undefined ||
      typeof value['authors'] === 'string' ||
      (Array.isArray(value['authors']) && value['authors'].every((author: unknown) => typeof author === 'string'))) &&
    (value['versions'] === undefined || Array.isArray(value['versions']))
  );
}

function isPackageRowModels(value: unknown): value is PackageRowModel[] {
  return Array.isArray(value) && value.every(isPackageRowModel);
}

function isPackageRowModelOrNull(value: unknown): value is PackageRowModel | null {
  return value === null || isPackageRowModel(value);
}

@Injectable({
  providedIn: 'root',
})
export class NuGetApiService {
  private readonly metadataRequestConcurrency = 8;
  private readonly serviceIndexCache = new Map<string, Observable<ApiIndexResponse>>();
  private readonly packageSearchCache = new Map<string, Observable<PackageRowModel[]>>();
  private readonly packageSummaryCache = new Map<string, Observable<PackageRowModel | null>>();
  private readonly packageHistoryCache = new Map<string, Observable<PackageRowModel | null>>();

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

  constructor(private http: HttpClient, private versionService: VersionService, private vscodeService: VscodeService) {}

  public clearPackageCache(source: PackageSource): void {
    const sourceCachePrefix = `${JSON.stringify([source.url, source.authorizationHeader ?? '']).slice(0, -1)},`;
    [this.packageSearchCache, this.packageSummaryCache, this.packageHistoryCache].forEach((cache) => {
      Array.from(cache.keys())
        .filter((cacheKey) => cacheKey.startsWith(sourceCachePrefix))
        .forEach((cacheKey) => cache.delete(cacheKey));
    });
    this.vscodeService.clearSessionPackageCache(source.url);
  }

  public search(query: string, prerelease: boolean, source: PackageSource): Observable<PackageRowModel[]> {
    const cacheKey = JSON.stringify([source.url, source.authorizationHeader ?? '', query, prerelease]);
    const cachedSearch = this.packageSearchCache.get(cacheKey);
    if (cachedSearch) {
      return cachedSearch;
    }

    const requestHeaders = this.composeRequestHeaders(source.authorizationHeader);

    const searchRequest = this.useSessionCache(
      'package-search',
      source.url,
      source.authorizationHeader,
      [query, prerelease],
      'package-data',
      () =>
        this.getApiUrl(source.url, requestHeaders, this.searchQueryServiceEndpoints).pipe(
          switchMap((searchApiUrl: string) => this.executeSearch(query, prerelease, searchApiUrl, requestHeaders)),
          map((results: SearchResults) => this.mapSearchResultsToPackageRows(results.data, source.url))
        ),
      isPackageRowModels
    ).pipe(
      catchError((error: unknown) => {
        this.packageSearchCache.delete(cacheKey);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.packageSearchCache.set(cacheKey, searchRequest);
    return searchRequest;
  }

  public searchByPackageIds(
    packageIds: string[],
    query: string,
    prerelease: boolean,
    source: PackageSource,
    includeVersions = true
  ): Observable<PackageRowModel[]> {
    if (packageIds.length === 0) {
      return of([]);
    }

    const uniquePackageIds = Array.from(new Map(packageIds.map((packageId) => [packageId.toLowerCase(), packageId])).values());
    if (!includeVersions) {
      return this.searchPackageSummaries(uniquePackageIds, query, prerelease, source);
    }

    const requestHeaders = this.composeRequestHeaders(source.authorizationHeader);

    return this.getApiUrl(source.url, requestHeaders, this.registrationsBaseUrlEndpoints).pipe(
      switchMap((metaApiUrl: string) =>
        from(uniquePackageIds).pipe(
          mergeMap(
            (packageId) => this.getPackageHistory(packageId, prerelease, source, metaApiUrl, requestHeaders),
            this.metadataRequestConcurrency
          ),
          toArray(),
          map((results) => this.filterAndSortPackageRowResults(results, query))
        )
      )
    );
  }

  private searchPackageSummaries(
    packageIds: string[],
    query: string,
    prerelease: boolean,
    source: PackageSource
  ): Observable<PackageRowModel[]> {
    const normalizedPackageIds = packageIds.map((packageId) => packageId.toLowerCase()).sort();
    return this.useSessionCache(
      'package-inventory',
      source.url,
      source.authorizationHeader,
      [query, prerelease, ...normalizedPackageIds],
      'package-data',
      () =>
        from(packageIds).pipe(
          mergeMap((packageId) => this.getPackageSummary(packageId, prerelease, source), this.metadataRequestConcurrency),
          toArray(),
          map((results) => this.filterAndSortPackageRowResults(results, query))
        ),
      isPackageRowModels
    );
  }

  private getPackageSummary(packageId: string, includePrerelease: boolean, source: PackageSource): Observable<PackageRowModel | null> {
    const cacheKey = JSON.stringify([
      source.url,
      source.authorizationHeader ?? '',
      packageId.toLowerCase(),
      includePrerelease,
    ]);
    const cachedSummary = this.packageSummaryCache.get(cacheKey);
    if (cachedSummary) {
      return cachedSummary;
    }

    let searchEndpointAvailable = true;
    const summaryRequest = this.useSessionCache(
      'package-summary',
      source.url,
      source.authorizationHeader,
      [packageId.toLowerCase(), includePrerelease],
      'package-data',
      () =>
        this.searchSinglePackageSummary(packageId, includePrerelease, source).pipe(
          catchError((error: unknown) => {
            if (error instanceof Error && error.message.includes('does not provide a supported search endpoint')) {
              searchEndpointAvailable = false;
              return this.searchRegistrationSummary(packageId, includePrerelease, source);
            }
            return throwError(() => error);
          }),
          switchMap((summary) => {
            if (summary || includePrerelease) {
              return summary ? of(summary) : this.searchRegistrationSummary(packageId, includePrerelease, source);
            }

            const prereleaseSummaryRequest = searchEndpointAvailable
              ? this.searchSinglePackageSummary(packageId, true, source).pipe(
                  catchError((error: unknown) => {
                    if (error instanceof Error && error.message.includes('does not provide a supported search endpoint')) {
                      return of(null);
                    }
                    return throwError(() => error);
                  })
                )
              : of(null);

            return prereleaseSummaryRequest.pipe(
              switchMap((prereleaseSummary) => {
                if (prereleaseSummary) {
                  return prerelease(prereleaseSummary.version) !== null
                    ? of({ ...prereleaseSummary, version: '' })
                    : of(prereleaseSummary);
                }

                return this.searchRegistrationSummary(packageId, false, source).pipe(
                  switchMap((stableSummary) =>
                    stableSummary
                      ? of(stableSummary)
                      : this.searchRegistrationSummary(packageId, true, source).pipe(
                          map((prereleaseRegistration) =>
                            prereleaseRegistration && prerelease(prereleaseRegistration.version) !== null
                              ? { ...prereleaseRegistration, version: '' }
                              : prereleaseRegistration
                          )
                        )
                  )
                );
              })
            );
          })
        ),
      isPackageRowModelOrNull
    ).pipe(
      catchError((error: unknown) => {
        this.packageSummaryCache.delete(cacheKey);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.packageSummaryCache.set(cacheKey, summaryRequest);
    return summaryRequest;
  }

  private searchSinglePackageSummary(
    packageId: string,
    includePrerelease: boolean,
    source: PackageSource
  ): Observable<PackageRowModel | null> {
    const requestHeaders = this.composeRequestHeaders(source.authorizationHeader);
    return this.getApiUrl(source.url, requestHeaders, this.searchQueryServiceEndpoints).pipe(
      switchMap((searchApiUrl) =>
        this.executeSearch(`packageid:${packageId}`, includePrerelease, searchApiUrl, requestHeaders, 1).pipe(
          map((results) => {
            const packageResult = results.data.find((result) => result.id.toLowerCase() === packageId.toLowerCase());
            return packageResult ? this.mapSearchResultsToPackageRows([packageResult], source.url)[0] : null;
          })
        )
      )
    );
  }

  private searchRegistrationSummary(
    packageId: string,
    includePrerelease: boolean,
    source: PackageSource
  ): Observable<PackageRowModel | null> {
    return this.searchByPackageIds([packageId], '', includePrerelease, source).pipe(map((packages) => packages[0] ?? null));
  }

  private getPackageHistory(
    packageId: string,
    includePrerelease: boolean,
    source: PackageSource,
    metaApiUrl: string,
    requestHeaders: HttpHeaders
  ): Observable<PackageRowModel | null> {
    const cacheKey = JSON.stringify([
      source.url,
      source.authorizationHeader ?? '',
      packageId.toLowerCase(),
      includePrerelease,
    ]);
    const cachedHistory = this.packageHistoryCache.get(cacheKey);
    if (cachedHistory) {
      return cachedHistory;
    }

    const historyRequest = this.useSessionCache(
      'package-history',
      source.url,
      source.authorizationHeader,
      [packageId.toLowerCase(), includePrerelease],
      'package-data',
      () =>
        this.executeMetadataGets([packageId], '', includePrerelease, metaApiUrl, requestHeaders, source.url).pipe(
          map((packages) => packages[0] ?? null)
        ),
      isPackageRowModelOrNull
    ).pipe(
      catchError((error: unknown) => {
        this.packageHistoryCache.delete(cacheKey);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.packageHistoryCache.set(cacheKey, historyRequest);
    return historyRequest;
  }

  private executeSearch(
    query: string,
    prerelease: boolean,
    searchApiUrl: string,
    authHeaders: HttpHeaders,
    take?: number
  ): Observable<SearchResults> {
    const searchParams: Record<string, string | number | boolean> = {
      q: query,
      prerelease: prerelease,
      semVerLevel: this.VERSION200,
    };
    if (take !== undefined) {
      searchParams['take'] = take;
    }

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
    return from(packageIds).pipe(
      mergeMap((packageId) => {
        const metaApiFullUrl = new URL(`${packageId.toLowerCase()}/index.json`, metaApiUrl);

        return this.http
          .get<PackageMetaResponse>(metaApiFullUrl.toString(), {
            headers: authHeaders,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => (error.status === 404 ? of(null) : throwError(() => error))),
            switchMap((packageMeta: PackageMetaResponse | null): Observable<RegistrationLeaf[] | null> => {
              return this.getRegistrationLeafs(packageMeta, authHeaders);
            }),
            map((registrationLeafs: RegistrationLeaf[] | null): CatalogEntry[] | null => {
              return this.getFilteredAndSortedCatalogEntries(registrationLeafs, includePrerelease);
            }),
            map((catalogEntries: CatalogEntry[] | null): PackageRowModel | null => {
              return this.convertCatalogEntriesToPackageRow(catalogEntries, packageId, sourceUrl);
            })
          );
      }, this.metadataRequestConcurrency),
      toArray(),
      map((packageRowResults: (PackageRowModel | null)[]) => {
        return this.filterAndSortPackageRowResults(packageRowResults, query);
      })
    );
  }

  private getRegistrationLeafs(packageMeta: PackageMetaResponse | null, authHeaders: HttpHeaders): Observable<RegistrationLeaf[] | null> {
    if (packageMeta === null) {
      return of(null);
    }

    return from(packageMeta.items).pipe(
      mergeMap((page) => {
        if (page.items) {
          return of(page.items);
        }
        return this.http
          .get<RegistrationPage>(page['@id'], { headers: authHeaders })
          .pipe(map((registrationPage: RegistrationPage): RegistrationLeaf[] => registrationPage?.items ?? []));
      }, this.metadataRequestConcurrency),
      toArray(),
      map((results: RegistrationLeaf[][]): RegistrationLeaf[] => results.flat())
    );
  }

  private getFilteredAndSortedCatalogEntries(registrationLeafs: RegistrationLeaf[] | null, includePrerelease: boolean): CatalogEntry[] | null {
    if (registrationLeafs === null) {
      return null;
    }

    // registration leafs contain prerelease versions by default
    const prereleaseFilteredLeafs = includePrerelease
      ? registrationLeafs
      : registrationLeafs.filter(
          (registrationLeaf: RegistrationLeaf): boolean => prerelease(registrationLeaf.catalogEntry.version) === null
        );

    // filter out unlisted packages, compare with false explicitly since undefined means it's true/listed
    const filteredRegistrationLeafs = prereleaseFilteredLeafs.filter(
      (registrationLeaf: RegistrationLeaf): boolean => registrationLeaf.catalogEntry.listed !== false
    );

    const allCatalogEntries = filteredRegistrationLeafs.map((registrationLeaf: RegistrationLeaf): CatalogEntry => registrationLeaf.catalogEntry);

    allCatalogEntries.sort((entry1: CatalogEntry, entry2: CatalogEntry): number => {
      return this.versionService.compareSemVers(entry1.version, entry2.version);
    });

    return allCatalogEntries;
  }

  private convertCatalogEntriesToPackageRow(catalogEntries: CatalogEntry[] | null, packageId: string, sourceUrl: string): PackageRowModel | null {
    if (catalogEntries === null || catalogEntries.length === 0) {
      return null;
    }

    // use the latest version to set the main fields of the package row model
    const latestCatalogEntry = catalogEntries[0];

    const packageRow: PackageRowModel = {
      id: packageId,
      version: latestCatalogEntry.version,
      description: latestCatalogEntry.description ?? '',
      authors: latestCatalogEntry.authors,
      iconUrl: latestCatalogEntry.iconUrl ?? '',
      totalDownloads: undefined,
      verified: false,
      isInstalled: false,
      installedVersion: '',
      isOutdated: false,
      sourceUrl: sourceUrl,
      versions: catalogEntries,
      vulnerabilities: latestCatalogEntry.vulnerabilities,
      deprecation: latestCatalogEntry.deprecation,
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
    const lowerDescription = result.description?.toLowerCase() ?? '';

    return lowerId.includes(trimmedLowerQuery) || lowerDescription.includes(trimmedLowerQuery);
  }

  private useSessionCache<T>(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: SessionCacheKeyPart[],
    entryKind: SessionCacheEntryKind,
    request: () => Observable<T>,
    isCachedValue: (value: unknown) => value is T
  ): Observable<T> {
    const requestAndCache = () =>
      request().pipe(
        tap((value) => {
          const serialized = JSON.stringify(value);
          if (serialized === undefined) {
            throw new Error(`Could not serialize ${cacheKind} data for the session cache.`);
          }
          this.vscodeService.setSessionCache(cacheKind, sourceUrl, authorizationHeader, keyParts, entryKind, serialized);
        })
      );

    return this.vscodeService.getSessionCache(cacheKind, sourceUrl, authorizationHeader, keyParts).pipe(
      switchMap((serializedValue) => {
        if (serializedValue !== null) {
          const parsedValue = this.parseCacheValue(serializedValue);
          if (parsedValue.valid && isCachedValue(parsedValue.value)) {
            return of(parsedValue.value);
          }
          this.vscodeService.deleteSessionCache(cacheKind, sourceUrl, authorizationHeader, keyParts);
        }

        return requestAndCache();
      })
    );
  }

  private parseCacheValue(serializedValue: string): CacheParseResult {
    try {
      return { valid: true, value: JSON.parse(serializedValue) as unknown };
    } catch {
      return { valid: false };
    }
  }

  private getApiUrl(sourceUrl: string, requestHeaders: HttpHeaders, preferedEndpoints: string[]): Observable<string> {
    const authorizationHeader = requestHeaders.get(this.AUTHORIZATION_HEADER) ?? undefined;
    const cacheKey = JSON.stringify([sourceUrl, authorizationHeader ?? '']);
    let serviceIndexRequest = this.serviceIndexCache.get(cacheKey);
    if (!serviceIndexRequest) {
      serviceIndexRequest = this.useSessionCache(
        'service-index',
        sourceUrl,
        authorizationHeader,
        [],
        'service-index',
        () =>
          this.http.get<ApiIndexResponse>(sourceUrl, {
            headers: requestHeaders,
          }),
        isApiIndexResponse
      ).pipe(
          catchError((error: unknown) => {
            this.serviceIndexCache.delete(cacheKey);
            return throwError(() => error);
          }),
          shareReplay({ bufferSize: 1, refCount: false })
        );
      this.serviceIndexCache.set(cacheKey, serviceIndexRequest);
    }

    return serviceIndexRequest.pipe(
      map((result: ApiIndexResponse): string => {
          for (const ep of preferedEndpoints) {
            const foundEndpoint = result.resources.find((apiResource: ApiResource): boolean => apiResource['@type'].startsWith(ep));
            if (foundEndpoint) {
              return foundEndpoint['@id'];
            }
          }
          const resourceName = preferedEndpoints[0].startsWith(this.SEARCH_QUERY_SERVICE) ? 'search' : 'registration';
          throw new Error(`The package source does not provide a supported ${resourceName} endpoint.`);
      })
    );
  }

  private mapSearchResultsToPackageRows(
    packageSearchResults: PackageSearchResult[],
    sourceUrl: string,
    versions: CatalogEntry[] | undefined = undefined
  ): PackageRowModel[] {
    const packagesWithInstalledInfo = packageSearchResults.map((packageSearchResult: PackageSearchResult) => {
      const packageRowModel: PackageRowModel = {
        ...packageSearchResult,
        description: packageSearchResult.description ?? '',
        iconUrl: packageSearchResult.iconUrl ?? '',
        verified: packageSearchResult.verified ?? false,
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
