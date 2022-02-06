import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import WebviewMessageHandler from './webview-message-handler';

export default class UiPanel {
  public static currentPanels: Record<string, UiPanel | undefined> = {};

  private static readonly viewType = 'angular';

  private readonly panel: vscode.WebviewPanel;
  private readonly projectName: string;
  private readonly extensionPath: string;
  private readonly builtAppFolder: string;
  private readonly webviewMessageHandler: WebviewMessageHandler;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionPath: string, projectName: string) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (UiPanel.currentPanels[projectName]) {
      UiPanel.currentPanels[projectName]!.panel.reveal(column);
    } else {
      UiPanel.currentPanels[projectName] = new UiPanel(extensionPath, column || vscode.ViewColumn.One, projectName);
    }
    return UiPanel.currentPanels;
  }

  private constructor(extensionPath: string, column: vscode.ViewColumn, projectName: string) {
    this.extensionPath = extensionPath;
    this.builtAppFolder = 'dist';
    this.projectName = projectName;

    this.panel = vscode.window.createWebviewPanel(UiPanel.viewType, `Visual NuGet: ${projectName}`, column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, this.builtAppFolder))],
      retainContextWhenHidden: true,
    });

    this.panel.webview.html = this._getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // initialize the message handler for the communication between the webview and the extension
    this.webviewMessageHandler = new WebviewMessageHandler(this.panel.webview, this.projectName);
  }

  private dispose() {
    UiPanel.currentPanels[this.projectName] = undefined;

    this.webviewMessageHandler.dispose();

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getHtmlForWebview() {
    // path to dist folder
    const appDistPath = path.join(this.extensionPath, 'dist');
    const appDistPathUri = vscode.Uri.file(appDistPath);

    // path as uri
    const baseUri = this.panel.webview.asWebviewUri(appDistPathUri);

    // get path to index.html file from dist folder
    const indexPath = path.join(appDistPath, 'index.html');

    // read index file from file system
    let indexHtml = fs.readFileSync(indexPath, { encoding: 'utf8' });

    // update the base URI tag
    indexHtml = indexHtml.replace('<base href="/">', `<base href="${String(baseUri)}/">`);

    return indexHtml;
  }
}
