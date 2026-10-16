import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { VscodeService } from './vscode.service';

describe('VscodeService', () => {
  let service: VscodeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VscodeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  test('getSessionCache resolves only the response matching its request ID', async () => {
    const postMessage = jest.spyOn(service, 'postMessage').mockImplementation(() => {});
    const response = firstValueFrom(
      service.getSessionCache('package-search', 'https://feed.example.test', undefined, ['widget', false])
    );
    const request = postMessage.mock.calls[0]?.[0];

    expect(request).toMatchObject({
      command: 'session-cache-get',
      cacheKind: 'package-search',
      sourceUrl: 'https://feed.example.test',
      keyParts: ['widget', false],
    });
    if (request?.command !== 'session-cache-get' || !('requestId' in request)) {
      throw new Error('Expected a session cache request.');
    }

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'session-cache-result', data: { requestId: 'unrelated-request', value: 'wrong value' } },
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'session-cache-result', data: { requestId: request.requestId, value: 'cached value' } },
      })
    );

    await expect(response).resolves.toBe('cached value');
  });

  test('getSessionCache rejects explicit host errors', async () => {
    const postMessage = jest.spyOn(service, 'postMessage').mockImplementation(() => {});
    const response = firstValueFrom(
      service.getSessionCache('package-summary', 'https://feed.example.test', undefined, ['widget', false])
    );
    const request = postMessage.mock.calls[0]?.[0];

    if (request?.command !== 'session-cache-get' || !('requestId' in request)) {
      throw new Error('Expected a session cache request.');
    }
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'session-cache-error',
          data: { requestId: request.requestId, message: 'Cache lookup failed.' },
        },
      })
    );

    await expect(response).rejects.toThrow('Cache lookup failed.');
  });

  test('getSessionCache rejects and removes requests that time out', async () => {
    jest.useFakeTimers();
    const postMessage = jest.spyOn(service, 'postMessage').mockImplementation(() => {});
    const response = firstValueFrom(
      service.getSessionCache('package-history', 'https://feed.example.test', undefined, ['widget', false])
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'session-cache-get', cacheKind: 'package-history' })
    );
    jest.advanceTimersByTime(10000);

    await expect(response).rejects.toThrow('Timed out waiting for the package cache response.');
    jest.useRealTimers();
  });

  test('cache mutations post typed set, delete and clear messages', () => {
    const postMessage = jest.spyOn(service, 'postMessage').mockImplementation(() => {});

    service.setSessionCache('package-search', 'https://feed.example.test', undefined, ['widget', false], 'package-data', '[]');
    service.deleteSessionCache('package-summary', 'https://feed.example.test', undefined, ['widget', false]);
    service.clearSessionPackageCache('https://feed.example.test');

    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        command: 'session-cache-set',
        cacheKind: 'package-search',
        sourceUrl: 'https://feed.example.test',
        authorizationHeader: undefined,
        keyParts: ['widget', false],
        entryKind: 'package-data',
        value: '[]',
      },
      {
        command: 'session-cache-delete',
        cacheKind: 'package-summary',
        sourceUrl: 'https://feed.example.test',
        authorizationHeader: undefined,
        keyParts: ['widget', false],
      },
      { command: 'session-cache-clear', sourceUrl: 'https://feed.example.test' },
    ]);
  });

  test('unsubscribing from a cache lookup clears its timeout', () => {
    jest.useFakeTimers();
    jest.spyOn(service, 'postMessage').mockImplementation(() => {});

    const subscription = service.getSessionCache('package-search', 'https://feed.example.test', undefined, ['widget', false]).subscribe();
    expect(jest.getTimerCount()).toBe(1);

    subscription.unsubscribe();

    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
