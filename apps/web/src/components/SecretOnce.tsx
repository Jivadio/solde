// SPDX-License-Identifier: AGPL-3.0-or-later
// A secret (invitation link, API token) the server returns only once.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { TextField } from './Fields';

interface SecretOnceProps {
  /** Omitted inside a dialog, whose title says it. */
  title?: string;
  label: string;
  value: string;
  children: ReactNode;
  onDone: () => void;
}

export function SecretOnce({
  title,
  label,
  value,
  children,
  onDone,
}: SecretOnceProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const field = useRef<HTMLInputElement>(null);
  // Inside a dialog the form is replaced by the secret: move focus to it,
  // so screen readers announce the new field (and the dialog title).
  useEffect(() => {
    if (!title) field.current?.focus();
  }, [title]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <div className="sd-secret">
      {title && (
        <p className="heading" role="status">
          {title}
        </p>
      )}
      <div className="body">{children}</div>
      <TextField
        ref={field}
        label={label}
        value={value}
        readOnly
        className="sd-input sd-secret__value"
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="sd-row">
        <Button variant="primary" icon="check" onClick={() => void copy()}>
          {t('common.copy')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.done')}
        </Button>
        <span className="caption sd-muted" aria-live="polite">
          {copied === 'done' && t('common.copied')}
          {copied === 'failed' && t('common.copyFailed')}
        </span>
      </div>
    </div>
  );
}
