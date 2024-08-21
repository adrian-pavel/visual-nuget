import * as vscode from 'vscode';
import * as quickPick from './quick-pick';

describe('quick-pick', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle findFiles returning an array of URIs', async () => {
    // Arrange
    const pickedFile = vscode.Uri.file('/path/to/project1.csproj');
    const notPickedFile = vscode.Uri.file('/path/to/project2.csproj');
    const mockFiles = [pickedFile, notPickedFile];

    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'project1.csproj', uri: pickedFile });

    // Act
    const projectFileUri = await quickPick.pickProjectFile();

    // Assert
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.{csproj,vbproj,fsproj}', undefined, 32);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(projectFileUri).toBe(pickedFile);
  });

  it('should handle findFiles returning an array of URIs but user not picking any file', async () => {
    // Arrange
    const file1 = vscode.Uri.file('/path/to/project1.csproj');
    const file2 = vscode.Uri.file('/path/to/project2.csproj');
    const mockFiles = [file1, file2];

    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    // Act
    const projectFileUri = await quickPick.pickProjectFile();

    // Assert
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.{csproj,vbproj,fsproj}', undefined, 32);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(projectFileUri).toBeUndefined();
  });

  it('should handle findFiles returning an empty array', async () => {
    // Arrange
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

    // Act
    const projectFileUri = await quickPick.pickProjectFile();

    // Assert
    expect(vscode.workspace.findFiles).toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(projectFileUri).toBeUndefined();
  });
});
