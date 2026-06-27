import { ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { RESERVED_UNTAGGED_TAG } from "../editorUtils";

const TAG_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

export function isValidTagName(tag: string, allowPseudoUntagged = false) {
  if (tag === RESERVED_UNTAGGED_TAG) return allowPseudoUntagged;
  return TAG_IDENTIFIER.test(tag);
}

export function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const tag of tags.map((value) => value.trim()).filter(Boolean)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
  }
  return next;
}

export interface TagTokenInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  allowCustom: boolean;
  allowPseudoUntagged?: boolean;
  className?: string;
  placeholder?: string;
  dataGridField?: number | string;
  dataGridRow?: number;
  onFocus?: () => void;
  onNavigateKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function TagTokenInput({
  allowCustom,
  allowPseudoUntagged = false,
  className,
  dataGridField,
  dataGridRow,
  onChange,
  onFocus,
  onNavigateKeyDown,
  placeholder,
  suggestions,
  value
}: TagTokenInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTokenIndex, setActiveTokenIndex] = useState<number | undefined>();
  const normalizedValue = useMemo(() => uniqueTags(value), [value]);
  const suggestionList = useMemo(() => {
    const next = uniqueTags([...(allowPseudoUntagged ? [RESERVED_UNTAGGED_TAG] : []), ...suggestions])
      .filter((tag) => isValidTagName(tag, allowPseudoUntagged))
      .sort((left, right) => left.localeCompare(right));
    return next;
  }, [allowPseudoUntagged, suggestions]);
  const suggestionSet = useMemo(() => new Set(suggestionList), [suggestionList]);
  const filteredSuggestions = useMemo(() => {
    const needle = draft.trim();
    return suggestionList
      .filter((tag) => !normalizedValue.includes(tag))
      .filter((tag) => !needle || tag.includes(needle));
  }, [draft, normalizedValue, suggestionList]);
  const canCommitDraft = canUseTag(draft.trim(), normalizedValue, suggestionSet, allowCustom, allowPseudoUntagged);
  const showMenu = focused && (menuOpen || draft.trim().length > 0) && filteredSuggestions.length > 0;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setFocused(false);
        setMenuOpen(false);
        setActiveTokenIndex(undefined);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const emit = (next: string[]) => {
    onChange(uniqueTags(next));
  };

  const addTag = (tag: string) => {
    const next = tag.trim();
    if (!canUseTag(next, normalizedValue, suggestionSet, allowCustom, allowPseudoUntagged)) return;
    emit([...normalizedValue, next]);
    setDraft("");
    setMenuOpen(false);
    setActiveTokenIndex(undefined);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeToken = (index: number) => {
    emit(normalizedValue.filter((_, tokenIndex) => tokenIndex !== index));
    setActiveTokenIndex(index > 0 ? index - 1 : undefined);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter") {
      onNavigateKeyDown?.(event);
      return;
    }

    if (event.key === "," || event.key === " ") {
      if (!canCommitDraft) return;
      event.preventDefault();
      addTag(draft);
      return;
    }

    if (event.key === "ArrowLeft") {
      if (activeTokenIndex !== undefined) {
        event.preventDefault();
        setActiveTokenIndex(Math.max(0, activeTokenIndex - 1));
        return;
      }
      if ((event.currentTarget.selectionStart ?? 0) === 0 && normalizedValue.length > 0) {
        event.preventDefault();
        setActiveTokenIndex(normalizedValue.length - 1);
      }
      return;
    }

    if (event.key === "ArrowRight") {
      if (activeTokenIndex === undefined) return;
      event.preventDefault();
      if (activeTokenIndex >= normalizedValue.length - 1) {
        setActiveTokenIndex(undefined);
        window.requestAnimationFrame(() => inputRef.current?.focus());
      } else {
        setActiveTokenIndex(activeTokenIndex + 1);
      }
      return;
    }

    if (event.key === "Backspace") {
      if (activeTokenIndex !== undefined) {
        event.preventDefault();
        removeToken(activeTokenIndex);
        return;
      }
      if (draft.length === 0 && normalizedValue.length > 0) {
        event.preventDefault();
        removeToken(normalizedValue.length - 1);
      }
    }
  };

  return (
    <div
      className={clsx("tag-token-input", className, focused && "is-focused", activeTokenIndex !== undefined && "has-active-token")}
      ref={rootRef}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="tag-token-scroll">
        {normalizedValue.map((tag, index) => (
          <button
            className={clsx("tag-token", activeTokenIndex === index && "active")}
            key={tag}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setActiveTokenIndex(index);
              inputRef.current?.focus();
            }}
          >
            <span>{tag}</span>
            <X
              size={11}
              onClick={(event) => {
                event.stopPropagation();
                removeToken(index);
              }}
            />
          </button>
        ))}
        <input
          data-grid-field={dataGridField}
          data-grid-row={dataGridRow}
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setActiveTokenIndex(undefined);
            setMenuOpen(false);
          }}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onKeyDown={handleKeyDown}
          placeholder={normalizedValue.length === 0 ? placeholder : undefined}
        />
      </div>
      <button
        className="tag-token-dropdown"
        tabIndex={-1}
        title="Show tags"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setFocused(true);
          setMenuOpen(!menuOpen);
          inputRef.current?.focus();
        }}
      >
        <ChevronDown size={13} />
      </button>
      {showMenu && (
        <div className="tag-token-menu">
          {filteredSuggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                addTag(tag);
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function canUseTag(
  tag: string,
  current: string[],
  suggestions: Set<string>,
  allowCustom: boolean,
  allowPseudoUntagged: boolean
) {
  if (!tag || current.includes(tag)) return false;
  if (!isValidTagName(tag, allowPseudoUntagged)) return false;
  if (tag === RESERVED_UNTAGGED_TAG) return allowPseudoUntagged;
  return allowCustom || suggestions.has(tag);
}
