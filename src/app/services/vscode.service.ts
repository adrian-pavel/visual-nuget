import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subscriber } from 'rxjs';
import { ExtensionMessage } from '../../../src-common/models/extension-message';
import { SessionCacheKeyPart, SessionCacheKind, UIMessage, WebviewMessage } from '../../../src-common/models/ui-message';

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();

@Injectable({
  providedIn: 'root',
})
export class VscodeService implements OnDestroy {
  private static readonly cacheRequestTimeoutMilliseconds = 10000;
  private readonly pendingCacheRequests = new Map<string, { subscriber: Subscriber<string | null>; timeout: number }>();
  private cacheRequestSequence = 0;
  private readonly messageHandler = (event: MessageEvent<ExtensionMessage>): void => {
    const message = event.data;
    if (!message || (message.type !== 'session-cache-result' && message.type !== 'session-cache-error')) {
      return;
    }

    const pendingRequest = this.pendingCacheRequests.get(message.data.requestId);
    if (!pendingRequest) {
      return;
    }

    this.pendingCacheRequests.delete(message.data.requestId);
    window.clearTimeout(pendingRequest.timeout);
    if (message.type === 'session-cache-result') {
      pendingRequest.subscriber.next(message.data.value);
      pendingRequest.subscriber.complete();
    } else {
      pendingRequest.subscriber.error(new Error(message.data.message));
    }
  };

  constructor() {
    window.addEventListener('message', this.messageHandler);
  }

  public postMessage(message: WebviewMessage) {
    vscode.postMessage(message);
  }

  public postMessages(messages: UIMessage[]) {
    messages.forEach((m) => this.postMessage(m));
  }

  public getSessionCache(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: SessionCacheKeyPart[]
  ): Observable<string | null> {
    return new Observable((subscriber) => {
      const requestId = `${Date.now()}-${++this.cacheRequestSequence}`;
      const timeout = window.setTimeout(() => {
        this.pendingCacheRequests.delete(requestId);
        subscriber.error(new Error('Timed out waiting for the package cache response.'));
      }, VscodeService.cacheRequestTimeoutMilliseconds);
      this.pendingCacheRequests.set(requestId, { subscriber, timeout });

      try {
        this.postMessage({ command: 'session-cache-get', requestId, cacheKind, sourceUrl, authorizationHeader, keyParts });
      } catch (error) {
        window.clearTimeout(timeout);
        this.pendingCacheRequests.delete(requestId);
        subscriber.error(error);
      }

      return () => {
        const pendingRequest = this.pendingCacheRequests.get(requestId);
        if (pendingRequest) {
          window.clearTimeout(pendingRequest.timeout);
          this.pendingCacheRequests.delete(requestId);
        }
      };
    });
  }

  public setSessionCache(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: SessionCacheKeyPart[],
    entryKind: 'package-data' | 'service-index',
    value: string
  ): void {
    this.postMessage({ command: 'session-cache-set', cacheKind, sourceUrl, authorizationHeader, keyParts, entryKind, value });
  }

  public deleteSessionCache(
    cacheKind: SessionCacheKind,
    sourceUrl: string,
    authorizationHeader: string | undefined,
    keyParts: SessionCacheKeyPart[]
  ): void {
    this.postMessage({ command: 'session-cache-delete', cacheKind, sourceUrl, authorizationHeader, keyParts });
  }

  public clearSessionPackageCache(sourceUrl: string): void {
    this.postMessage({ command: 'session-cache-clear', sourceUrl });
  }

  public ngOnDestroy(): void {
    window.removeEventListener('message', this.messageHandler);
    this.pendingCacheRequests.forEach((pendingRequest) => {
      window.clearTimeout(pendingRequest.timeout);
      pendingRequest.subscriber.error(new Error('The package cache bridge was disposed.'));
    });
    this.pendingCacheRequests.clear();
  }
}
