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
      const tryGetRevision = (version: string): number => {
        const revision = version.split('.').map(Number).pop();
        return revision || 0;
      };

      const reverseCompareNumbers = (n1: number, n2: number): 0 | 1 | -1 => {
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

  public satisfiesVersionRange(version: string, versionRange: string | undefined): boolean {
    const range = versionRange?.trim();
    if (!range) {
      return true;
    }

    if (range.includes('*')) {
      if (version.includes('-') && !range.includes('-*')) {
        return false;
      }
      const pattern = range.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`, 'i').test(version);
    }

    const startsWithInclusive = range.startsWith('[');
    const startsWithExclusive = range.startsWith('(');
    const endsWithInclusive = range.endsWith(']');
    const endsWithExclusive = range.endsWith(')');
    if ((!startsWithInclusive && !startsWithExclusive) || (!endsWithInclusive && !endsWithExclusive)) {
      const comparison = this.compareForRange(version, range);
      return comparison !== null && comparison >= 0;
    }

    const bounds = range.slice(1, -1).split(',');
    if (bounds.length === 1) {
      const exactVersion = bounds[0].trim();
      return startsWithInclusive && endsWithInclusive && this.compareForRange(version, exactVersion) === 0;
    }
    if (bounds.length !== 2) {
      return false;
    }

    const lowerBound = bounds[0].trim();
    const upperBound = bounds[1].trim();
    if (lowerBound) {
      const comparison = this.compareForRange(version, lowerBound);
      if (comparison === null || comparison < 0 || (comparison === 0 && startsWithExclusive)) {
        return false;
      }
    }
    if (upperBound) {
      const comparison = this.compareForRange(version, upperBound);
      if (comparison === null || comparison > 0 || (comparison === 0 && endsWithExclusive)) {
        return false;
      }
    }

    return true;
  }

  private compareForRange(version: string, bound: string): number | null {
    if (version === bound) {
      return 0;
    }

    const comparison = this.compareSemVers(version, bound);
    if (comparison === 0 && (coerce(version) === null || coerce(bound) === null)) {
      return null;
    }

    return -comparison;
  }
}
