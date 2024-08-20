export const workspace = {
  findFiles: jest.fn(),
  asRelativePath: jest.fn(),
};

export const window = {
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showOpenDialog: jest.fn(),
  showQuickPick: jest.fn(),
};

export const Uri = {
  file: jest.fn((path: string) => {
    return {
      fsPath: path,
    };
  }),
};

export default {
  workspace,
  window,
  Uri,
};
