import * as vscode from 'vscode';

const RELEASES_URL = 'https://api.github.com/repos/radverth/dispatch/releases/latest';

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

async function downloadToTemp(url: string): Promise<string> {
  const os = await import('os');
  const path = await import('path');
  const tmpPath = path.join(os.tmpdir(), `dispatch-update-${Date.now()}.vsix`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const buffer = await response.arrayBuffer();
  const { workspace, Uri } = await import('vscode');
  await workspace.fs.writeFile(Uri.file(tmpPath), new Uint8Array(buffer));
  return tmpPath;
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    const { workspace, Uri } = await import('vscode');
    await workspace.fs.delete(Uri.file(filePath), { useTrash: false });
  } catch {
    // best effort
  }
}

async function installUpdate(vsixUrl: string): Promise<void> {
  let vsixPath: string | undefined;
  try {
    vsixPath = await downloadToTemp(vsixUrl);
    const vsixUri = vscode.Uri.file(vsixPath);
    await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri);
    const choice = await vscode.window.showInformationMessage(
      'Dispatch updated. Reload to apply.',
      'Reload',
    );
    if (choice === 'Reload') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch {
    vscode.window.showErrorMessage('Dispatch update failed. Please reinstall the extension.');
  } finally {
    if (vsixPath) await cleanupTempFile(vsixPath);
  }
}

function showUpdateNotification(vsixUrl: string): void {
  vscode.window.showInformationMessage(
    'A Dispatch update is available.',
    'Update',
    'Dismiss',
  ).then(choice => {
    if (choice === 'Update') installUpdate(vsixUrl);
  });
}

export type UpdateCheckResult = 'upToDate' | 'updateFound' | 'error';

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { 'User-Agent': 'dispatch-vscode-extension' },
    });
    if (!response.ok) return 'error';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const release: any = await response.json();
    const latestVersion: string = release.tag_name?.replace(/^v/, '') ?? '';
    if (!latestVersion || !semverGt(latestVersion, currentVersion)) return 'upToDate';

    const platformSuffix = process.platform === 'win32' ? 'win32-x64' : 'linux-x64';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsixAsset = release.assets?.find((a: any) =>
      a.name.endsWith('.vsix') && a.name.includes(platformSuffix),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) ?? release.assets?.find((a: any) => a.name.endsWith('.vsix'));

    if (!vsixAsset) return 'upToDate';

    showUpdateNotification(vsixAsset.browser_download_url as string);
    return 'updateFound';
  } catch {
    return 'error';
  }
}

export { semverGt };
