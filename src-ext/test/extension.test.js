const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const extensionId = 'fullstackspider.visual-nuget';

suite('Visual NuGet extension host', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, `Expected extension ${extensionId} to be available`);
    await extension.activate();
  });

  test('registers package-management commands', async () => {
    const commands = await vscode.commands.getCommands(true);

    for (const command of [
      'visualnuget.managePackages',
      'visualnuget.managePackagesPalette',
      'visualnuget.manageSolutionPackages',
      'visualnuget.manageSolutionPackagesPalette',
    ]) {
      assert.ok(commands.includes(command), `Expected ${command} to be registered`);
    }
  });

  test('opens a project package-manager webview', async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    const projectUri = vscode.Uri.file(
      path.join(extension.extensionPath, 'src-ext', 'test-fixtures', 'cpm', 'CpmApp', 'CpmApp.csproj')
    );

    await vscode.commands.executeCommand('visualnuget.managePackages', projectUri);

    const webviewTab = await waitForPackageManagerWebviewTab('Visual NuGet: CpmApp.csproj');
    assert.ok(webviewTab, `Expected the project command to open its webview; tabs: ${getTabSummary()}`);
  });

  test('opens a solution package-manager webview', async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    const solutionUri = vscode.Uri.file(
      path.join(extension.extensionPath, 'src-ext', 'test-fixtures', 'cpm', 'CpmFixture.slnx')
    );

    await vscode.commands.executeCommand('visualnuget.manageSolutionPackages', solutionUri);

    const webviewTab = await waitForPackageManagerWebviewTab('Visual NuGet Solution: CpmFixture.slnx');
    assert.ok(webviewTab, `Expected the solution command to open its webview; tabs: ${getTabSummary()}`);
  });
});

async function waitForPackageManagerWebviewTab(label) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((candidate) => candidate.label === label && typeof candidate.input?.viewType === 'string');
    if (tab) {
      return tab;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

function getTabSummary() {
  return JSON.stringify(
    vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => ({ label: tab.label, viewType: tab.input?.viewType }))
    )
  );
}
