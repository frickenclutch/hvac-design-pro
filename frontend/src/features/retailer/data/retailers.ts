/**
 * HVAC / Plumbing Supply Retailer Database — Howland Pump & Supply network.
 *
 * Data source: howlandpump.com (Contact/Locations). These are the REAL
 * branches — an earlier build seeded fabricated Ohio addresses, which was
 * corrected 2026-07-06. The network is North Country New York + Vermont,
 * headquartered in Ogdensburg, NY. There are NO Ohio locations.
 *
 * Because the nearest branch to an out-of-footprint job (e.g. New Jersey) can
 * be 200+ miles away, the network's nationwide e-commerce portal (ECOMMERCE
 * below) is the relevant channel there — "order online, ships to the job
 * site" — rather than a walk-in branch.
 *
 * NOTE (Phase 1 direction): supplier lists become org-owned + tenant-
 * configurable (webhook / API / CSV / manual ingestion), so each tenant's
 * "preferred" network is their own. This static list is the Howland/C4
 * default until that lands.
 */

export interface RetailerLocation {
  id: string;
  name: string;
  brand: 'howland' | 'co_supply' | 'hulbert' | 'other';
  preferred: boolean;
  priority: number; // 0 = preferred network (Howland), 1+ = other
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
 * Nationwide e-commerce — the relevant channel for any job outside the
 * NY/VT branch footprint. Ships to the project ZIP.
 */
export const ECOMMERCE = {
  name: 'Howland Pump & Supply — Online Store',
  url: 'https://products.howlandpump.com',
  phone: '(315) 393-3791',
  email: 'customerservice@howlandpump.com',
  description: 'Order equipment and materials online — ships nationwide to your job site.',
};

/**
 * Preferred network — Howland Pump & Supply Co. and its divisions
 * (Hulbert Supply, C-O Supply, and the regional plumbing-supply branches).
 * Real addresses from howlandpump.com. Coordinates are city-level.
 */
export const PREFERRED_RETAILERS: RetailerLocation[] = [
  {
    id: 'howland-ogdensburg',
    name: 'Howland Pump & Supply — Ogdensburg (HQ)',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '7611 NY-68', city: 'Ogdensburg', state: 'NY', zip: '13669' },
    coordinates: { lat: 44.6945, lng: -75.4863 },
    phone: '(315) 393-3791',
    email: 'customerservice@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'hvac', 'pumps', 'well_systems'],
    description: 'Corporate headquarters. Full-line plumbing, heating, HVAC, pump and well supply.',
  },
  {
    id: 'co-supply-syracuse',
    name: 'C-O Supply — Syracuse',
    brand: 'co_supply',
    preferred: true,
    priority: 0,
    address: { line1: '3222 Burnet Ave', city: 'Syracuse', state: 'NY', zip: '13206' },
    coordinates: { lat: 43.0742, lng: -76.1237 },
    phone: '(315) 433-1156',
    email: 'rgriffith@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'hvac', 'plumbing', 'heating', 'hydronics'],
    description: 'A Howland Pump & Supply company. Central NY HVAC and plumbing distribution.',
  },
  {
    id: 'utica-plumbing',
    name: 'Utica Plumbing Supply',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '802 Whitesboro Street', city: 'Utica', state: 'NY', zip: '13502' },
    coordinates: { lat: 43.1009, lng: -75.2327 },
    phone: '(315) 735-9555',
    email: 'taxtell@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'hvac'],
    description: 'Mohawk Valley plumbing and heating supply.',
  },
  {
    id: 'utica-plumbing-rome',
    name: 'Utica Plumbing Supply — Rome Division',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '721 Erie Blvd. West', city: 'Rome', state: 'NY', zip: '13442' },
    coordinates: { lat: 43.2128, lng: -75.4557 },
    phone: '(315) 337-6515',
    email: 'twickman@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Rome division — plumbing and heating supply.',
  },
  {
    id: 'oneida-plumbing',
    name: 'Oneida Plumbing Supply',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '436 West Railroad Street', city: 'Oneida', state: 'NY', zip: '13421' },
    coordinates: { lat: 43.0928, lng: -75.6510 },
    phone: '(315) 363-5600',
    email: 'mmeyers@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Oneida County plumbing and heating supply.',
  },
  {
    id: 'watertown-supply',
    name: 'Watertown Supply Company',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '23170 NYS Route 12', city: 'Watertown', state: 'NY', zip: '13601' },
    coordinates: { lat: 43.9748, lng: -75.9108 },
    phone: '(315) 782-6320',
    email: 'tplimpton@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'hvac'],
    description: 'North Country plumbing, heating, and HVAC supply.',
  },
  {
    id: 'gouverneur-plumbing',
    name: 'Gouverneur Plumbing Supply',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '1370 US Highway 11', city: 'Gouverneur', state: 'NY', zip: '13642' },
    coordinates: { lat: 44.3395, lng: -75.4638 },
    phone: '(315) 287-3512',
    email: 'kbesaw@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'St. Lawrence County plumbing and heating supply.',
  },
  {
    id: 'potsdam-plumbing',
    name: 'Potsdam Plumbing Supply',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '4 Pleasant Valley Road', city: 'Potsdam', state: 'NY', zip: '13676' },
    coordinates: { lat: 44.6698, lng: -74.9813 },
    phone: '(315) 265-2710',
    email: 'zlawrence@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Potsdam-area plumbing and heating supply.',
  },
  {
    id: 'massena-plumbing',
    name: 'Massena Plumbing Supply',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '15039 NY-37', city: 'Massena', state: 'NY', zip: '13662' },
    coordinates: { lat: 44.9281, lng: -74.8918 },
    phone: '(315) 769-9029',
    email: 'rdumas@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Massena-area plumbing and heating supply.',
  },
  {
    id: 'lowville-supply',
    name: 'Lowville Supply Company',
    brand: 'howland',
    preferred: true,
    priority: 0,
    address: { line1: '7643 Forest Avenue', city: 'Lowville', state: 'NY', zip: '13367' },
    coordinates: { lat: 43.7867, lng: -75.4921 },
    phone: '(315) 376-8130',
    email: 'kconverse@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Lewis County plumbing and heating supply.',
  },
  {
    id: 'hulbert-lake-placid',
    name: 'Hulbert Supply — Lake Placid',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '255 Station Street', city: 'Lake Placid', state: 'NY', zip: '12946' },
    coordinates: { lat: 44.2795, lng: -73.9799 },
    phone: '(518) 523-1500',
    email: 'ddalton@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Adirondacks plumbing, heating, and industrial supply.',
  },
  {
    id: 'hulbert-plattsburgh',
    name: 'Hulbert Supply — Plattsburgh',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '390 Route 3', city: 'Plattsburgh', state: 'NY', zip: '12901' },
    coordinates: { lat: 44.6995, lng: -73.4529 },
    phone: '(518) 561-5400',
    email: 'rmeyer@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'North Country plumbing, heating, and industrial supply.',
  },
  {
    id: 'hulbert-saranac-lake',
    name: 'Hulbert Supply — Saranac Lake',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '123 John Munn Road', city: 'Saranac Lake', state: 'NY', zip: '12983' },
    coordinates: { lat: 44.3295, lng: -74.1315 },
    phone: '(518) 891-3141',
    email: 'rlawrence@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Saranac Lake plumbing, heating, and industrial supply.',
  },
  {
    id: 'hulbert-malone',
    name: 'Hulbert Supply — Malone',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '4082 State Route 11', city: 'Malone', state: 'NY', zip: '12953' },
    coordinates: { lat: 44.8489, lng: -74.2946 },
    phone: '(518) 521-3164',
    email: 'rvollmer@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating'],
    description: 'Franklin County plumbing, heating, and industrial supply.',
  },
  {
    id: 'hulbert-tupper-lake',
    name: 'Hulbert Supply — Tupper Lake',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '66 Main St', city: 'Tupper Lake', state: 'NY', zip: '12986' },
    coordinates: { lat: 44.2262, lng: -74.4630 },
    phone: '(518) 359-5500',
    email: 'rmolinari@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'hardware'],
    description: 'Tupper Lake plumbing, heating, and hardware supply.',
  },
  {
    id: 'hulbert-burlington-vt',
    name: 'Hulbert Supply — Burlington VT',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '332 Pine Street', city: 'Burlington', state: 'VT', zip: '05401' },
    coordinates: { lat: 44.4759, lng: -73.2121 },
    phone: '(802) 862-6426',
    email: 'dhulbert@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'industrial'],
    description: 'Vermont plumbing, heating, and industrial supply.',
  },
  {
    id: 'hulbert-brandon-vt',
    name: 'Hulbert Supply — Brandon VT',
    brand: 'hulbert',
    preferred: true,
    priority: 0,
    address: { line1: '2544 Franklin St, Route 7 South', city: 'Brandon', state: 'VT', zip: '05733' },
    coordinates: { lat: 43.7981, lng: -73.0868 },
    phone: '(802) 247-4444',
    email: 'dhulbert@howlandpump.com',
    website: 'https://howlandpump.com',
    capabilities: ['residential', 'commercial', 'plumbing', 'heating', 'industrial'],
    description: 'Vermont plumbing, heating, and industrial supply.',
  },
];

/**
 * Non-preferred retailers. Empty for now — the Howland network is the
 * configured default, and out-of-footprint jobs are served by the
 * nationwide e-commerce portal (ECOMMERCE) rather than a competitor list.
 * Per-org supplier directories (Phase 1) will populate this per tenant.
 */
export const OTHER_RETAILERS: RetailerLocation[] = [];

/** All retailers combined */
export const ALL_RETAILERS: RetailerLocation[] = [...PREFERRED_RETAILERS, ...OTHER_RETAILERS];
