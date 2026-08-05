export type BuildRequestOrigin = 'command' | 'panel';

export interface BuildPreparationTasks {
  flushPanel(): Promise<void>;
  saveWorkspace(): Promise<void>;
  saveStore(): Promise<void>;
}

/**
 * A build message sent by the Webview is already ordered after its saveNote
 * messages by NotesPanel's serial message queue. Asking that same queue for a
 * flush acknowledgement would wait on itself and time out. Command-palette
 * builds are outside the queue and still need the explicit handshake.
 */
export async function prepareBuild(origin: BuildRequestOrigin, tasks: BuildPreparationTasks): Promise<void> {
  if (origin === 'command') {
    await tasks.flushPanel();
  }
  await tasks.saveWorkspace();
  await tasks.saveStore();
}
