import { usePreferencesStore, type ThemeMode, type UIDensity, type UnitSystem, type AccentColor } from '../stores/usePreferencesStore';
import { Settings, Palette, Ruler, Grid3X3, Monitor, RotateCcw, Accessibility } from 'lucide-react';
import A11yPanel from '../components/accessibility/A11yPanel';

export default function SettingsPage() {
  const prefs = usePreferencesStore();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/30">
              <Settings className="w-6 h-6 text-slate-300" />
            </div>
            <h2 className="text-3xl font-bold text-white">Settings</h2>
          </div>
          <p className="text-slate-400 ml-14">Customize your workspace experience.</p>
        </header>

        <div className="space-y-8">
          {/* Appearance */}
          <Section icon={<Palette className="w-5 h-5 text-violet-400" />} title="Appearance">
            <OptionGroup label="Theme">
              <ToggleRow
                options={[
                  { value: 'midnight', label: 'Midnight' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                value={prefs.theme}
                onChange={(v) => prefs.update({ theme: v as ThemeMode })}
              />
            </OptionGroup>

            <OptionGroup label="Accent Color">
              <div className="flex gap-3">
                {(['emerald', 'sky', 'violet', 'amber', 'rose'] as AccentColor[]).map((c) => {
                  const colors: Record<string, string> = {
                    emerald: 'bg-emerald-500', sky: 'bg-sky-500', violet: 'bg-violet-500',
                    amber: 'bg-amber-500', rose: 'bg-rose-500',
                  };
                  return (
                    <button
                      key={c}
                      onClick={() => prefs.update({ accent: c })}
                      className={`w-10 h-10 rounded-xl ${colors[c]} transition-all ${prefs.accent === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                      aria-label={c}
                    />
                  );
                })}
              </div>
            </OptionGroup>

            <OptionGroup label="UI Density">
              <ToggleRow
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'spacious', label: 'Spacious' },
                ]}
                value={prefs.density}
                onChange={(v) => prefs.update({ density: v as UIDensity })}
              />
            </OptionGroup>

            <SwitchOption
              label="Animations"
              description="Smooth transitions and motion effects"
              checked={prefs.animationsEnabled}
              onChange={(v) => prefs.update({ animationsEnabled: v })}
            />

            <SwitchOption
              label="Tooltips"
              description="Show helpful tooltips on hover"
              checked={prefs.showTooltips}
              onChange={(v) => prefs.update({ showTooltips: v })}
            />
          </Section>

          {/* Units & Defaults */}
          <Section icon={<Ruler className="w-5 h-5 text-sky-400" />} title="Units & Defaults">
            <OptionGroup label="Unit System">
              <ToggleRow
                options={[
                  { value: 'imperial', label: 'Imperial (ft, °F)' },
                  { value: 'metric', label: 'Metric (m, °C)' },
                ]}
                value={prefs.units}
                onChange={(v) => prefs.update({ units: v as UnitSystem })}
              />
            </OptionGroup>

            <NumberOption
              label="Default Ceiling Height"
              suffix={prefs.units === 'imperial' ? 'ft' : 'm'}
              value={prefs.defaultCeilingHeight}
              onChange={(v) => prefs.update({ defaultCeilingHeight: v })}
            />

            <NumberOption
              label="Default Wall R-Value"
              value={prefs.defaultWallRValue}
              onChange={(v) => prefs.update({ defaultWallRValue: v })}
            />

            <NumberOption
              label="Default Window U-Value"
              value={prefs.defaultWindowUValue}
              onChange={(v) => prefs.update({ defaultWindowUValue: v })}
              step={0.1}
            />
          </Section>

          {/* CAD Workspace */}
          <Section icon={<Grid3X3 className="w-5 h-5 text-emerald-400" />} title="CAD Workspace">
            <SwitchOption
              label="Grid Snap"
              description="Snap drawing endpoints to the grid"
              checked={prefs.gridSnap}
              onChange={(v) => prefs.update({ gridSnap: v })}
            />

            <NumberOption
              label="Grid Spacing"
              suffix="px/ft"
              value={prefs.gridSpacing}
              onChange={(v) => prefs.update({ gridSpacing: v })}
            />

            <SwitchOption
              label="Autosave"
              description="Automatically save your work periodically"
              checked={prefs.autosave}
              onChange={(v) => prefs.update({ autosave: v })}
            />
          </Section>

          {/* Accessibility */}
          <Section icon={<Accessibility className="w-5 h-5 text-cyan-400" />} title="Accessibility">
            <A11yPanel />
          </Section>

          {/* System */}
          <Section icon={<Monitor className="w-5 h-5 text-amber-400" />} title="System">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold text-white">App Version</p>
                <p className="text-xs text-slate-500">HVAC DesignPro PWA</p>
              </div>
              <span className="text-xs font-mono text-slate-500 bg-slate-800 px-3 py-1 rounded-lg">v1.0.0</span>
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold text-white">Storage Used</p>
                <p className="text-xs text-slate-500">Projects, preferences, and cached assets</p>
              </div>
              <button
                onClick={() => { if (confirm('Clear all local data?')) { localStorage.clear(); location.reload(); } }}
                className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
              >
                Clear Data
              </button>
            </div>

            <button
              onClick={prefs.reset}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800/50 border border-slate-700/30 text-slate-400 hover:text-white hover:border-slate-600 transition-all text-sm font-semibold"
            >
              <RotateCcw className="w-4 h-4" /> Reset All Preferences
            </button>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl border border-slate-800/60 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800/40 flex items-center gap-2.5">
        {icon}
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </section>
  );
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{label}</label>
      {children}
    </div>
  );
}

function ToggleRow({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex bg-slate-900/80 rounded-xl p-1 border border-slate-800/40">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${value === opt.value ? 'bg-slate-700/80 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SwitchOption({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-all relative ${checked ? 'bg-emerald-500' : 'bg-slate-700'}`}
      >
        <div className={`w-4.5 h-4.5 rounded-full bg-white shadow-md absolute top-0.5 transition-all ${checked ? 'left-5.5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function NumberOption({ label, suffix, value, onChange, step = 1 }: { label: string; suffix?: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm font-semibold text-white">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 bg-slate-900/80 border border-slate-700/50 rounded-lg py-1.5 px-3 text-white text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        {suffix && <span className="text-xs text-slate-500 font-mono w-8">{suffix}</span>}
      </div>
    </div>
  );
}
