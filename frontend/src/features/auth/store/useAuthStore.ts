import { create } from 'zustand';

export type UserRole = 'admin' | 'engineer' | 'tech' | 'viewer';
export type OrgType = 'individual' | 'company' | 'municipality';
export type RegionCode = 'NA_ASHRAE' | 'EU_EN' | 'UK_CIBSE';

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: Address;
  isVerified: boolean;
}

export interface Organisation {
  id: string;
  name: string;
  type: OrgType;
  slug: string;
  regionCode: RegionCode;
  address?: Address;
  phone?: string;
}

interface AuthState {
  user: User | null;
  organisation: Organisation | null;
  isAuthenticated: boolean;
  isOnboarding: boolean;
  
  // Actions
  login: (email: string) => void;
  logout: () => void;
  setOnboarding: (isOnboarding: boolean) => void;
  completeOnboarding: (user: User, org: Organisation) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  organisation: null,
  isAuthenticated: false,
  isOnboarding: false,

  login: (email) => {
    // For now, mock a successful login
    set({ 
      isAuthenticated: true, 
      user: { 
        id: 'user-1', 
        email, 
        role: 'admin', 
        firstName: 'Dev', 
        lastName: 'User',
        isVerified: true
      } 
    });
  },

  logout: () => set({ user: null, organisation: null, isAuthenticated: false, isOnboarding: false }),

  setOnboarding: (isOnboarding) => set({ isOnboarding }),

  completeOnboarding: async (user, org) => {
    try {
      // 🚀 Trigger real backend onboarding & email
      await fetch('http://localhost:8081/api/auth/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: `${user.firstName} ${user.lastName}`,
          email: user.email,
          orgName: org.name,
          region: org.regionCode
        })
      });
      
      set({ 
        user, 
        organisation: org, 
        isAuthenticated: true, 
        isOnboarding: false 
      });
    } catch (err) {
      console.error('Onboarding API failed, but continuing with local state for now:', err);
      // Fallback to local state so user isn't blocked by backend being down in dev
      set({ 
        user, 
        organisation: org, 
        isAuthenticated: true, 
        isOnboarding: false 
      });
    }
  },
}));
