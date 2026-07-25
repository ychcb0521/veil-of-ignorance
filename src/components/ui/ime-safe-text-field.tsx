import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ControlledTextFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
};

type ImeSafeInputProps = ControlledTextFieldProps
  & Omit<React.ComponentProps<typeof Input>, 'defaultValue' | 'onChange' | 'value'>;

type ImeSafeTextareaProps = ControlledTextFieldProps
  & Omit<React.ComponentProps<typeof Textarea>, 'defaultValue' | 'onChange' | 'value'>;

function useImeSafeValue(value: string, onValueChange: (value: string) => void) {
  const [draft, setDraft] = React.useState(value);
  const composingRef = React.useRef(false);
  const committedRef = React.useRef(value);

  React.useEffect(() => {
    if (composingRef.current) return;
    committedRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = React.useCallback((next: string) => {
    if (committedRef.current === next) return;
    committedRef.current = next;
    onValueChange(next);
  }, [onValueChange]);

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = event.currentTarget.value;
    const nativeEvent = event.nativeEvent as InputEvent;
    setDraft(next);
    if (!composingRef.current && !nativeEvent.isComposing) {
      commit(next);
    }
  }, [commit]);

  const handleCompositionStart = React.useCallback(
    (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composingRef.current = true;
      setDraft(event.currentTarget.value);
    },
    [],
  );

  const handleCompositionEnd = React.useCallback(
    (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.currentTarget.value;
      composingRef.current = false;
      setDraft(next);
      commit(next);
    },
    [commit],
  );

  const handleBlur = React.useCallback(
    (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.currentTarget.value;
      composingRef.current = false;
      setDraft(next);
      commit(next);
    },
    [commit],
  );

  return {
    draft,
    handleBlur,
    handleChange,
    handleCompositionEnd,
    handleCompositionStart,
  };
}

export const ImeSafeInput = React.forwardRef<HTMLInputElement, ImeSafeInputProps>(
  (
    {
      value,
      onValueChange,
      onBlur,
      onCompositionEnd,
      onCompositionStart,
      inputMode = 'text',
      lang = 'zh-CN',
      ...props
    },
    ref,
  ) => {
    const ime = useImeSafeValue(value, onValueChange);

    return (
      <Input
        {...props}
        ref={ref}
        value={ime.draft}
        inputMode={inputMode}
        lang={lang}
        onChange={ime.handleChange}
        onCompositionStart={event => {
          ime.handleCompositionStart(event);
          onCompositionStart?.(event);
        }}
        onCompositionEnd={event => {
          ime.handleCompositionEnd(event);
          onCompositionEnd?.(event);
        }}
        onBlur={event => {
          ime.handleBlur(event);
          onBlur?.(event);
        }}
      />
    );
  },
);
ImeSafeInput.displayName = 'ImeSafeInput';

export const ImeSafeTextarea = React.forwardRef<HTMLTextAreaElement, ImeSafeTextareaProps>(
  (
    {
      value,
      onValueChange,
      onBlur,
      onCompositionEnd,
      onCompositionStart,
      inputMode = 'text',
      lang = 'zh-CN',
      ...props
    },
    ref,
  ) => {
    const ime = useImeSafeValue(value, onValueChange);

    return (
      <Textarea
        {...props}
        ref={ref}
        value={ime.draft}
        inputMode={inputMode}
        lang={lang}
        onChange={ime.handleChange}
        onCompositionStart={event => {
          ime.handleCompositionStart(event);
          onCompositionStart?.(event);
        }}
        onCompositionEnd={event => {
          ime.handleCompositionEnd(event);
          onCompositionEnd?.(event);
        }}
        onBlur={event => {
          ime.handleBlur(event);
          onBlur?.(event);
        }}
      />
    );
  },
);
ImeSafeTextarea.displayName = 'ImeSafeTextarea';
