import { workspace, window, Uri } from 'vscode';

const filesSearchPattern: string = `**/*.{csproj,vbproj,fsproj}`;
const solutionSearchPattern: string = `**/*.{sln,slnx}`;

export async function pickProjectFile(): Promise<Uri | undefined> {
  const projFiles = await workspace.findFiles(filesSearchPattern, undefined, 32);

  // If no supported files found, show an info message and return
  if (projFiles.length === 0) {
    window.showWarningMessage('No supported project files found in the current workspace.');
    return;
  }

  // Create a list of the file paths to show in the QuickPick menu
  const projFileItems = projFiles.map((uri) => ({
    label: workspace.asRelativePath(uri),
    uri: uri,
  }));

  // Show the QuickPick menu
  const selectedFile = await window.showQuickPick(projFileItems, {
    placeHolder: 'Select a project file',
    canPickMany: false,
  });

  // If a file was selected, show its path or perform an action
  if (selectedFile) {
    return selectedFile.uri;
  }

  window.showWarningMessage('You have not selected any valid project file!');
  return;
}

export async function pickSolutionFile(): Promise<Uri | undefined> {
  const solutionFiles = await workspace.findFiles(solutionSearchPattern, undefined, 64);
  if (solutionFiles.length === 0) {
    window.showWarningMessage('No solution files found in the current workspace.');
    return;
  }

  const selectedFile = await window.showQuickPick(
    solutionFiles.map((uri) => ({ label: workspace.asRelativePath(uri), uri })),
    { placeHolder: 'Select a solution file', canPickMany: false }
  );
  return selectedFile?.uri;
}
