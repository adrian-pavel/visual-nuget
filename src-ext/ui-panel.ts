import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import WebviewMessageHandler from './services/webview-message-handler';
import SessionPackageCache from './services/session-package-cache';
import SessionSolutionCache from './services/session-solution-cache';

export default class UiPanel {
  public static currentPanels: Record<string, UiPanel | undefined> = {};

  private static readonly viewType = 'angular';

  private readonly panel: vscode.WebviewPanel;
  private readonly context: { type: 'project' | 'solution'; filePath: string };
  private readonly panelKey: string;
  private readonly extensionPath: string;
  private readonly builtAppFolder: string;
  private readonly webviewMessageHandler: WebviewMessageHandler;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionPath: string,
    resourceUri: vscode.Uri,
    sessionPackageCache: SessionPackageCache,
    sessionSolutionCache: SessionSolutionCache,
    type: 'project' | 'solution' = 'project',
    diagnosticOutput?: vscode.OutputChannel
  ) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    const filePath = resourceUri.fsPath;
    const panelKey = `${type}:${filePath}`;

    const existingPanel = UiPanel.currentPanels[panelKey];

    if (existingPanel) {
      existingPanel.panel.reveal(column);
    } else {
      UiPanel.currentPanels[panelKey] = new UiPanel(
        extensionPath,
        column || vscode.ViewColumn.One,
        { type, filePath, panelKey },
        sessionPackageCache,
        sessionSolutionCache,
        diagnosticOutput
      );
    }
    return UiPanel.currentPanels;
  }

  private constructor(
    extensionPath: string,
    column: vscode.ViewColumn,
    context: { type: 'project' | 'solution'; filePath: string; panelKey: string },
    sessionPackageCache: SessionPackageCache,
    sessionSolutionCache: SessionSolutionCache,
    diagnosticOutput?: vscode.OutputChannel
  ) {
    this.extensionPath = extensionPath;
    this.builtAppFolder = 'dist';
    this.context = context;
    this.panelKey = context.panelKey;

    const resourceName = path.basename(this.context.filePath);
    const title = this.context.type === 'solution' ? `Visual NuGet Solution: ${resourceName}` : `Visual NuGet: ${resourceName}`;
    this.panel = vscode.window.createWebviewPanel(UiPanel.viewType, title, column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, this.builtAppFolder))],
      retainContextWhenHidden: true,
    });

    this.panel.webview.html = this._getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // initialize the message handler for the communication between the webview and the extension
    this.webviewMessageHandler = new WebviewMessageHandler(
      this.panel.webview,
      { type: this.context.type, filePath: this.context.filePath },
      sessionPackageCache,
      sessionSolutionCache,
      (message) => diagnosticOutput?.appendLine(`[cache] ${message}`)
    );
  }

  private dispose() {
    UiPanel.currentPanels[this.panelKey] = undefined;

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
