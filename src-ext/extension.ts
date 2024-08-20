import * as vscode from 'vscode';
import * as quickPick from './services/quick-pick';

import UiPanel from './ui-panel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('visualnuget.managePackages', (uri: vscode.Uri) => {
      UiPanel.createOrShow(context.extensionPath, uri);
    }),
    vscode.commands.registerCommand('visualnuget.managePackagesPalette', async (uri: vscode.Uri) => {
      const projectFileUri = await quickPick.pickProjectFile();
      if (projectFileUri) {
        UiPanel.createOrShow(context.extensionPath, projectFileUri);
      }
    })
  );
}
