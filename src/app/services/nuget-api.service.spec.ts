import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, delay } from 'rxjs';
import { performance } from 'node:perf_hooks';

import { PackageSource } from '../../../src-common/models/package-source';
import { SessionCacheKind } from '../../../src-common/models/ui-message';
import { ApiIndexResponse } from '../models/api-index-response';
import { CatalogEntry, PackageMetaResponse, RegistrationLeaf, RegistrationPage } from '../models/package-meta';
import { SearchResults } from '../models/search-results';
import SessionPackageCache from '../../../src-ext/services/session-package-cache';
import { NuGetApiService } from './nuget-api.service';
import { VscodeService } from './vscode.service';
import { VersionService } from './version.service';

@Injectable()
class TestSessionCacheBridge extends VscodeService {
  private readonly cache = new SessionPackageCache();
  public responseDelayMilliseconds = 0;

  public override getSessionCache(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: Array<string | boolean | number>
  ) {
    const cacheKey = this.cache.createKey(cacheKind, sourceUrl, authorizationHeader, keyParts);
    const value = this.cache.get(cacheKey) ?? null;
    return this.responseDelayMilliseconds === 0 ? of(value) : of(value).pipe(delay(this.responseDelayMilliseconds));
  }

  public override setSessionCache(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: Array<string | boolean | number>,
    entryKind: 'package-data' | 'service-index',
    value: string
  ): void {
    const cacheKey = this.cache.createKey(cacheKind, sourceUrl, authorizationHeader, keyParts);
    this.cache.set(cacheKey, sourceUrl, entryKind, value);
  }

  public override deleteSessionCache(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: Array<string | boolean | number>
  ): void {
    this.cache.delete(this.cache.createKey(cacheKind, sourceUrl, authorizationHeader, keyParts));
  }

  public override clearSessionPackageCache(sourceUrl: string): void {
    this.cache.clearPackageData(sourceUrl);
  }
}

