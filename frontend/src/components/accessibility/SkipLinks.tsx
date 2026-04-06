import { useState } from 'react';

export default function SkipLinks() {
  const [focused, setFocused] = useState(false);

  return (
    <div className={`fixed top-0 left-0 z-[9999] transition-transform duration-200 ${focused ? 'translate-y-0' : '-translate-y-full'}`}>
      <a
        href="#main-content"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="block px-4 py-3 bg-emerald-500 text-white font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
      >
        Skip to main content
      </a>
    </div>
  );
}
