import { Injectable } from '@angular/core';
import { coerce, rcompare } from 'semver';

@Injectable({
  providedIn: 'root',
})
export class VersionService {
  constructor() {}

  public compareSemVers(v1: string, v2: string): 0 | 1 | -1 {
    try {
      // try comparing the versions directly
      return rcompare(v1, v2, { loose: true });
    } catch {
      const tryGetRevision = (version: string): Number => {
        const revision = version.split('.').map(Number).pop();
        return revision || 0;
      };

      const reverseCompareNumbers = (n1: Number, n2: Number): 0 | 1 | -1 => {
        return n1 < n2 ? 1 : n1 > n2 ? -1 : 0;
      };

      // some versions do not respect the semver format, so coerce them and then compare
      const cleanV1 = coerce(v1);
      const cleanV2 = coerce(v2);

      // if was not able to extract a version just consider them equal as a fallback
      if (cleanV1 === null || cleanV2 === null) {
        return 0;
      }

      // try and extract a revision number from versions that look like this: 1.2.3.45
      const rev1 = tryGetRevision(v1);
      const rev2 = tryGetRevision(v2);

      return rcompare(cleanV1, cleanV2, { loose: true }) || reverseCompareNumbers(rev1, rev2);
    }
  }
}
