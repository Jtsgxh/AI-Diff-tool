/** VS Code 宿主与页面之间只允许明确的消息，页面不能执行任意宿主命令。 */
export type HostRequest =
  | { type: 'request'; id: number; path: string; method: 'GET' | 'POST'; body?: string }
  | { type: 'cancel'; id: number }
  | { type: 'openFile'; repoPath: string; filePath: string; revision?: string }
  | { type: 'storage'; key: string; value: string | null };

export type HostResponse =
  | { type: 'selectRevision'; repoPath: string; revision?: string }
  | { type: 'start'; id: number; status: number; headers: Record<string, string> }
  | { type: 'data'; id: number; data: string }
  | { type: 'end'; id: number }
  | { type: 'error'; id: number; error: string };

export interface HostBootstrap {
  repoPath?: string;
  revision?: string;
  storage: Record<string, string>;
}
