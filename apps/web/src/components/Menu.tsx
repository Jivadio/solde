// SPDX-License-Identifier: AGPL-3.0-or-later
// A menu button (WAI-ARIA menu button pattern): row actions, the member
// menu. Arrows, Home and End move between items, Esc closes and puts focus
// back on the button, Tab and a click outside close.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  /** Destructive: shown in `negative`, and must lead to a confirmation. */
  danger?: boolean;
}

interface MenuProps {
  /** Translated accessible name of the button ("More actions for …"). */
  label: string;
  items: MenuItem[];
  /** Visible content of the button; the `more` icon by default. */
  trigger?: ReactNode;
  /** The trigger shows text (a name): it names the button, not `label`. */
  triggerHasText?: boolean;
  triggerClassName?: string;
  /** Opens upwards (a menu at the bottom of the sidebar). */
  up?: boolean;
  /** Aligns the menu with the button's left edge instead of its right. */
  alignStart?: boolean;
}

export function Menu({
  label,
  items,
  trigger,
  triggerHasText = false,
  triggerClassName = 'sd-icon-button',
  up = false,
  alignStart = false,
}: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const show = (index: number) => {
    setFocusIndex(index);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      show(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      show(items.length - 1);
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const last = items.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: focusIndex === last ? 0 : focusIndex + 1,
      ArrowUp: focusIndex === 0 ? last : focusIndex - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setFocusIndex(moves[event.key] ?? 0);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="sd-menu" ref={wrapper}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={triggerHasText ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => (open ? setOpen(false) : show(0))}
        onKeyDown={onButtonKey}
      >
        {trigger ?? <Icon name="more" size={20} />}
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          className={[
            'sd-menu__list',
            up ? 'sd-menu__list--up' : '',
            alignStart ? 'sd-menu__list--start' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onKeyDown={onMenuKey}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === focusIndex ? 0 : -1}
              className={`sd-menu__item label${item.danger ? ' sd-menu__item--danger' : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
