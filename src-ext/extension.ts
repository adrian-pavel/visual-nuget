import * as vscode from 'vscode';
import UiPanel from './ui-panel';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('visualnuget.managepackages', (uri: vscode.Uri) => {
      const projectName = path.basename(uri.path);
      UiPanel.createOrShow(context.extensionPath, projectName);
    })
  );
}

export function deactivate() {}
