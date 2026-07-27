import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Project, RunRecord, Skill } from '../types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export interface SyncService { syncSkills(skills: Skill[]): Promise<void>; syncProjects(projects: Project[]): Promise<void>; syncRuns(runs: RunRecord[]): Promise<void>; }
export const supabaseSync: SyncService = {
  async syncSkills(skills) { if (!supabase) return; const { data } = await supabase.auth.getUser(); if (!data.user) return; const { error } = await supabase.from('skills').upsert(skills.map(skill => ({ id: skill.id, user_id: data.user!.id, data: skill }))); if (error) throw error; },
  async syncProjects(projects) { if (!supabase) return; const { data } = await supabase.auth.getUser(); if (!data.user) return; const { error } = await supabase.from('projects').upsert(projects.map(project => ({ id: project.id, user_id: data.user!.id, data: project }))); if (error) throw error; },
  async syncRuns(runs) { if (!supabase) return; const { data } = await supabase.auth.getUser(); if (!data.user) return; const { error } = await supabase.from('runs').upsert(runs.map(run => ({ id: run.id, user_id: data.user!.id, data: run }))); if (error) throw error; },
};
