const vscode = {
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => p }),
    joinPath: (...args: { fsPath: string }[]) => ({ fsPath: args.map(a => a.fsPath).join('/') }),
  },
  workspace: {
    fs: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      delete: jest.fn(),
      stat: jest.fn(),
      createDirectory: jest.fn(),
    },
    openTextDocument: jest.fn(),
    applyEdit: jest.fn().mockResolvedValue(true),
  },
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInputBox: jest.fn(),
    showTextDocument: jest.fn(),
    activeTextEditor: undefined,
  },
  commands: {
    executeCommand: jest.fn(),
    registerCommand: jest.fn(),
  },
  extensions: {
    getExtension: jest.fn(),
  },
  WorkspaceEdit: jest.fn().mockImplementation(() => ({
    replace: jest.fn(),
    createFile: jest.fn(),
    insert: jest.fn(),
  })),
  Position: jest.fn().mockImplementation((line: number, char: number) => ({ line, character: char })),
  Range: jest.fn(),
  SecretStorage: jest.fn(),
  Memento: jest.fn(),
};

module.exports = vscode;
