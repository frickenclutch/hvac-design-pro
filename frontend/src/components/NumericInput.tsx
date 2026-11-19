import { useState, type InputHTMLAttributes } from 'react';
import { parseNumericText, numericTextMatches, formatNumericValue } from '../utils/numericText';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  /** Receives the parsed number, or NaN while the field is empty or mid-entry. */
  onChange: (value: number) => void;
};

/**
 * Number field that keeps what the user typed.
 *
 * The calculators used `onChange={e => onChange(Number(e.target.value))}` on a
 * controlled `type="number"` input. A browser reports '' for a half-typed
 * number such as "-" or ".", `Number('')` is 0, and React then rewrote the
 * field to "0" — so a cleared field silently became zero and a negative design
 * temperature could not be typed after clearing. Here the text is held locally
 * and only a complete number is passed up; anything else goes up as NaN, which
 * the calculators' input gates reject with a message instead of computing on a
 * zero nobody entered.
 */
export default function NumericInput({ value, onChange, inputMode, ...rest }: Props) {
  const [text, setText] = useState(() => formatNumericValue(value));
  const [seenValue, setSeenValue] = useState(value);

  // Adopt a value changed from outside (project switch, auto-fill, import)
  // unless it is just the echo of what is already typed.
  if (!Object.is(value, seenValue)) {
    setSeenValue(value);
    if (!numericTextMatches(text, value)) setText(formatNumericValue(value));
  }

  return (
    <input
      {...rest}
      type="number"
      inputMode={inputMode ?? 'decimal'}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parseNumericText(raw);
        onChange(parsed ?? Number.NaN);
      }}
    />
  );
}
