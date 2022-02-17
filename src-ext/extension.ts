import * as vscode from 'vscode';

import UiPanel from './ui-panel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('visualnuget.managepackages', (uri: vscode.Uri) => {
      UiPanel.createOrShow(context.extensionPath, uri);
    })
  );
}

export function deactivate() {}
