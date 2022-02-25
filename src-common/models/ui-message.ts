export interface UIMessage {
  command: string;
}

export interface UninstallMessage extends UIMessage {
  projectName: string;
  packageId: string;
}

export interface InstallMessage extends UninstallMessage {
  packageVersion: string;
  packageSourceUrl: string;
}
