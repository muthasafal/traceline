import { invoke, router, view } from '@forge/bridge';

export async function call<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await invoke(name, payload)) as T;
}

/** Opens Jira / Confluence links in the host product (new tab), since Custom UI runs in an iframe. */
export function openUrl(url: string) {
  router.open(url).catch(() => window.open(url, '_blank', 'noopener'));
}

export async function enableTheme() {
  try {
    await view.theme.enable();
  } catch {
    /* tokens fall back to light values */
  }
}

export function download(filename: string, bytes: Uint8Array | string, type: string) {
  const blob = new Blob([typeof bytes === "string" ? bytes : (bytes as Uint8Array<ArrayBuffer>)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
