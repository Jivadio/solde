// SPDX-License-Identifier: AGPL-3.0-or-later
// A modal dialog on the native <dialog> element: centred from the `md`
// breakpoint, a bottom sheet below it (CSS). `showModal()` makes the page
// behind inert, so focus stays inside; Esc and a click on the scrim close
// it, and focus goes back to whatever opened it.
//
// The dialog is mounted only while open, so its form starts fresh each
// time and closing is just unmounting.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One sentence under the title, read with it. */
  description?: ReactNode;
  /** A confirmation: announced as an `alertdialog`. */
  alert?: boolean;
  /** A request is running: Esc and the scrim do not close. */
  busy?: boolean;
  children: ReactNode;
}

/** Fields first, then the dialog's own buttons, then the close button. */
const AUTOFOCUS = [
  '[data-autofocus]',
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  'select:not([disabled])',
  'textarea:not([disabled])',
];

export function Dialog({ open, ...props }: DialogProps) {
  return open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({
  onClose,
  title,
  description,
  alert = false,
  busy = false,
  children,
}: Omit<DialogProps, 'open'>) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const state = useRef({ busy, onClose });
  useEffect(() => {
    state.current = { busy, onClose };
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // jsdom and very old browsers lack showModal: fall back to `open`.
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    const root = document.documentElement;
    root.classList.add('sd-modal-open');
    const first =
      AUTOFOCUS.map((s) => dialog.querySelector<HTMLElement>(s)).find(
        Boolean,
      ) ?? dialog.querySelector<HTMLElement>('.sd-dialog__close');
    first?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (!document.querySelector('dialog[open]')) {
        root.classList.remove('sd-modal-open');
      }
      // Back to the opener; if it is gone (a deleted row), to the content.
      const target =
        opener && opener.isConnected ? opener : document.getElementById('main');
      target?.focus();
    };
  }, []);

  const requestClose = () => {
    if (!state.current.busy) state.current.onClose();
  };

  return (
    // The handlers only catch Esc and clicks on the scrim; keyboard users
    // reach the dialog's own buttons.
    <dialog
      ref={ref}
      className="sd-dialog"
      role={alert ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event: SyntheticEvent) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }
      }}
      onClick={(event: MouseEvent) => {
        // The panel fills the dialog box: a click on the dialog element
        // itself landed on the scrim.
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="sd-dialog__panel">
        <div className="sd-dialog__header">
          <div className="sd-dialog__titles">
            <h2 id={`${id}-title`} className="heading">
              {title}
            </h2>
            {description && (
              <p id={`${id}-description`} className="body sd-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="sd-dialog__close sd-icon-button"
            aria-label={t('common.close')}
            onClick={requestClose}
            disabled={busy}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** The dialog's buttons: the primary action last. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="sd-dialog__footer">{children}</div>;
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What happens, and that it cannot be undone. */
  children: ReactNode;
  /** The irreversible action, as a verb + object ("Delete the token"). */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  /** The failure, shown in the dialog next to the action. */
  error?: ReactNode;
}

/** Asks before an irreversible action; focus starts on "Cancel". */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  error,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} busy={busy} alert>
      <div className="sd-dialog__body">
        {error}
        <div className="body">{children}</div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            data-autofocus
          >
            {cancelLabel}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
