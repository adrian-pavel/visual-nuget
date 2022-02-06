import { Injectable } from '@angular/core';
import { SearchResults } from '../models/search-results';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map, Observable, switchMap } from 'rxjs';
import { PackageSource } from '../models/package-source';
import { ApiIndexResponse } from '../models/api-index-response';

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
      semVerKevek: '2.0.0',
    };

    return this.getSearchApiUrl(source, authHeaders).pipe(
      switchMap((searchApiUrl) =>
        this.http.get<SearchResults>(searchApiUrl, {
          headers: authHeaders,
          params: searchParams,
        })
      ),
      map((results) => {
        results.data.forEach((p) => p.versions.reverse());
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
