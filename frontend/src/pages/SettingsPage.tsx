import { useRef } from 'react';
import { usePreferencesStore, type ThemeMode, type UIDensity, type UnitSystem } from '../stores/usePreferencesStore';
import { Settings, Palette, Ruler, Grid3X3, Monitor, RotateCcw, Accessibility, FileText, Stamp, Upload, Trash2, Image } from 'lucide-react';
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

          {/* PDF & Print Settings */}
          <Section icon={<FileText className="w-5 h-5 text-orange-400" />} title="PDF & Print Settings">
            <p className="text-xs text-slate-500 mb-4">Choose which sections to include when exporting PDF reports and blueprints.</p>

            <SwitchOption label="Floor Plan Drawing" description="Canvas plot on cover page" checked={prefs.pdfIncludeDrawing} onChange={(v) => prefs.update({ pdfIncludeDrawing: v })} />
            <SwitchOption label="Room & Wall Schedules" description="Room areas, wall lengths, R-values" checked={prefs.pdfIncludeRoomSchedule} onChange={(v) => prefs.update({ pdfIncludeRoomSchedule: v })} />
            <SwitchOption label="Opening & HVAC Schedules" description="Windows, doors, equipment tables" checked={prefs.pdfIncludeOpeningSchedule} onChange={(v) => prefs.update({ pdfIncludeOpeningSchedule: v })} />
            <SwitchOption label="Manual J Load Summary" description="Heating/cooling calculations (if available)" checked={prefs.pdfIncludeLoadSummary} onChange={(v) => prefs.update({ pdfIncludeLoadSummary: v })} />
            <SwitchOption label="Notes & Codes Page" description="Standard disclaimers and code references" checked={prefs.pdfIncludeNotes} onChange={(v) => prefs.update({ pdfIncludeNotes: v })} />

            <OptionGroup label="Page Size">
              <ToggleRow
                options={[
                  { value: 'letter', label: 'Letter' },
                  { value: 'a4', label: 'A4' },
                  { value: 'tabloid', label: 'Tabloid' },
                ]}
                value={prefs.pdfPageSize}
                onChange={(v) => prefs.update({ pdfPageSize: v as any })}
              />
            </OptionGroup>

            <OptionGroup label="Orientation">
              <ToggleRow
                options={[
                  { value: 'landscape', label: 'Landscape' },
                  { value: 'portrait', label: 'Portrait' },
                ]}
                value={prefs.pdfOrientation}
                onChange={(v) => prefs.update({ pdfOrientation: v as any })}
              />
            </OptionGroup>

            <OptionGroup label="Watermark Text">
              <input
                type="text"
                value={prefs.pdfWatermarkText}
                onChange={(e) => prefs.update({ pdfWatermarkText: e.target.value })}
                placeholder="Custom watermark text"
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </OptionGroup>
          </Section>

          {/* Blueprint Stamps */}
          <Section icon={<Stamp className="w-5 h-5 text-pink-400" />} title="Blueprint Stamps">
            <p className="text-xs text-slate-500 mb-4">Upload your firm's PE seal or notary stamp to automatically include on exported blueprints.</p>

            <StampUpload
              label="Firm / PE Seal"
              dataUrl={prefs.firmStampDataUrl}
              onUpload={(url) => prefs.update({ firmStampDataUrl: url })}
              onClear={() => prefs.update({ firmStampDataUrl: '' })}
            />

            {prefs.firmStampDataUrl && (
              <OptionGroup label="Stamp Position">
                <ToggleRow
                  options={[
                    { value: 'top-left', label: 'Top Left' },
                    { value: 'top-right', label: 'Top Right' },
                    { value: 'bottom-left', label: 'Bottom Left' },
                    { value: 'bottom-right', label: 'Bottom Right' },
                  ]}
                  value={prefs.firmStampPosition}
                  onChange={(v) => prefs.update({ firmStampPosition: v as any })}
                />
              </OptionGroup>
            )}

            <div className="my-3 border-t border-slate-800/40" />

            <StampUpload
              label="Notary Stamp"
              dataUrl={prefs.notaryStampDataUrl}
              onUpload={(url) => prefs.update({ notaryStampDataUrl: url })}
              onClear={() => prefs.update({ notaryStampDataUrl: '' })}
            />
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

function StampUpload({ label, dataUrl, onUpload, onClear }: { label: string; dataUrl: string; onUpload: (url: string) => void; onClear: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onUpload(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div>
      <p className="text-sm font-semibold text-white mb-2">{label}</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
      {dataUrl ? (
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden flex items-center justify-center p-1">
            <img src={dataUrl} alt={label} className="max-w-full max-h-full object-contain" />
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => fileRef.current?.click()} className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5"><Upload className="w-3 h-3" /> Replace</button>
            <button onClick={onClear} className="text-xs font-bold text-red-400 hover:text-red-300 flex items-center gap-1.5"><Trash2 className="w-3 h-3" /> Remove</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-6 rounded-xl border-2 border-dashed border-slate-700/50 bg-slate-800/20 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all flex flex-col items-center gap-2 text-slate-500 hover:text-slate-300"
        >
          <Image className="w-6 h-6" />
          <span className="text-xs font-semibold">Click to upload {label.toLowerCase()}</span>
          <span className="text-[10px] text-slate-600">PNG, JPG — Max 2MB</span>
        </button>
      )}
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
