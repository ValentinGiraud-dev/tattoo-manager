import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { SessionListItem } from "./sessions-store";

export type ProjectStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

/** Miroir de `ProjectSummary` (Rust). Montants en centimes. */
export interface Project {
  id: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  title: string;
  bodyArea: string | null;
  description: string | null;
  quotedPriceCents: number | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  completedCount: number;
  nextSessionDate: string | null;
  sessionsPriceCents: number;
  heldDepositsCents: number;
  receivedCents: number;
}

export interface ProjectInput {
  clientId: string;
  title: string;
  bodyArea: string | null;
  description: string | null;
  quotedPriceCents: number | null;
  status: ProjectStatus;
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "En cours",
  COMPLETED: "Terminé",
  ABANDONED: "Abandonné",
};

interface ProjectsState {
  listForClient: (clientId: string) => Promise<Project[]>;
  get: (id: string) => Promise<Project>;
  create: (input: ProjectInput) => Promise<Project>;
  update: (id: string, input: ProjectInput) => Promise<Project>;
  sessions: (projectId: string) => Promise<SessionListItem[]>;
}

export const useProjectsStore = create<ProjectsState>(() => ({
  listForClient: (clientId) => invoke<Project[]>("list_client_projects", { clientId }),
  get: (id) => invoke<Project>("get_project", { id }),
  create: (input) => invoke<Project>("create_project", { input }),
  update: (id, input) => invoke<Project>("update_project", { id, input }),
  sessions: (projectId) => invoke<SessionListItem[]>("list_project_sessions", { projectId }),
}));
