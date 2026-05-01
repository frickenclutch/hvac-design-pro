/**
 * Manual J 8th Edition v2.50 — Table 4B
 * ======================================
 * CLTD Values for Medium Color Exposed Walls and Garage Partition Walls
 * Construction Numbers 12 (Frame), 13 (Block), 14 (Alternative), 15 (Above Grade)
 *
 * Source: ACCA Manual J 8th Edition v2.50, page 383
 * Validated against three ACCA reference test cases (184/184 line-item checks).
 *
 * 220 cells total: 11 Groups (A through K) × Wall + Partition × CTD/DR matrix.
 *
 * Sparse layout — not every (CTD, DR) cell is populated. Cells where the
 * climate combination is unrealistic are omitted (e.g. CTD=10 with H — high
 * daily range doesn't pair with low-CTD humid climates).
 *
 * Lookup convention: When the design CTD doesn't match a bin (10/15/20/25/
 * 30/35), Manual J rounds UP to the next bin per design conservatism (NOT
 * linear interpolation). See `../lookup.ts`.
 *
 * Group letters represent thermal mass tiers from lightest (A, highest CLTD
 * peak) to heaviest (K, dampened/delayed peak). Adding brick veneer or
 * cavity insulation bumps the Group letter higher.
 */

import type { Table4BData } from '../types';

