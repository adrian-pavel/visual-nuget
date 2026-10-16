import SessionPackageCache from './session-package-cache';

describe('SessionPackageCache', () => {
  test('stores JSON values and distinguishes a miss from a cached null', () => {
    const cache = new SessionPackageCache();

    expect(cache.get('missing')).toBeUndefined();
    expect(cache.set('null-value', 'https://feed.example.test', 'package-data', 'null')).toBe(true);
    expect(cache.get('null-value')).toBe('null');
  });

  test('isolates cache keys by operation, feed and request parameters', () => {
    const cache = new SessionPackageCache();
    const key = (
      kind: 'package-search' | 'package-summary',
      sourceUrl = 'https://feed.example.test',
      parts: Array<string | boolean | number> = ['widget', false]
    ) => cache.createKey(kind, sourceUrl, 'test-credential', parts);
    const baseKey = key('package-search');

    expect(key('package-summary')).not.toBe(baseKey);
    expect(key('package-search', 'https://other-feed.example.test')).not.toBe(baseKey);
    expect(key('package-search', undefined, ['gadget', false])).not.toBe(baseKey);
    expect(key('package-search', undefined, ['widget', true])).not.toBe(baseKey);
  });

  test('deletes an entry without disturbing other cached entries', () => {
    const cache = new SessionPackageCache();
    cache.set('remove-me', 'https://feed.example.test', 'package-data', '[]');
    cache.set('keep-me', 'https://feed.example.test', 'package-data', '{}');

    cache.delete('remove-me');
    cache.delete('missing-key');

    expect(cache.get('remove-me')).toBeUndefined();
    expect(cache.get('keep-me')).toBe('{}');
  });

  test('scopes entries by authorization identity without embedding the raw credential', () => {
    const cache = new SessionPackageCache();
    const firstKey = cache.createKey('package-summary', 'https://feed.example.test', 'Bearer first-token', ['package.one', false]);
    const secondKey = cache.createKey('package-summary', 'https://feed.example.test', 'Bearer second-token', ['package.one', false]);

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).not.toContain('Bearer first-token');
  });

  test('evicts the least recently used entry when the entry limit is exceeded', () => {
    const cache = new SessionPackageCache();
    for (let index = 0; index < 1024; index++) {
      expect(cache.set(`key-${index}`, 'https://feed.example.test', 'package-data', JSON.stringify(index))).toBe(true);
    }

    expect(cache.get('key-0')).toBe('0');
    cache.set('newest', 'https://feed.example.test', 'package-data', '"new"');

    expect(cache.get('key-0')).toBe('0');
    expect(cache.get('key-1')).toBeUndefined();
    expect(cache.get('newest')).toBe('"new"');
  });

  test('evicts oldest entries when the aggregate byte budget is exceeded', () => {
    const cache = new SessionPackageCache();
    const largeValue = JSON.stringify('x'.repeat(900 * 1024));
    for (let index = 0; index < 38; index++) {
      expect(cache.set(`large-${index}`, 'https://feed.example.test', 'package-data', largeValue)).toBe(true);
    }

    expect(cache.get('large-0')).toBeUndefined();
    expect(cache.get('large-18')).toBe(largeValue);
  });

  test('retains package summaries and inventory alongside large version histories', () => {
    const cache = new SessionPackageCache();
    const sourceUrl = 'https://feed.example.test';
    const inventory = JSON.stringify({ packages: 'x'.repeat(584_300) });
    const history = JSON.stringify('x'.repeat(372_998));

    for (let index = 0; index < 546; index++) {
      cache.set(`summary-${index}`, sourceUrl, 'package-data', JSON.stringify({ id: `Package.${index}` }));
    }
    cache.set('inventory', sourceUrl, 'package-data', inventory);
    for (let index = 0; index < 50; index++) {
      cache.set(`history-${index}`, sourceUrl, 'package-data', history);
    }

    expect(cache.get('inventory')).toBe(inventory);
    expect(cache.get('summary-0')).toBe(JSON.stringify({ id: 'Package.0' }));
    expect(cache.get('summary-545')).toBe(JSON.stringify({ id: 'Package.545' }));
    expect(cache.get('history-0')).toBe(history);
    expect(cache.get('history-49')).toBe(history);
  });

  test('accepts values at the entry-size limit and rejects larger or malformed values', () => {
    const cache = new SessionPackageCache();
    const key = 'exact';
    const sourceUrl = 'https://feed.example.test';
    const maxEntryBytes = 8 * 1024 * 1024;
    const payloadBytes = maxEntryBytes - Buffer.byteLength(key) - Buffer.byteLength(sourceUrl);
    const exactValue = JSON.stringify('x'.repeat(payloadBytes - 2));
    const oversizedValue = JSON.stringify('x'.repeat(payloadBytes - 1));

    expect(cache.set(key, sourceUrl, 'package-data', exactValue)).toBe(true);
    expect(cache.set('oversized', sourceUrl, 'package-data', oversizedValue)).toBe(false);
    expect(cache.set('malformed', sourceUrl, 'package-data', '{not json')).toBe(false);
  });

  test('clears package data for one source while preserving its service index and other feeds', () => {
    const cache = new SessionPackageCache();
    cache.set('feed-one-search', 'https://one.example.test', 'package-data', '[]');
    cache.set('feed-one-index', 'https://one.example.test', 'service-index', '{"resources":[]}');
    cache.set('feed-two-search', 'https://two.example.test', 'package-data', '[]');

    cache.clearPackageData('https://one.example.test');

    expect(cache.get('feed-one-search')).toBeUndefined();
    expect(cache.get('feed-one-index')).toBe('{"resources":[]}');
    expect(cache.get('feed-two-search')).toBe('[]');
  });
});
