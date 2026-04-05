import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type OrgType, type RegionCode, type Address } from '../features/auth/store/useAuthStore';
import { SecureInput, SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Building2, Globe, User, ArrowRight, ArrowLeft, ChevronRight, MapPin, Phone, Mail } from 'lucide-react';

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<OrgType | null>(null);
  const [region, setRegion] = useState<RegionCode>('NA_ASHRAE');
  
  // Org Details
  const [orgName, setOrgName] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgAddress, setOrgAddress] = useState<Address>({ line1: '', line2: '', city: '', state: '', zip: '', country: 'US' });
  
  // User Details
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [userPhone, setUserPhone] = useState('');

  const navigate = useNavigate();
  const completeOnboarding = useAuthStore(s => s.completeOnboarding);

  const handleComplete = () => {
    if (!role || !orgName || !fullName) return;
    
    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ');
    
    completeOnboarding(
      { 
        id: 'user-new', 
        email, 
        role: 'admin', 
        firstName, 
        lastName, 
        phone: userPhone, 
        isVerified: true 
      },
      { 
        id: 'org-new', 
        name: orgName, 
        type: role, 
        slug: orgName.toLowerCase().replace(/\s+/g, '-'), 
        regionCode: region,
        address: orgAddress,
        phone: orgPhone
      }
    );
    navigate('/dashboard');
  };

  const updateAddress = (field: keyof Address, value: string) => {
    setOrgAddress(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8 overflow-hidden relative selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Background Decor */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_var(--color-slate-900),_var(--color-slate-950))] opacity-50" />
      
      <div className="relative w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="flex gap-2 mb-12">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${step >= s ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-slate-800'}`} />
          ))}
        </div>

        {/* Step 1: Role Selection */}
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Account Configuration</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Select your operational capacity within the platform.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RoleChoice 
                icon={<Building2 className="w-6 h-6" />}
                title="Company"
                description="Engineering teams & firms."
                selected={role === 'company'}
                className="border-emerald-500/20 bg-emerald-500/5"
                onClick={() => setRole('company')}
              />
              <RoleChoice 
                icon={<Globe className="w-6 h-6" />}
                title="Municipality"
                description="Regulatory & plan review."
                selected={role === 'municipality'}
                className="border-amber-500/20 bg-amber-500/5"
                onClick={() => setRole('municipality')}
              />
              <RoleChoice 
                icon={<User className="w-6 h-6" />}
                title="Individual"
                description="HVAC Contractor/Owner."
                selected={role === 'individual'}
                className="border-sky-500/20 bg-sky-500/5"
                onClick={() => setRole('individual')}
              />
            </div>
          </div>
        )}

        {/* Step 2: Coded Area Selection */}
        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Regional Compliance</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Select the regulatory region for your calculations.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RegionChoice 
                title="North America"
                subtitle="ASHRAE/ACCA"
                description="IP Units (Fahrenheit, BTU/h, sqft)"
                selected={region === 'NA_ASHRAE'}
                onClick={() => setRegion('NA_ASHRAE')}
              />
              <RegionChoice 
                title="Europe"
                subtitle="EN Standard"
                description="SI Units (Celsius, Watts, sqm)"
                selected={region === 'EU_EN'}
                onClick={() => setRegion('EU_EN')}
              />
              <RegionChoice 
                title="United Kingdom"
                subtitle="CIBSE Guide"
                description="Mixed/SI Units"
                selected={region === 'UK_CIBSE'}
                onClick={() => setRegion('UK_CIBSE')}
              />
            </div>
          </div>
        )}

        {/* Step 3: Organisation Details */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Technical Headquarters</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Official address for report metadata and licensing.</p>
            
            <div className="space-y-4">
              <SecureInput 
                label="Organisation Name" 
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Engineering Firm LLC"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SecureInput 
                  label="Business Street Address" 
                  value={orgAddress.line1}
                  onChange={(e) => updateAddress('line1', e.target.value)}
                  placeholder="Street"
                  icon={<MapPin className="w-4 h-4" />}
                />
                <SecureInput 
                  label="Office/Suite" 
                  value={orgAddress.line2}
                  onChange={(e) => updateAddress('line2', e.target.value)}
                  placeholder="Lvl/Room"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SecureInput label="City" value={orgAddress.city} onChange={(e) => updateAddress('city', e.target.value)} placeholder="City" />
                <SecureInput label="State/Prov" value={orgAddress.state} onChange={(e) => updateAddress('state', e.target.value)} placeholder="State" />
                <SecureInput label="Postal Code" value={orgAddress.zip} onChange={(e) => updateAddress('zip', e.target.value)} placeholder="Zip" />
              </div>
              <SecureInput 
                label="Business Phone Number" 
                value={orgPhone}
                onChange={(e) => setOrgPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                icon={<Phone className="w-4 h-4" />}
              />
            </div>
          </div>
        )}

        {/* Step 4: Personal Profile */}
        {step === 4 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">User Profile</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Verified credentials for your engineering account.</p>
            
            <div className="space-y-4">
              <SecureInput 
                label="Full Legal Name" 
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Engineer John Doe"
                icon={<User className="w-5 h-5" />}
              />
              <SecureInput 
                label="System Email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@firm.com"
                icon={<Mail className="w-5 h-5" />}
              />
              <SecureInput 
                label="Personal Contact Node" 
                value={userPhone}
                onChange={(e) => setUserPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                icon={<Phone className="w-5 h-5" />}
              />
              
              <div className="mt-8">
                <SecurityBadge />
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="mt-12 flex justify-between items-center px-1">
          {step > 1 ? (
            <button 
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-2 text-slate-500 hover:text-white font-bold transition-all p-2 rounded-xl hover:bg-slate-800/50"
            >
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
          ) : <div />}
          
          {step < 4 ? (
            <button 
              disabled={step === 1 && !role}
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-2 bg-slate-100 text-slate-950 px-8 py-3.5 rounded-full font-bold hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-slate-950"
            >
              Next Component <ChevronRight className="w-5 h-5" />
            </button>
          ) : (
            <button 
              onClick={handleComplete}
              disabled={!fullName || !orgName || !email}
              className="flex items-center gap-2 bg-emerald-500 text-slate-950 px-10 py-4 rounded-full font-bold hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all transform hover:-translate-y-1 active:scale-95 disabled:opacity-50 shadow-xl shadow-slate-950"
            >
              Complete Registration <ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleChoice({ icon, title, description, selected, onClick, className }: { icon: React.ReactNode, title: string, description: string, selected: boolean, onClick: () => void, className: string }) {
  return (
    <button 
      onClick={onClick}
      className={`relative glass-panel p-6 rounded-3xl border text-left transition-all duration-500 group ${className} ${selected ? 'border-opacity-100 shadow-[0_0_30px_rgba(16,185,129,0.1)] -translate-y-1' : 'border-opacity-10 translate-y-0 opacity-60 hover:opacity-100'}`}
    >
      <div className={`w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-900 border border-slate-700/50 mb-6 group-hover:scale-110 transition-transform shadow-xl ${selected ? 'text-white' : 'text-slate-500'}`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-2 leading-tight tracking-tight">{title}</h3>
      <p className="text-slate-500 text-sm leading-relaxed font-medium">{description}</p>
    </button>
  );
}

function RegionChoice({ title, subtitle, description, selected, onClick }: { title: string, subtitle: string, description: string, selected: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`glass-panel p-6 rounded-3xl border text-left transition-all duration-500 ${selected ? 'border-emerald-500/50 bg-emerald-500/5 shadow-xl -translate-y-1' : 'border-slate-800 opacity-60 hover:opacity-100'}`}
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-extrabold text-white leading-tight">{title}</h3>
        {selected && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />}
      </div>
      <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2 opacity-80">{subtitle}</p>
      <p className="text-slate-500 text-xs leading-relaxed font-medium">{description}</p>
    </button>
  );
}
