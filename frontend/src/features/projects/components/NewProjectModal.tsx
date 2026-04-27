import { useState } from 'react';
import { X, ArrowRight, ArrowLeft, Building2, Home, MapPin, Briefcase } from 'lucide-react';
import { SecureInput } from '../../auth/components/SecurityComponents';
import { createProject as createProjectSynced, type Project } from '../projectStorage';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (project: Project) => void;
}

export default function NewProjectModal({ isOpen, onClose, onSuccess }: NewProjectModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Project State
  const [name, setName] = useState('');
  const [type, setType] = useState('Residential');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (loading || !name.trim()) return;
    setLoading(true);
    try {
      const project = await createProjectSynced({ name: name.trim(), type, address, city });
      onSuccess(project);
      // Reset form for next use
      setStep(1);
      setName('');
      setAddress('');
      setCity('');
      setType('Residential');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg glass-panel rounded-[2.5rem] border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-colors z-50">
          <X className="w-5 h-5" />
        </button>

        <div className="p-10">
          <div className="mb-8">
             <div className="flex gap-1.5 mb-6">
                {[1, 2, 3].map(s => (
                  <div key={s} className={`h-1.5 flex-1 rounded-full ${step >= s ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-slate-800'}`} />
                ))}
             </div>
             <h2 className="text-3xl font-extrabold text-white tracking-tight">
               {step === 1 && "Project Identity"}
               {step === 2 && "Property Location"}
               {step === 3 && "Engineering Scope"}
             </h2>
             <p className="text-slate-400 font-medium">Please provide the details to initialize the workspace.</p>
          </div>

          <div className="space-y-6">
            {step === 1 && (
              <div className="animate-in slide-in-from-right-4 fade-in duration-500">
                <SecureInput 
                  label="Project Name" 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Henderson Office"
                  icon={<Briefcase className="w-5 h-5" />}
                />
                <div className="mt-8 grid grid-cols-2 gap-4">
                   <TypeCard title="Residential" icon={<Home className="w-5 h-5" />} active={type === 'Residential'} onClick={() => setType('Residential')} />
                   <TypeCard title="Commercial" icon={<Building2 className="w-5 h-5" />} active={type === 'Commercial'} onClick={() => setType('Commercial')} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="animate-in slide-in-from-right-4 fade-in duration-500 space-y-4">
                <SecureInput 
                  label="Street Address" 
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="Main St"
                  icon={<MapPin className="w-5 h-5" />}
                />
                <SecureInput 
                  label="City" 
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="Chicago"
                />
              </div>
            )}

            {step === 3 && (
              <div className="animate-in slide-in-from-right-4 fade-in duration-500">
                <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 mb-6">
                  <h4 className="text-white font-bold mb-2">Standards & Protocol</h4>
                  <p className="text-slate-400 text-sm mb-6">This project will use the global standards selected during your onboarding.</p>
                  <div className="space-y-3">
                     <ProtocolItem label="Manual J (Load Calc)" active />
                     <ProtocolItem label="Manual D (Duct Design)" active />
                     <ProtocolItem label="Manual S (Equipment)" active />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-12 flex justify-between gap-4">
            {step > 1 ? (
              <button 
                onClick={() => setStep(s => s - 1)}
                className="flex-1 py-4 rounded-2xl bg-slate-900 text-slate-400 font-bold hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" /> Back
              </button>
            ) : <div className="flex-1" />}
            
            {step < 3 ? (
              <button 
                disabled={!name}
                onClick={() => setStep(s => s + 1)}
                className="flex-[2] py-4 rounded-2xl bg-slate-100 text-slate-950 font-bold hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                Continue <ArrowRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                disabled={loading || !name.trim()}
                onClick={handleSubmit}
                className="flex-[2] py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? "Syncing to cloud…" : "Initialize Workspace"} <ArrowRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypeCard({ title, icon, active, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`p-6 rounded-3xl border transition-all flex flex-col items-center gap-3 ${active ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-lg' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'}`}
    >
      {icon}
      <span className="font-bold text-sm">{title}</span>
    </button>
  );
}

function ProtocolItem({ label, active }: any) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-700'}`} />
      <span className="text-sm font-semibold text-slate-300">{label}</span>
    </div>
  );
}
