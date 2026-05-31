import * as vscode from 'vscode';

const SECRET_KEY = 'dispatch.apiKey';

export class SecretManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY);
  }

  async setApiKey(key: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, key);
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}