describe('NuGetApiService', () => {
  let service: NuGetApiService;
  let http: HttpTestingController;
  let sessionCacheBridge: VscodeService;
  const source: PackageSource = {
    name: 'Private feed',
    url: 'https://packages.example.test/v3/index.json',
    authorizationHeader: 'Bearer test-token',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NuGetApiService,
        { provide: VscodeService, useClass: TestSessionCacheBridge },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(NuGetApiService);
    http = TestBed.inject(HttpTestingController);
    sessionCacheBridge = TestBed.inject(VscodeService);
  });

  afterEach(() => http.verify());

  test('search_prefersVersionedEndpoint_andMapsResultsFromTheSelectedSource', async () => {
    const result = firstValueFrom(service.search('widget', false, source));
    const indexRequest = http.expectOne(source.url);
    expect(indexRequest.request.headers.get('authorization')).toBe(source.authorizationHeader);
    indexRequest.flush(
      apiIndex([
        ['SearchQueryService', 'https://packages.example.test/v3/search/'],
        ['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/'],
      ])
    );

    const searchRequest = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(searchRequest.request.params.get('q')).toBe('widget');
    expect(searchRequest.request.params.get('prerelease')).toBe('false');
    expect(searchRequest.request.params.get('semVerLevel')).toBe('2.0.0');
    expect(searchRequest.request.headers.get('authorization')).toBe(source.authorizationHeader);
    searchRequest.flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '2.1.0',
          description: 'A widget package',
          authors: ['Ada'],
          iconUrl: 'https://packages.example.test/icon.png',
          totalDownloads: 42,
          verified: true,
          vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/widget', severity: 3 }],
          deprecation: {
            message: 'Use Widget.Next instead.',
            reasons: ['Legacy'],
            alternatePackage: { id: 'Widget.Next', range: '[2.0.0, )' },
          },
        },
      ],
    } satisfies SearchResults);

    await expect(result).resolves.toEqual([
      {
        id: 'Widget.Package',
        version: '2.1.0',
        description: 'A widget package',
        authors: ['Ada'],
        iconUrl: 'https://packages.example.test/icon.png',
        totalDownloads: 42,
        verified: true,
        isInstalled: false,
        installedVersion: '',
        isOutdated: false,
        sourceUrl: source.url,
        versions: undefined,
        vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/widget', severity: 3 }],
        deprecation: {
          message: 'Use Widget.Next instead.',
          reasons: ['Legacy'],
          alternatePackage: { id: 'Widget.Next', range: '[2.0.0, )' },
        },
      },
    ]);
  });

  test('search_fallsBackToSupportedEndpointVersions_andSendsPrereleaseFlag', async () => {
    const result = firstValueFrom(service.search('', true, source));
    http.expectOne(source.url).flush(
      apiIndex([
        ['SearchQueryService/3.5.0', 'https://packages.example.test/v3/search-350/'],
        ['SearchQueryService', 'https://packages.example.test/v3/search/'],
      ])
    );

    const searchRequest = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-350/');
    expect(searchRequest.request.params.get('prerelease')).toBe('true');
    searchRequest.flush({ totalHits: 0, data: [] } satisfies SearchResults);

    await expect(result).resolves.toEqual([]);
  });

  test('search_reusesCachedResultsUntilThePackageCacheIsCleared', async () => {
    const firstRequest = firstValueFrom(service.search('widget', false, source));
    http.expectOne(source.url).flush(apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']]));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '2.1.0', description: 'First result', totalDownloads: undefined }],
    } satisfies SearchResults);
    await firstRequest;

    await expect(firstValueFrom(service.search('widget', false, source))).resolves.toEqual([
      expect.objectContaining({ version: '2.1.0' }),
    ]);
    http.expectNone('https://packages.example.test/v3/search-versioned/');

    service.clearPackageCache(source);

    const refreshedRequest = firstValueFrom(service.search('widget', false, source));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '3.0.0', description: 'Refreshed result', totalDownloads: undefined }],
    } satisfies SearchResults);
    await expect(refreshedRequest).resolves.toEqual([expect.objectContaining({ version: '3.0.0' })]);
  });

  test('search_reusesSessionCachedResultsAcrossApiServiceInstances', async () => {
    const firstRequest = firstValueFrom(service.search('widget', false, source));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '2.1.0', description: 'Cached result', totalDownloads: undefined }],
    } satisfies SearchResults);
    await expect(firstRequest).resolves.toEqual([expect.objectContaining({ version: '2.1.0' })]);

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    await expect(firstValueFrom(reopenedService.search('widget', false, source))).resolves.toEqual([
      expect.objectContaining({ version: '2.1.0', description: 'Cached result' }),
    ]);
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/search-versioned/');
  });

  test('search_sessionCacheSeparatesQueryAndPrereleaseIdentity', async () => {
    const firstRequest = firstValueFrom(service.search('widget', false, source));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '2.1.0', description: 'Stable result', totalDownloads: undefined }],
    } satisfies SearchResults);
    await firstRequest;

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const differentQuery = firstValueFrom(reopenedService.search('gadget', false, source));
    const queryRequest = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(queryRequest.request.params.get('q')).toBe('gadget');
    expect(queryRequest.request.params.get('prerelease')).toBe('false');
    queryRequest.flush({ totalHits: 0, data: [] } satisfies SearchResults);
    await expect(differentQuery).resolves.toEqual([]);

    const prereleaseQuery = firstValueFrom(reopenedService.search('widget', true, source));
    const prereleaseRequest = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(prereleaseRequest.request.params.get('q')).toBe('widget');
    expect(prereleaseRequest.request.params.get('prerelease')).toBe('true');
    prereleaseRequest.flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '3.0.0-beta.1', description: 'Preview result', totalDownloads: undefined }],
    } satisfies SearchResults);
    await expect(prereleaseQuery).resolves.toEqual([expect.objectContaining({ version: '3.0.0-beta.1' })]);

    await expect(firstValueFrom(reopenedService.search('widget', false, source))).resolves.toEqual([
      expect.objectContaining({ version: '2.1.0', description: 'Stable result' }),
    ]);
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/search-versioned/');
  });

  test('search_doesNotCacheServiceIndexFailuresAcrossApiServiceInstances', async () => {
    const result = firstValueFrom(service.search('widget', false, source));
    http.expectOne(source.url).flush({ message: 'Feed unavailable' }, { status: 503, statusText: 'Service Unavailable' });

    await expect(result).rejects.toMatchObject({ status: 503 });
    http.expectNone('https://packages.example.test/v3/search/');

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const retry = firstValueFrom(reopenedService.search('widget', false, source));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 0,
      data: [],
    } satisfies SearchResults);
    await expect(retry).resolves.toEqual([]);
  });

  test('search_doesNotCacheFailedSearchResponsesAcrossApiServiceInstances', async () => {
    const result = firstValueFrom(service.search('widget', false, source));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush(
      { message: 'Search unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );
    await expect(result).rejects.toMatchObject({ status: 503 });

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const retry = firstValueFrom(reopenedService.search('widget', false, source));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 0,
      data: [],
    } satisfies SearchResults);
    await expect(retry).resolves.toEqual([]);
    http.expectNone(source.url);
  });

  test('search_withoutSupportedEndpoint_rejectsInsteadOfRequestingAnEmptyUrl', async () => {
    const result = firstValueFrom(service.search('widget', false, source));
    http.expectOne(source.url).flush(apiIndex([['PackagePublish/2.0.0', 'https://packages.example.test/publish/']]));

    await expect(result).rejects.toThrow('The package source does not provide a supported search endpoint.');
    http.expectNone('');
  });

  test('searchByPackageIds_withoutSupportedEndpoint_rejectsInsteadOfRequestingAnEmptyUrl', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source));
    http.expectOne(source.url).flush(apiIndex([['PackagePublish/2.0.0', 'https://packages.example.test/publish/']]));

    await expect(result).rejects.toThrow('The package source does not provide a supported registration endpoint.');
    http.expectNone('');
  });

  test('searchByPackageIds_serviceIndexFailurePropagatesWithoutCallingRegistration', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source));
    http.expectOne(source.url).flush({ message: 'Feed unavailable' }, { status: 503, statusText: 'Service Unavailable' });

    await expect(result).rejects.toMatchObject({ status: 503 });
    http.expectNone('https://packages.example.test/v3/registration/widget.package/index.json');
  });

  test('searchByPackageIds_usesInlineRegistrationAndFiltersVersions', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], 'widget', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    const metadataRequest = http.expectOne('https://packages.example.test/v3/registration/widget.package/index.json');
    expect(metadataRequest.request.headers.get('authorization')).toBe(source.authorizationHeader);
    metadataRequest.flush(
      registration([
        catalogEntry('1.0.0', { listed: false }),
        catalogEntry('1.1.0-beta.1'),
        catalogEntry('1.0.9'),
        catalogEntry('1.2.0', {
          vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/widget', severity: 2 }],
          deprecation: { reasons: ['Other'], message: 'Use Widget.Next instead.' },
        }),
      ])
    );

    const packages = await result;
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      id: 'Widget.Package',
      version: '1.2.0',
      sourceUrl: source.url,
      vulnerabilities: [{ advisoryUrl: 'https://advisories.example.test/widget', severity: 2 }],
      deprecation: { reasons: ['Other'], message: 'Use Widget.Next instead.' },
      versions: [expect.objectContaining({ version: '1.2.0' }), expect.objectContaining({ version: '1.0.9' })],
    });
  });

  test('searchByPackageIds_reusesPackageHistoryAcrossApiServiceInstances', async () => {
    const firstRequest = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', true, source));
    http.expectOne(source.url).flush(registrationIndex());
    http
      .expectOne('https://packages.example.test/v3/registration/widget.package/index.json')
      .flush(registration([catalogEntry('2.1.0-beta.1')]));

    await expect(firstRequest).resolves.toEqual([
      expect.objectContaining({
        id: 'Widget.Package',
        version: '2.1.0-beta.1',
        versions: [expect.objectContaining({ version: '2.1.0-beta.1' })],
      }),
    ]);

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    await expect(firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', true, source))).resolves.toEqual([
      expect.objectContaining({
        id: 'Widget.Package',
        version: '2.1.0-beta.1',
        versions: [expect.objectContaining({ version: '2.1.0-beta.1' })],
      }),
    ]);
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/registration/widget.package/index.json');
  });

  test('searchByPackageIds_canLoadPackageSummariesWithIconsWithoutRegistrationHistories', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([
        ['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/'],
        ['RegistrationsBaseUrl/Versioned', 'https://packages.example.test/v3/registration/'],
      ])
    );

    const searchRequest = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(searchRequest.request.params.get('q')).toBe('packageid:Widget.Package');
    expect(searchRequest.request.params.get('take')).toBe('1');
    expect(searchRequest.request.headers.get('authorization')).toBe(source.authorizationHeader);
    searchRequest.flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '2.1.0',
          description: 'A widget package',
          authors: ['Ada'],
          iconUrl: 'https://packages.example.test/widget.png',
          totalDownloads: 42,
        },
      ],
    } satisfies SearchResults);

    await expect(result).resolves.toEqual([
      expect.objectContaining({
        id: 'Widget.Package',
        version: '2.1.0',
        iconUrl: 'https://packages.example.test/widget.png',
        versions: undefined,
      }),
    ]);
    http.expectNone('https://packages.example.test/v3/registration/widget.package/index.json');
  });

  test('searchByPackageIds_sessionCacheSeparatesSummaryPackageIdAndPrereleaseIdentity', async () => {
    const firstRequest = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    const stableWidgetRequest = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(stableWidgetRequest.request.params.get('q')).toBe('packageid:Widget.Package');
    expect(stableWidgetRequest.request.params.get('prerelease')).toBe('false');
    stableWidgetRequest.flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '2.1.0', description: 'Stable widget', totalDownloads: undefined }],
    } satisfies SearchResults);
    await expect(firstRequest).resolves.toEqual([expect.objectContaining({ version: '2.1.0' })]);

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const otherPackageRequest = firstValueFrom(
      reopenedService.searchByPackageIds(['Other.Package'], '', false, source, false)
    );
    const otherPackageSearch = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(otherPackageSearch.request.params.get('q')).toBe('packageid:Other.Package');
    otherPackageSearch.flush({
      totalHits: 1,
      data: [{ id: 'Other.Package', version: '1.4.0', description: 'Other package', totalDownloads: undefined }],
    } satisfies SearchResults);
    await expect(otherPackageRequest).resolves.toEqual([expect.objectContaining({ version: '1.4.0' })]);

    const prereleaseRequest = firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', true, source, false));
    const prereleaseSearch = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(prereleaseSearch.request.params.get('q')).toBe('packageid:Widget.Package');
    expect(prereleaseSearch.request.params.get('prerelease')).toBe('true');
    prereleaseSearch.flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '3.0.0-beta.1', description: 'Preview widget', totalDownloads: undefined }],
    } satisfies SearchResults);
    await expect(prereleaseRequest).resolves.toEqual([expect.objectContaining({ version: '3.0.0-beta.1' })]);

    await expect(firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', false, source, false))).resolves.toEqual([
      expect.objectContaining({ version: '2.1.0', description: 'Stable widget' }),
    ]);
    http.expectNone('https://packages.example.test/v3/search-versioned/');
  });

  test('searchByPackageIds_reusesLargeInventorySnapshotAcrossApiServiceInstances', async () => {
    const packageIds = Array.from({ length: 520 }, (_, index) => `Widget.Package.${index.toString().padStart(4, '0')}`);
    const firstRequest = firstValueFrom(service.searchByPackageIds(packageIds, '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );

    let flushedRequests = 0;
    while (flushedRequests < packageIds.length) {
      const requests = http.match((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
      expect(requests.length).toBeGreaterThan(0);
      requests.forEach((request) => {
        const query = request.request.params.get('q');
        if (!query?.startsWith('packageid:')) {
          throw new Error('Expected a package summary query.');
        }
        const packageId = query.slice('packageid:'.length);
        request.flush({
          totalHits: 1,
          data: [{ id: packageId, version: '1.0.0', description: packageId, totalDownloads: undefined }],
        } satisfies SearchResults);
      });
      flushedRequests += requests.length;
    }

    const firstResults = await firstRequest;
    expect(firstResults.map((packageRow) => packageRow.id).sort()).toEqual([...packageIds].sort());

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const reopenedResults = await firstValueFrom(reopenedService.searchByPackageIds(packageIds, '', false, source, false));
    expect(reopenedResults.map((packageRow) => packageRow.id).sort()).toEqual([...packageIds].sort());
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/search-versioned/');
  });

  test('reports cold and reopened metadata timings while skipping feed requests on cache hit', async () => {
    const packageIds = ['Widget.Package'];
    const simulatedFeedDelayMs = 50;
    const coldStart = performance.now();
    const coldRequest = firstValueFrom(service.searchByPackageIds(packageIds, '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    await new Promise((resolve) => setTimeout(resolve, simulatedFeedDelayMs));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '2.1.0', description: 'A widget package', totalDownloads: undefined }],
    } satisfies SearchResults);
    const coldResults = await coldRequest;
    const coldElapsedMs = performance.now() - coldStart;

    const testCacheBridge = sessionCacheBridge as TestSessionCacheBridge;
    testCacheBridge.responseDelayMilliseconds = 5;
    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), testCacheBridge);
    const reopenedStart = performance.now();
    const reopenedResults = await firstValueFrom(reopenedService.searchByPackageIds(packageIds, '', false, source, false));
    const reopenedElapsedMs = performance.now() - reopenedStart;

    expect(coldResults).toEqual([expect.objectContaining({ id: 'Widget.Package', version: '2.1.0' })]);
    expect(reopenedResults).toEqual(coldResults);
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/search-versioned/');
    expect(Number.isFinite(coldElapsedMs)).toBe(true);
    expect(Number.isFinite(reopenedElapsedMs)).toBe(true);
    console.info(
      `[Visual NuGet timing] package metadata: initial=${coldElapsedMs.toFixed(1)}ms ` +
        `(includes ${simulatedFeedDelayMs}ms simulated feed delay), reopen=${reopenedElapsedMs.toFixed(1)}ms ` +
        '(simulated 5ms host-cache bridge delay; no feed requests)'
    );
  });

  test('searchByPackageIds_reusesPackageSummariesAndTheFeedServiceIndex', async () => {
    const summaryRequest = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '2.1.0',
          description: 'A widget package',
          iconUrl: 'widget.png',
          totalDownloads: undefined,
        },
      ],
    } satisfies SearchResults);

    await expect(summaryRequest).resolves.toEqual([expect.objectContaining({ id: 'Widget.Package', version: '2.1.0' })]);

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    await expect(firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', false, source, false))).resolves.toEqual([
      expect.objectContaining({ id: 'Widget.Package', version: '2.1.0' }),
    ]);
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/search-versioned/');
  });

  test('clearPackageCache_forcesPackageSummariesToBeFetchedAgain', async () => {
    const firstRequest = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']]));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '2.1.0', description: 'First result', totalDownloads: undefined }],
    } satisfies SearchResults);
    await firstRequest;

    service.clearPackageCache(source);

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const refreshedRequest = firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [{ id: 'Widget.Package', version: '3.0.0', description: 'Refreshed result', totalDownloads: undefined }],
    } satisfies SearchResults);

    await expect(refreshedRequest).resolves.toEqual([expect.objectContaining({ version: '3.0.0', description: 'Refreshed result' })]);
  });

  test('searchByPackageIds_doesNotShareCachedSummariesAcrossAuthorizationHeaders', async () => {
    const firstRequest = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    const firstIndex = http.expectOne(source.url);
    expect(firstIndex.request.headers.get('authorization')).toBe(source.authorizationHeader);
    firstIndex.flush(apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']]));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '2.1.0',
          description: 'A widget package',
          iconUrl: 'widget.png',
          totalDownloads: undefined,
        },
      ],
    } satisfies SearchResults);
    await firstRequest;

    const otherSource = { ...source, authorizationHeader: 'Bearer another-user' };
    const otherSourceForRequest = { ...otherSource, authorizationHeader: 'Bearer different-test-credential' };
    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const secondRequest = firstValueFrom(
      reopenedService.searchByPackageIds(['Widget.Package'], '', false, otherSourceForRequest, false)
    );
    const secondIndex = http.expectOne(source.url);
    expect(secondIndex.request.headers.get('authorization')).toBe(otherSourceForRequest.authorizationHeader);
    secondIndex.flush(apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']]));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '3.0.0',
          description: 'A widget package',
          iconUrl: 'widget.png',
          totalDownloads: undefined,
        },
      ],
    } satisfies SearchResults);

    await expect(secondRequest).resolves.toEqual([expect.objectContaining({ version: '3.0.0' })]);
  });

  test('searchByPackageIds_retriesAfterSummaryRequestFailure', async () => {
    const failedRequest = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush(
      { message: 'Search failed' },
      { status: 503, statusText: 'Service Unavailable' }
    );
    await expect(failedRequest).rejects.toMatchObject({ status: 503 });

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const retryRequest = firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/').flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '2.1.0',
          description: 'A widget package',
          iconUrl: 'widget.png',
          totalDownloads: undefined,
        },
      ],
    } satisfies SearchResults);
    await expect(retryRequest).resolves.toEqual([expect.objectContaining({ version: '2.1.0' })]);
    http.expectNone(source.url);
  });

  test('searchByPackageIds_returnsPrereleaseOnlyIconWithoutUsingItAsAStableVersion', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(
      apiIndex([['SearchQueryService/Versioned', 'https://packages.example.test/v3/search-versioned/']])
    );

    const stableSearch = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(stableSearch.request.params.get('prerelease')).toBe('false');
    stableSearch.flush({ totalHits: 0, data: [] } satisfies SearchResults);

    const prereleaseSearch = http.expectOne((request) => request.url === 'https://packages.example.test/v3/search-versioned/');
    expect(prereleaseSearch.request.params.get('prerelease')).toBe('true');
    prereleaseSearch.flush({
      totalHits: 1,
      data: [
        {
          id: 'Widget.Package',
          version: '2.1.0-beta.1',
          description: 'A prerelease-only package',
          iconUrl: 'https://packages.example.test/widget.png',
          totalDownloads: undefined,
        },
      ],
    } satisfies SearchResults);

    await expect(result).resolves.toEqual([
      expect.objectContaining({
        id: 'Widget.Package',
        version: '',
        iconUrl: 'https://packages.example.test/widget.png',
      }),
    ]);
    http.expectNone(source.url);
    http.expectNone('https://packages.example.test/v3/registration/widget.package/index.json');
  });

  test('searchByPackageIds_fallsBackToRegistrationWhenSearchIsUnavailable', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source, false));
    http.expectOne(source.url).flush(registrationIndex());

    const registrationRequest = http.expectOne('https://packages.example.test/v3/registration/widget.package/index.json');
    registrationRequest.flush(registration([catalogEntry('2.1.0', { iconUrl: 'https://packages.example.test/widget.png' })]));

    await expect(result).resolves.toEqual([
      expect.objectContaining({
        id: 'Widget.Package',
        iconUrl: 'https://packages.example.test/widget.png',
        versions: expect.arrayContaining([expect.objectContaining({ version: '2.1.0' })]),
      }),
    ]);
  });

  test('searchByPackageIds_fetchesPagedRegistrationWithAuthorization', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', true, source));
    http.expectOne(source.url).flush(registrationIndex());
    http
      .expectOne('https://packages.example.test/v3/registration/widget.package/index.json')
      .flush({
        count: 1,
        items: [{ '@id': 'https://packages.example.test/v3/registration/widget.package/page.json', count: 1, items: undefined }],
      } satisfies PackageMetaResponse);

    const pageRequest = http.expectOne('https://packages.example.test/v3/registration/widget.package/page.json');
    expect(pageRequest.request.headers.get('authorization')).toBe(source.authorizationHeader);
    pageRequest.flush({
      '@id': 'https://packages.example.test/v3/registration/widget.package/page.json',
      count: 1,
      items: [registrationLeaf(catalogEntry('3.0.0-beta.1'))],
    } satisfies RegistrationPage);

    await expect(result).resolves.toEqual([
      expect.objectContaining({
        id: 'Widget.Package',
        version: '3.0.0-beta.1',
        versions: [expect.objectContaining({ version: '3.0.0-beta.1' })],
      }),
    ]);
  });

  test('searchByPackageIds_doesNotCacheFailedHistoryAcrossApiServiceInstances', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], '', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    http
      .expectOne('https://packages.example.test/v3/registration/widget.package/index.json')
      .flush({
        count: 1,
        items: [{ '@id': 'https://packages.example.test/v3/registration/widget.package/page.json', count: 1, items: undefined }],
      } satisfies PackageMetaResponse);
    http.expectOne('https://packages.example.test/v3/registration/widget.package/page.json').flush(
      { message: 'Gateway failure' },
      { status: 502, statusText: 'Bad Gateway' }
    );

    await expect(result).rejects.toMatchObject({ status: 502 });

    const reopenedService = new NuGetApiService(TestBed.inject(HttpClient), TestBed.inject(VersionService), sessionCacheBridge);
    const retry = firstValueFrom(reopenedService.searchByPackageIds(['Widget.Package'], '', false, source));
    http
      .expectOne('https://packages.example.test/v3/registration/widget.package/index.json')
      .flush(registration([catalogEntry('2.1.0')]));
    await expect(retry).resolves.toEqual([
      expect.objectContaining({ id: 'Widget.Package', version: '2.1.0' }),
    ]);
    http.expectNone(source.url);
  });

  test('searchByPackageIds_emptyPagedRegistrationPageReturnsNoPackages', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Empty.Page.Package'], '', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    http
      .expectOne('https://packages.example.test/v3/registration/empty.page.package/index.json')
      .flush({
        count: 1,
        items: [
          {
            '@id': 'https://packages.example.test/v3/registration/empty.page.package/page.json',
            count: 1,
            items: undefined,
          },
        ],
      } satisfies PackageMetaResponse);
    http
      .expectOne('https://packages.example.test/v3/registration/empty.page.package/page.json')
      .flush({
        '@id': 'https://packages.example.test/v3/registration/empty.page.package/page.json',
        count: 1,
        items: undefined,
      } satisfies RegistrationPage);

    await expect(result).resolves.toEqual([]);
  });

  test('searchByPackageIds_limitsConcurrentPackageMetadataRequests', async () => {
    const packageIds = Array.from({ length: 9 }, (_, index) => `Package${index}`);
    const result = firstValueFrom(service.searchByPackageIds(packageIds, '', false, source));
    http.expectOne(source.url).flush(registrationIndex());

    const firstBatch = http.match((request) => request.url.endsWith('/index.json'));
    expect(firstBatch).toHaveLength(8);
    firstBatch.forEach((request) => request.flush({ count: 0, items: [] } satisfies PackageMetaResponse));

    const finalBatch = http.match((request) => request.url.endsWith('/index.json'));
    expect(finalBatch).toHaveLength(1);
    finalBatch[0].flush({ count: 0, items: [] } satisfies PackageMetaResponse);

    await expect(result).resolves.toEqual([]);
  });

  test('searchByPackageIds_returnsEmptyForNoIdsOrEmptyRegistration', async () => {
    await expect(firstValueFrom(service.searchByPackageIds([], '', false, source))).resolves.toEqual([]);
    http.expectNone(source.url);

    const result = firstValueFrom(service.searchByPackageIds(['Empty.Package'], '', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    http
      .expectOne('https://packages.example.test/v3/registration/empty.package/index.json')
      .flush({ count: 0, items: [] } satisfies PackageMetaResponse);

    await expect(result).resolves.toEqual([]);
  });

  test('searchByPackageIds_ignoresNotFoundPackagesButPropagatesFeedFailures', async () => {
    const missingResult = firstValueFrom(service.searchByPackageIds(['Missing.Package'], '', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    http.expectOne('https://packages.example.test/v3/registration/missing.package/index.json').flush(
      { message: 'Not found' },
      { status: 404, statusText: 'Not Found' }
    );
    await expect(missingResult).resolves.toEqual([]);

    const failedResult = firstValueFrom(service.searchByPackageIds(['Unavailable.Package'], '', false, source));
    http.expectOne('https://packages.example.test/v3/registration/unavailable.package/index.json').flush(
      { message: 'Service unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );
    await expect(failedResult).rejects.toMatchObject({ status: 503 });
  });

  test('searchByPackageIds_usesQueryAgainstPackageIdAndDescription', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Other.Package', 'Widget.Package'], 'widget', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    const otherMetadata = http.expectOne('https://packages.example.test/v3/registration/other.package/index.json');
    const widgetMetadata = http.expectOne('https://packages.example.test/v3/registration/widget.package/index.json');
    otherMetadata.flush(registration([catalogEntry('1.0.0', { description: 'A library for strings' })]));
    widgetMetadata.flush(registration([catalogEntry('1.0.0', { description: 'Widget support' })]));

    await expect(result).resolves.toEqual([
      expect.objectContaining({ id: 'Widget.Package', description: 'Widget support' }),
    ]);
  });

  test('searchByPackageIds_keepsPackagesWithMissingDescriptionsAndFiltersById', async () => {
    const result = firstValueFrom(service.searchByPackageIds(['Widget.Package'], 'widget', false, source));
    http.expectOne(source.url).flush(registrationIndex());
    http
      .expectOne('https://packages.example.test/v3/registration/widget.package/index.json')
      .flush(registration([catalogEntry('1.0.0', { description: undefined })]));

    await expect(result).resolves.toEqual([
      expect.objectContaining({ id: 'Widget.Package', description: '' }),
    ]);
  });
});

function apiIndex(resources: [string, string][]): ApiIndexResponse {
  return { resources: resources.map(([type, id]) => ({ '@type': type, '@id': id })) };
}

function registrationIndex(): ApiIndexResponse {
  return apiIndex([['RegistrationsBaseUrl/Versioned', 'https://packages.example.test/v3/registration/']]);
}

function registration(entries: CatalogEntry[]): PackageMetaResponse {
  return {
    count: 1,
    items: [
      {
        '@id': 'https://packages.example.test/v3/registration/package/page.json',
        count: entries.length,
        items: entries.map(registrationLeaf),
      },
    ],
  };
}

function registrationLeaf(entry: CatalogEntry): RegistrationLeaf {
  return {
    '@id': `https://packages.example.test/v3/registration/package/${entry.version}.json`,
    catalogEntry: entry,
  };
}

function catalogEntry(
  version: string,
  overrides: Partial<CatalogEntry> = {}
): CatalogEntry {
  return {
    '@id': `https://packages.example.test/v3/catalog/package/${version}.json`,
    id: 'Widget.Package',
    version,
    description: 'A useful package',
    authors: ['Ada'],
    iconUrl: '',
    licenseUrl: '',
    projectUrl: '',
    tags: [],
    dependencyGroups: [],
    published: '2025-01-01T00:00:00Z',
    listed: true,
    vulnerabilities: undefined,
    ...overrides,
  };
}
