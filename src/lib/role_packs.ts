import founderPack from '../role_packs/founder.json';
import funderPack from '../role_packs/funder.json';
import talentPack from '../role_packs/talent.json';
import advisorPack from '../role_packs/advisor.json';

export interface RolePack {
  key: string;
  label: string;
  canonical_questions: string[];
  extraction_emphasis: string;
  match_weights: Record<string, number>;
}

const PACKS: Record<string, RolePack> = {
  founder: founderPack as RolePack,
  funder: funderPack as RolePack,
  talent: talentPack as RolePack,
  advisor: advisorPack as RolePack,
};

export function getRolePack(key: string): RolePack | null {
  return PACKS[key] ?? null;
}

export function listRolePacks(): RolePack[] {
  return Object.values(PACKS);
}

export function packsForRoles(roles: string[]): RolePack[] {
  const out: RolePack[] = [];
  for (const r of roles) {
    const p = getRolePack(r);
    if (p) out.push(p);
  }
  return out;
}
