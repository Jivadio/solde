// SPDX-License-Identifier: AGPL-3.0-or-later
// Form fields. Each one has a visible label, and its hint or error is tied
// to the control with `aria-describedby`; errors set `aria-invalid`.
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Icon } from './Icon';

interface FieldFrameProps {
  id: string;
  label: ReactNode;
  optionalLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Keep the hint under the error (when it says where to find the value). */
  keepHint?: boolean;
  children: ReactNode;
}

function FieldFrame({
  id,
  label,
  optionalLabel,
  hint,
  error,
  keepHint = false,
  children,
}: FieldFrameProps) {
  return (
    <div className="sd-field">
      <label htmlFor={id} className="sd-field__label label">
        {label}
        {optionalLabel && (
          <span className="sd-field__optional"> {optionalLabel}</span>
        )}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="sd-field__error caption">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
      {hint && (!error || keepHint) && (
        <p id={`${id}-hint`} className="sd-field__hint caption">
          {hint}
        </p>
      )}
    </div>
  );
}

function describedBy(
  id: string,
  hint: unknown,
  error: unknown,
  keepHint = false,
) {
  const ids = [
    error ? `${id}-error` : '',
    hint && (!error || keepHint) ? `${id}-hint` : '',
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id'
> {
  label: ReactNode;
  /** Translated "(optional)" marker, for optional fields. */
  optionalLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
  keepHint?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { label, optionalLabel, hint, error, keepHint, ...input },
    ref,
  ) {
    const id = useId();
    return (
      <FieldFrame
        id={id}
        label={label}
        optionalLabel={optionalLabel}
        hint={hint}
        error={error}
        keepHint={keepHint}
      >
        <input
          ref={ref}
          id={id}
          className="sd-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error, keepHint)}
          {...input}
        />
      </FieldFrame>
    );
  },
);

interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id'
> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...select
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <Select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...select}
      >
        {children}
      </Select>
    </FieldFrame>
  );
}

/**
 * A bare select with the chevron icon, for places where the label is not
 * shown (a table row): give it a translated `aria-label`.
 */
export function Select({
  className,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="sd-select">
      <select
        className={['sd-input', className].filter(Boolean).join(' ')}
        {...select}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={18} className="sd-select__chevron" />
    </span>
  );
}

interface AmountFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'size'
> {
  label: ReactNode;
  /** Currency symbol or code shown before the digits, in ink-muted. */
  currencyLabel: string;
  hint?: ReactNode;
  error?: ReactNode;
  optionalLabel?: string;
}

/** Amount entry: 56px high, right-aligned `amount-lg` digits. */
export const AmountField = forwardRef<HTMLInputElement, AmountFieldProps>(
  function AmountField(
    { label, currencyLabel, hint, error, optionalLabel, ...input },
    ref,
  ) {
    const id = useId();
    return (
      <FieldFrame
        id={id}
        label={label}
        optionalLabel={optionalLabel}
        hint={hint}
        error={error}
      >
        <div
          className="sd-amount-input"
          data-invalid={error ? true : undefined}
        >
          <span className="sd-amount-input__currency label" aria-hidden="true">
            {currencyLabel}
          </span>
          <input
            ref={ref}
            id={id}
            className="amount-lg"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(id, hint, error)}
            {...input}
          />
        </div>
      </FieldFrame>
    );
  },
);

interface SegmentedControlProps<V extends string> {
  label: string;
  /** Show the label above the control instead of only to screen readers. */
  showLabel?: boolean;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
}

/** An exclusive choice between 2 to 4 options (`radiogroup`). */
export function SegmentedControl<V extends string>({
  label,
  showLabel = false,
  options,
  value,
  onChange,
}: SegmentedControlProps<V>) {
  const id = useId();
  return (
    <div className="sd-field">
      <span
        id={`${id}-label`}
        className={showLabel ? 'sd-field__label label' : 'sd-visually-hidden'}
      >
        {label}
      </span>
      <div
        className="sd-segmented"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
      >
        {options.map((option) => (
          <label key={option.value} className="sd-segmented__option">
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className="label">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
