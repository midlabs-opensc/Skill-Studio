import type { StateStorage } from 'zustand/middleware';
import { isTauri } from '../services/ai';
import { loadAppState, saveAppState } from './tauri';

export const appStorage: StateStorage = {
  getItem: async (name) => {
    if (!isTauri()) return localStorage.getItem(name);
    return loadAppState();
  },
  setItem: async (name, value) => {
    if (!isTauri()) localStorage.setItem(name, value);
    else await saveAppState(value);
  },
  removeItem: async (name) => {
    if (!isTauri()) localStorage.removeItem(name);
    else await saveAppState('null');
  },
};