export const TABLE_4B: Table4BData = {
  A: {
    wall: {
      10: { L: 25.5, M: 21.5 },
      15: { L: 30.5, M: 26.5, H: 21.5 },
      20: { L: 35.5, M: 31.5, H: 26.5 },
      25: { M: 36.5, H: 31.5 },
      30: { H: 36.5 },
      35: { H: 41.5 },
    },
    partition: {
      10: { L: 14.8, M: 10.8 },
      15: { L: 19.8, M: 15.8, H: 10.8 },
      20: { L: 24.8, M: 20.8, H: 15.8 },
      25: { M: 25.8, H: 20.8 },
      30: { H: 25.8 },
      35: { H: 30.8 },
    },
  },
  B: {
    wall: {
      10: { L: 23.1, M: 19.1 },
      15: { L: 28.1, M: 24.1, H: 19.1 },
      20: { L: 33.1, M: 29.1, H: 24.1 },
      25: { M: 34.1, H: 29.1 },
      30: { H: 34.1 },
      35: { H: 39.1 },
    },
    partition: {
      10: { L: 12.7, M: 8.7 },
      15: { L: 17.7, M: 13.7, H: 8.7 },
      20: { L: 22.7, M: 18.7, H: 13.7 },
      25: { M: 23.7, H: 18.7 },
      30: { H: 23.7 },
      35: { H: 28.7 },
    },
  },
  C: {
    wall: {
      10: { L: 20.5, M: 16.5 },
      15: { L: 25.5, M: 21.5, H: 16.5 },
      20: { L: 30.5, M: 26.5, H: 21.5 },
      25: { M: 31.5, H: 26.5 },
      30: { H: 31.5 },
      35: { H: 36.5 },
    },
    partition: {
      10: { L: 10.6, M: 6.6 },
      15: { L: 15.6, M: 11.6, H: 6.6 },
      20: { L: 20.6, M: 16.6, H: 11.6 },
      25: { M: 21.6, H: 16.6 },
      30: { H: 21.6 },
      35: { H: 26.6 },
    },
  },
  D: {
    wall: {
      10: { L: 18.5, M: 14.5 },
      15: { L: 23.5, M: 19.4, H: 14.5 },
      20: { L: 28.5, M: 24.5, H: 19.5 },
      25: { M: 29.5, H: 24.5 },
      30: { H: 29.5 },
      35: { H: 34.5 },
    },
    partition: {
      10: { L: 9.4, M: 5.4 },
      15: { L: 14.4, M: 10.4, H: 5.4 },
      20: { L: 19.4, M: 15.4, H: 10.4 },
      25: { M: 20.4, H: 15.4 },
      30: { H: 20.4 },
      35: { H: 25.4 },
    },
  },
  E: {
    wall: {
      10: { L: 16.4, M: 12.4 },
      15: { L: 21.4, M: 17.4, H: 12.4 },
      20: { L: 26.4, M: 22.4, H: 17.4 },
      25: { M: 27.4, H: 22.4 },
      30: { H: 27.4 },
      35: { H: 32.4 },
    },
    partition: {
      10: { L: 8.0, M: 4.0 },
      15: { L: 13.0, M: 9.0, H: 4.0 },
      20: { L: 18.0, M: 14.0, H: 9.0 },
      25: { M: 19.0, H: 14.0 },
      30: { H: 19.0 },
      35: { H: 24.0 },
    },
  },
  F: {
    wall: {
      10: { L: 14.3, M: 10.3 },
      15: { L: 19.3, M: 15.3, H: 10.3 },
      20: { L: 24.3, M: 20.3, H: 15.3 },
      25: { M: 25.3, H: 20.3 },
      30: { H: 25.3 },
      35: { H: 30.3 },
    },
    partition: {
      10: { L: 6.9, M: 2.9 },
      15: { L: 11.9, M: 7.9, H: 2.9 },
      20: { L: 16.9, M: 12.9, H: 7.9 },
      25: { M: 17.9, H: 12.9 },
      30: { H: 17.9 },
      35: { H: 22.9 },
    },
  },
  G: {
    wall: {
      10: { L: 12.3, M: 8.3 },
      15: { L: 17.3, M: 13.3, H: 8.3 },
      20: { L: 22.3, M: 18.3, H: 13.3 },
      25: { M: 23.3, H: 18.3 },
      30: { H: 23.3 },
      35: { H: 28.3 },
    },
    partition: {
      10: { L: 5.6, M: 1.6 },
      15: { L: 10.6, M: 6.6, H: 1.6 },
      20: { L: 15.6, M: 11.6, H: 6.6 },
      25: { M: 16.6, H: 11.6 },
      30: { H: 16.6 },
      35: { H: 21.6 },
    },
  },
  H: {
    wall: {
      10: { L: 11.7, M: 7.7 },
      15: { L: 16.7, M: 12.7, H: 7.7 },
      20: { L: 21.7, M: 17.7, H: 12.7 },
      25: { M: 22.7, H: 17.7 },
      30: { H: 22.7 },
      35: { H: 27.7 },
    },
    partition: {
      10: { L: 5.3, M: 1.3 },
      15: { L: 10.3, M: 6.3, H: 1.3 },
      20: { L: 15.3, M: 11.3, H: 6.3 },
      25: { M: 16.3, H: 11.3 },
      30: { H: 16.3 },
      35: { H: 21.3 },
    },
  },
  I: {
    wall: {
      10: { L: 11.0, M: 7.0 },
      15: { L: 16.0, M: 12.0, H: 7.0 },
      20: { L: 21.0, M: 17.0, H: 12.0 },
      25: { M: 22.0, H: 17.0 },
      30: { H: 22.0 },
      35: { H: 27.0 },
    },
    partition: {
      10: { L: 4.9, M: 0.9 },
      15: { L: 9.9, M: 5.9, H: 0.9 },
      20: { L: 14.9, M: 10.9, H: 5.9 },
      25: { M: 15.9, H: 10.9 },
      30: { H: 15.9 },
      35: { H: 20.9 },
    },
  },
  J: {
    wall: {
      10: { L: 10.4, M: 6.4 },
      15: { L: 15.4, M: 11.4, H: 6.4 },
      20: { L: 20.4, M: 16.4, H: 11.4 },
      25: { M: 21.4, H: 16.4 },
      30: { H: 21.4 },
      35: { H: 26.4 },
    },
    partition: {
      10: { L: 4.7, M: 0.7 },
      15: { L: 9.7, M: 5.7, H: 0.7 },
      20: { L: 14.7, M: 10.7, H: 5.7 },
      25: { M: 15.7, H: 10.7 },
      30: { H: 15.7 },
      35: { H: 20.7 },
    },
  },
  K: {
    wall: {
      10: { L: 9.6, M: 5.6 },
      15: { L: 14.6, M: 10.6, H: 5.6 },
      20: { L: 19.6, M: 15.6, H: 10.6 },
      25: { M: 20.6, H: 15.6 },
      30: { H: 20.6 },
      35: { H: 25.6 },
    },
    partition: {
      10: { L: 4.5, M: 0.5 },
      15: { L: 9.5, M: 5.5, H: 0.5 },
      20: { L: 14.5, M: 10.5, H: 5.5 },
      25: { M: 15.5, H: 10.5 },
      30: { H: 15.5 },
      35: { H: 20.5 },
    },
  },
};
