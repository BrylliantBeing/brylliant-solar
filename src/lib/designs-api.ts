import type {
  CircuitOverride,
  DesignResult,
  DesignSettings,
  Layout,
  StringDef,
} from '@calculator/pvDesign';

import { jsonEndpoint, post } from '@/lib/api-request';

/** PV designs, one per project, through public/api/designs.php (owner only). */
const request = jsonEndpoint('/api/designs.php', 'Designs');

/** The rectangle drawn on the satellite map. The layout's metres are measured from its centre. */
export type DesignSite = {
  south: number;
  west: number;
  north: number;
  east: number;
  /** Map zoom the satellite background is drawn at */
  zoom: number;
  /** Metres per grid unit correction from the calibration tool; 1 = trust the imagery */
  scale: number;
};

export type LoadCircuit = { description: string; va: number; breakerA: number; wire: string };

/** What goes on the drawings but not into the maths. */
export type PlanSet = {
  title: string;
  ownerName: string;
  location: string;
  designer: string;
  engineer: string;
  engineerLicense: string;
  loads: LoadCircuit[];
};

export type DesignInputs = {
  settings: Partial<DesignSettings>;
  overrides: Record<string, CircuitOverride>;
  /** Panels per string by inverter model, where it differs from the model's ideal pattern */
  patterns?: Record<string, number[]>;
  plan: PlanSet;
};

export type DesignDoc = {
  site: DesignSite;
  layout: Layout & { strings: StringDef[] };
  inputs: DesignInputs;
};

export type SavedDesign = DesignDoc & {
  projectId: number;
  jobId: number | null;
  result: DesignResult;
  updatedBy: string;
  updatedAt: string;
};

export type DesignProject = { id: number; customer: string; address: string; phone: string; email: string };

export async function getDesign(projectId: number): Promise<{ project: DesignProject; design: SavedDesign | null }> {
  const { project, design } = await request<{ project: DesignProject; design: SavedDesign | null }>(`?project=${projectId}`);
  return { project, design };
}

export async function saveDesign(input: DesignDoc & { projectId: number; jobId: number | null; result: DesignResult }): Promise<string> {
  return (await request<{ updatedAt: string }>('', post({ action: 'save', ...input }))).updatedAt;
}
