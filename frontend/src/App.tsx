import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Home, Compass, Settings, Users } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import CadWorkspace from './pages/CadWorkspace';

function App() {
  return (
    <BrowserRouter>
      <div className="flex bg-slate-950 text-slate-100 font-sans h-screen w-screen overflow-hidden">
        
        {/* Sidebar */}
        <nav className="w-16 md:w-64 glass-panel border-r border-slate-800/60 flex flex-col justify-between py-6 transition-all duration-300 z-50">
          <div className="px-4">
            <div className="flex items-center gap-3 mb-10 text-emerald-400">
              <Compass className="w-8 h-8 flex-shrink-0 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]" />
              <h1 className="text-xl font-bold tracking-tight hidden md:block premium-gradient-text truncate">
                HVAC DesignPro
              </h1>
            </div>
            
            <div className="flex flex-col gap-2">
              <Link to="/dashboard" className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 text-emerald-300 transition-colors border border-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.1)] hover:bg-slate-800">
                <Home className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium hidden md:block">Projects</span>
              </Link>
              <button className="flex items-center gap-3 p-3 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 transition-colors">
                <Users className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium hidden md:block">Team</span>
              </button>
            </div>
          </div>
          
          <div className="px-4">
             <button className="flex w-full items-center gap-3 p-3 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 transition-colors">
                <Settings className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium hidden md:block">Settings</span>
              </button>
          </div>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 relative overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/project/:id/cad" element={<CadWorkspace />} />
            <Route path="/" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
