// Skill (favorite) APIs - CRUD, persisted to ~/.echobird/config/skills.json
import { invoke } from '@tauri-apps/api/core';
import type { SkillConfig } from './types';

export async function getSkills(): Promise<SkillConfig[]> {
  return invoke('get_skills');
}

export async function addSkill(input: {
  name: string;
  url: string;
  category: string;
  description?: string;
}): Promise<SkillConfig> {
  const result = await invoke<SkillConfig>('add_skill', { input });
  return result;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const result = await invoke<boolean>('delete_skill', { id });
  return result;
}

export async function updateSkill(
  id: string,
  updates: {
    name?: string;
    url?: string;
    category?: string;
    description?: string;
  }
): Promise<SkillConfig | null> {
  const result = await invoke<SkillConfig | null>('update_skill', { id, updates });
  return result;
}
