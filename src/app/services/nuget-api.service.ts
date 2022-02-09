import { Injectable } from '@angular/core';
import { SearchResults, Version } from '../models/search-results';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map, Observable, switchMap } from 'rxjs';
import { PackageSource } from '../models/package-source';
import { ApiIndexResponse } from '../models/api-index-response';
import { rcompare, coerce } from 'semver';

@Injectable({
  providedIn: 'root',
})
export class NuGetApiService {
  private SEARCH_QUERY_SERVICE: string = 'SearchQueryService';

  public static readonly nugetOrg: PackageSource = {
    name: 'nuget.org',
    url: 'https://api.nuget.org/v3/index.json',
    authorizationHeader: undefined,
  };

  constructor(private http: HttpClient) {}

  public search(query: string, prerelease: boolean, source: PackageSource): Observable<SearchResults> {
    let authHeaders = new HttpHeaders();
    if (source.authorizationHeader) {
      authHeaders = authHeaders.append('authorization', source.authorizationHeader);
    }

    const searchParams = {
      q: query,
      prerelease: prerelease,
      semVerLevel: '2.0.0',
    };

    return this.getSearchApiUrl(source, authHeaders).pipe(
      switchMap((searchApiUrl) =>
        this.http.get<SearchResults>(searchApiUrl, {
          headers: authHeaders,
          params: searchParams,
        })
      ),
      map((results) => {
        results.data.forEach((pdsr) =>
          pdsr.versions.sort((v1: Version, v2: Version) => {
            const cleanV1 = coerce(v1.version);
            const cleanV2 = coerce(v2.version);
            if (cleanV1 === null || cleanV2 === null) {
              return 0;
            }
            return rcompare(cleanV1, cleanV2, { includePrerelease: true, loose: true });
          })
        );
        return results;
      })
    );
  }

  private getSearchApiUrl(source: PackageSource, authHeaders: HttpHeaders): Observable<string> {
    return this.http
      .get<ApiIndexResponse>(source.url, {
        headers: authHeaders,
      })
      .pipe(
        map((result) => {
          return result.resources.find((r) => r['@type'].includes(this.SEARCH_QUERY_SERVICE))?.['@id']!;
        })
      );
  }
}
