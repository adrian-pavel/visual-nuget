import { Injectable } from '@angular/core';
import { UIMessage } from '../../../src-common/models/ui-message';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

@Injectable({
  providedIn: 'root',
})
export class VscodeService {
  public postMessage(message: UIMessage) {
    vscode.postMessage(message);
  }

  public postMessages(messages: UIMessage[]) {
    messages.forEach((m) => this.postMessage(m));
  }
}
