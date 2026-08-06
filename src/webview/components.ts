export type CodiconName =
  | 'arrow-down' | 'arrow-left' | 'arrow-right' | 'arrow-up' | 'bold' | 'check' | 'chevron-down' | 'chevron-left'
  | 'close' | 'ellipsis' | 'filter' | 'go-to-file' | 'link-external' | 'list-filter'
  | 'list-unordered' | 'notebook' | 'paintcan' | 'pass' | 'plus' | 'quote' | 'refresh' | 'search' | 'settings-gear'
  | 'symbol-color' | 'symbol-operator' | 'table' | 'trash' | 'warning' | 'file-media';

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function elementWithText<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const node = element(tag, className);
  node.textContent = text;
  return node;
}

export function codicon(name: CodiconName): HTMLSpanElement {
  const icon = element('span', `codicon codicon-${name}`);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

export function actionButton(
  label: string,
  className: string,
  action: () => void,
  icon?: CodiconName
): HTMLButtonElement {
  const button = element('button', `button ${className}`);
  button.type = 'button';
  if (icon) {
    button.append(codicon(icon));
  }
  button.append(document.createTextNode(label));
  button.addEventListener('click', action);
  return button;
}

export function iconButton(name: CodiconName, title: string, action: () => void): HTMLButtonElement {
  const button = element('button', 'icon-button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(codicon(name));
  button.addEventListener('click', action);
  return button;
}

export function mustElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing Webview element #${id}`);
  }
  return value;
}

export function focusFirst(container: HTMLElement): void {
  container.querySelector<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
  )?.focus();
}

export function trapDialogFocus(dialog: HTMLElement, close: () => void): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
    )];
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', handler);
  return () => dialog.removeEventListener('keydown', handler);
}
