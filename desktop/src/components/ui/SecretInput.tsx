import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './Field';

type SecretInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>;

/**
 * A PIN or password field: masked by default, with an eye to reveal what was
 * typed. The toggle is a button beside the field, so keyboard and screen-reader
 * users reach it the same way as the field itself.
 */
export const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(props, ref) {
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOff : Eye;
  return (
    <div className="ui-secret">
      <Input ref={ref} {...props} type={revealed ? 'text' : 'password'} />
      <button
        type="button"
        className="ui-secret__toggle"
        aria-label={revealed ? 'Hide PIN or password' : 'Show PIN or password'}
        aria-pressed={revealed}
        onClick={() => setRevealed((value) => !value)}
      >
        <Icon size={16} aria-hidden />
      </button>
    </div>
  );
});
