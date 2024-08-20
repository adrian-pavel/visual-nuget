import * as vscode from 'vscode';

const filesSearchPattern: string = `**/*.{csproj,vbproj,fsproj}`;

export async function pickProjectFile(): Promise<vscode.Uri | undefined> {
  console.log('Workspace Folders:', vscode.workspace.workspaceFolders);

  const projFiles = await vscode.workspace.findFiles(filesSearchPattern, undefined, 32);

  // If no supported files found, show an info message and return
  if (projFiles.length === 0) {
    vscode.window.showWarningMessage('No supported project files found in the current workspace.');
    return;
  }

  // Create a list of the file paths to show in the QuickPick menu
  const projFileItems = projFiles.map((uri) => ({
    label: vscode.workspace.asRelativePath(uri),
    uri: uri,
  }));

  // Show the QuickPick menu
  const selectedFile = await vscode.window.showQuickPick(projFileItems, {
    placeHolder: 'Select a project file',
    canPickMany: false,
  });

  // If a file was selected, show its path or perform an action
  if (selectedFile) {
    vscode.window.showInformationMessage(`You selected: ${selectedFile.label}`);
    return selectedFile.uri;
  }

  return;
}
