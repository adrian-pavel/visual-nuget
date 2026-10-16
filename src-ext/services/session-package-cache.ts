import { createHash } from 'node:crypto';

import { SessionCacheKeyPart, SessionCacheKind } from '../../src-common/models/ui-message';

interface SessionCacheEntry {
  sourceUrl: string;
  kind: 'package-data' | 'service-index';
  value: string;
  byteLength: number;
}

export default class SessionPackageCache {
  private static readonly maxEntries = 1024;
  private static readonly maxBytes = 32 * 1024 * 1024;
  private static readonly maxEntryBytes = 8 * 1024 * 1024;
  private readonly entries = new Map<string, SessionCacheEntry>();
  private totalBytes = 0;

  public createKey(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: SessionCacheKeyPart[]
  ): string {
    const authorizationFingerprint = createHash('sha256').update(authorizationHeader ?? '').digest('hex');
    const identity = JSON.stringify(['nuget-session-cache-v1', cacheKind, sourceUrl, authorizationFingerprint, keyParts]);
    return `nuget-session-cache-v1:${createHash('sha256').update(identity).digest('hex')}`;
  }

  public get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public set(key: string, sourceUrl: string, kind: SessionCacheEntry['kind'], value: string): boolean {
    if (!key || !sourceUrl || Buffer.byteLength(key, 'utf8') > 4096) {
      return false;
    }

    try {
      JSON.parse(value);
    } catch {
      return false;
    }

    const byteLength =
      Buffer.byteLength(key, 'utf8') + Buffer.byteLength(sourceUrl, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (byteLength > SessionPackageCache.maxEntryBytes) {
      return false;
    }

    this.delete(key);
    this.entries.set(key, { sourceUrl, kind, value, byteLength });
    this.totalBytes += byteLength;
    this.evictToLimits();
    return this.entries.has(key);
  }

  public delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    this.entries.delete(key);
    this.totalBytes -= entry.byteLength;
  }

  public clearPackageData(sourceUrl: string): void {
    this.entries.forEach((entry, key) => {
      if (entry.sourceUrl === sourceUrl && entry.kind === 'package-data') {
        this.delete(key);
      }
    });
  }

  public clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evictToLimits(): void {
    while (
      this.entries.size > SessionPackageCache.maxEntries ||
      this.totalBytes > SessionPackageCache.maxBytes
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.delete(oldestKey);
    }
  }
}
