/**
 * HVAC Supply Retailer Database
 *
 * Howland Pump & Supply and its subdivisions (C O Supply) are designated
 * preferred partners and always appear first in search results.
 */

export interface RetailerLocation {
  id: string;
  name: string;
  brand: 'howland' | 'co_supply' | 'hulbert' | 'other';
  preferred: boolean;
  priority: number; // 0 = preferred (always first), 1+ = standard
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
  };
  coordinates: { lat: number; lng: number };
  phone: string;
  email?: string;
  website?: string;
  hours?: string;
  capabilities: string[];
  description?: string;
}

/**
 * Preferred Partners — Howland Pump & Supply network
 * These always appear at the top regardless of distance.
 */
export const PREFERRED_RETAILERS: RetailerLocation[] = [
  {
    id: 'howland-main',
    name: 'Howland Pump & Supply',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: {
      line1: '179 Niles Cortland Rd SE',
      city: 'Warren',
      state: 'OH',
      zip: '44484',
    },
    coordinates: { lat: 41.2245, lng: -80.8184 },
    phone: '(330) 856-4419',
    website: 'https://howlandpump.com',
    hours: 'Mon-Fri 7:30AM-5PM, Sat 8AM-12PM',
    capabilities: ['residential', 'commercial', 'equipment', 'ductwork', 'controls', 'pumps', 'well_systems', 'filtration'],
    description: 'Full-service HVAC, plumbing, and well supply. Preferred partner for equipment selection and project quoting.',
  },
  {
    id: 'howland-boardman',
    name: 'Howland Pump & Supply — Boardman',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: {
      line1: '7171 Market St',
      city: 'Boardman',
      state: 'OH',
      zip: '44512',
    },
    coordinates: { lat: 41.0234, lng: -80.6657 },
    phone: '(330) 758-8241',
    website: 'https://howlandpump.com',
    hours: 'Mon-Fri 7:30AM-5PM, Sat 8AM-12PM',
    capabilities: ['residential', 'commercial', 'equipment', 'ductwork', 'controls'],
    description: 'Boardman branch — residential and commercial HVAC supply.',
  },
  {
    id: 'co-supply-syracuse',
    name: 'C O Supply',
    brand: 'co_supply',
    preferred: true,
    priority: 0,
    address: {
      line1: '500 Solar St',
      city: 'Syracuse',
      state: 'NY',
      zip: '13204',
    },
    coordinates: { lat: 43.0481, lng: -76.1700 },
    phone: '(315) 471-1471',
    website: 'https://cosupply.com',
    hours: 'Mon-Fri 7AM-4:30PM',
    capabilities: ['residential', 'commercial', 'equipment', 'ductwork', 'controls', 'plumbing', 'hydronics'],
    description: 'A Howland Pump & Supply company. Central NY\'s leading HVAC and plumbing wholesale distributor.',
  },
  {
    id: 'hulbert-supply-main',
    name: 'Hulbert Supply',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: {
      line1: '1245 Salt Springs Rd',
      city: 'Youngstown',
      state: 'OH',
      zip: '44509',
    },
    coordinates: { lat: 41.0710, lng: -80.7025 },
    phone: '(330) 799-2211',
    hours: 'Mon-Fri 7:30AM-5PM',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'industrial', 'pipe_valves_fittings'],
    description: 'Full-line plumbing, heating, and industrial supply. Preferred partner for project materials and quoting.',
  },
  {
    id: 'hulbert-supply-warren',
    name: 'Hulbert Supply — Warren',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: {
      line1: '850 Elm Rd NE',
      city: 'Warren',
      state: 'OH',
      zip: '44483',
    },
    coordinates: { lat: 41.2475, lng: -80.7990 },
    phone: '(330) 372-8411',
    hours: 'Mon-Fri 7:30AM-5PM',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'pipe_valves_fittings'],
    description: 'Warren branch — plumbing, heating, and industrial supply.',
  },
];

/**
 * Other known HVAC supply retailers (non-preferred).
 * Shown after preferred retailers, sorted by distance.
 */
export const OTHER_RETAILERS: RetailerLocation[] = [
  {
    id: 'ferguson-youngstown',
    name: 'Ferguson HVAC Supply',
    brand: 'other',
    preferred: false,
    priority: 1,
    address: { line1: '2929 Salt Springs Rd', city: 'Youngstown', state: 'OH', zip: '44509' },
    coordinates: { lat: 41.0687, lng: -80.7068 },
    phone: '(330) 799-8889',
    hours: 'Mon-Fri 7AM-5PM',
    capabilities: ['residential', 'commercial', 'equipment'],
  },
  {
    id: 'winsupply-warren',
    name: 'WinSupply of Warren',
    brand: 'other',
    preferred: false,
    priority: 1,
    address: { line1: '1200 Elm Rd NE', city: 'Warren', state: 'OH', zip: '44483' },
    coordinates: { lat: 41.2501, lng: -80.7985 },
    phone: '(330) 372-6611',
    hours: 'Mon-Fri 7:30AM-5PM',
    capabilities: ['residential', 'equipment', 'ductwork'],
  },
  {
    id: 'carrier-enterprise-akron',
    name: 'Carrier Enterprise',
    brand: 'other',
    preferred: false,
    priority: 1,
    address: { line1: '740 Evans Ave', city: 'Akron', state: 'OH', zip: '44305' },
    coordinates: { lat: 41.0626, lng: -81.4716 },
    phone: '(330) 633-4441',
    hours: 'Mon-Fri 7AM-5PM',
    capabilities: ['residential', 'commercial', 'equipment', 'controls'],
  },
  {
    id: 'johnstone-supply-erie',
    name: 'Johnstone Supply',
    brand: 'other',
    preferred: false,
    priority: 1,
    address: { line1: '1001 W 12th St', city: 'Erie', state: 'PA', zip: '16501' },
    coordinates: { lat: 42.1181, lng: -80.0978 },
    phone: '(814) 453-6761',
    hours: 'Mon-Fri 7:30AM-5PM',
    capabilities: ['residential', 'commercial', 'equipment', 'ductwork', 'controls'],
  },
  {
    id: 'baker-distributing-pittsburgh',
    name: 'Baker Distributing',
    brand: 'other',
    preferred: false,
    priority: 1,
    address: { line1: '4850 Campbells Run Rd', city: 'Pittsburgh', state: 'PA', zip: '15205' },
    coordinates: { lat: 40.4466, lng: -80.1150 },
    phone: '(412) 788-8250',
    hours: 'Mon-Fri 7AM-5PM',
    capabilities: ['residential', 'commercial', 'equipment'],
  },
];

/** All retailers combined */
export const ALL_RETAILERS: RetailerLocation[] = [...PREFERRED_RETAILERS, ...OTHER_RETAILERS];
