import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Readiness } from "./sessions-store";

export type YesNo = boolean | null;

export type Allergy = "NICKEL" | "LATEX" | "ANTISEPTICS" | "INKS" | "MEDICATIONS" | "OTHER";
export type ProfessionalDecision = "POSSIBLE" | "POSTPONE" | "MEDICAL_ADVICE";
export type GuardianRelation = "FATHER" | "MOTHER" | "LEGAL_GUARDIAN";
export type DocumentKind = "HEALTH_SIGNED" | "CONSENT_SIGNED" | "OTHER";
export type FormKind = "HEALTH" | "CONSENT";

/** Miroir de `HealthAnswers` (Rust). `null` = pas encore répondu. */
export interface HealthAnswers {
  sickOrFever: YesNo;
  currentInfection: YesNo;
  recentSurgery: YesNo;
  diabetes: YesNo;
  coagulationDisorder: YesNo;
  immunodeficiency: YesNo;
  heartDisease: YesNo;
  epilepsy: YesNo;
  anticoagulant: YesNo;
  healingTreatment: YesNo;
  healingTreatmentDetails: string | null;
  allergies: Allergy[];
  allergyOther: string | null;
  pregnantOrBreastfeeding: YesNo;
  severeAllergicReaction: YesNo;
  skinLesionOnArea: YesNo;
  details: string | null;
  professionalDecision: ProfessionalDecision | null;
  professionalComments: string | null;
}

export interface Guardian {
  relation: GuardianRelation | null;
  lastName: string | null;
  firstName: string | null;
}

/** Miroir de `ConsentAnswers` (Rust). */
export interface ConsentAnswers {
  informedNature: boolean;
  informedProcess: boolean;
  informedBenefits: boolean;
  informedRisks: boolean;
  informedContraindications: boolean;
  informedAftercare: boolean;
  informedWarningSigns: boolean;
  informedHealing: boolean;
  declaredHealthAnswers: boolean;
  declaredTreatments: boolean;
  declaredNotImpaired: boolean;
  declaredUnderstood: boolean;
  declaredAftercareCommitment: boolean;
  consents: boolean;
  questionsAnswered: boolean;
  guardian: Guardian | null;
}

export interface HealthForm {
  answers: HealthAnswers;
  updatedAt: string;
  missing: string[];
  flags: string[];
  signed: boolean;
}

export interface ConsentForm {
  answers: ConsentAnswers;
  updatedAt: string;
  missing: string[];
  signed: boolean;
}

export interface SessionDocument {
  id: string;
  sessionId: string;
  kind: DocumentKind;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
  voidReason: string | null;
  voidedAt: string | null;
}

export interface Paperwork {
  sessionId: string;
  sessionDate: string;
  sessionStatus: string;
  clientFirstName: string;
  clientLastName: string;
  clientBirthDate: string | null;
  /** Âge à la date de la séance ; `null` si la date de naissance manque. */
  clientAge: number | null;
  /** `null` : majorité impossible à vérifier (date de naissance manquante). */
  clientMinor: boolean | null;
  health: HealthForm | null;
  consent: ConsentForm | null;
  healthSigned: boolean;
  consentSigned: boolean;
  documents: SessionDocument[];
  readiness: Readiness | null;
  readinessReason: string | null;
  readinessValidatedAt: string | null;
}

export const emptyHealthAnswers = (): HealthAnswers => ({
  sickOrFever: null,
  currentInfection: null,
  recentSurgery: null,
  diabetes: null,
  coagulationDisorder: null,
  immunodeficiency: null,
  heartDisease: null,
  epilepsy: null,
  anticoagulant: null,
  healingTreatment: null,
  healingTreatmentDetails: null,
  allergies: [],
  allergyOther: null,
  pregnantOrBreastfeeding: null,
  severeAllergicReaction: null,
  skinLesionOnArea: null,
  details: null,
  professionalDecision: null,
  professionalComments: null,
});

export const emptyConsentAnswers = (): ConsentAnswers => ({
  informedNature: false,
  informedProcess: false,
  informedBenefits: false,
  informedRisks: false,
  informedContraindications: false,
  informedAftercare: false,
  informedWarningSigns: false,
  informedHealing: false,
  declaredHealthAnswers: false,
  declaredTreatments: false,
  declaredNotImpaired: false,
  declaredUnderstood: false,
  declaredAftercareCommitment: false,
  consents: false,
  questionsAnswered: false,
  guardian: null,
});

interface PaperworkState {
  get: (sessionId: string) => Promise<Paperwork>;
  saveHealth: (sessionId: string, answers: HealthAnswers) => Promise<Paperwork>;
  saveConsent: (sessionId: string, answers: ConsentAnswers) => Promise<Paperwork>;
  /** Génère le PDF pré-rempli et l'ouvre dans Aperçu. */
  print: (sessionId: string, kind: FormKind) => Promise<string>;
  openAftercare: () => Promise<void>;
  attach: (sessionId: string, kind: DocumentKind, sourcePath: string) => Promise<SessionDocument>;
  open: (documentId: string) => Promise<void>;
  voidDocument: (documentId: string, reason: string) => Promise<SessionDocument>;
}

export const usePaperworkStore = create<PaperworkState>(() => ({
  get: (sessionId) => invoke<Paperwork>("get_session_paperwork", { sessionId }),
  saveHealth: (sessionId, answers) => invoke<Paperwork>("save_health_form", { sessionId, answers }),
  saveConsent: (sessionId, answers) =>
    invoke<Paperwork>("save_consent_form", { sessionId, answers }),
  print: (sessionId, kind) => invoke<string>("print_session_form", { sessionId, kind }),
  openAftercare: () => invoke<void>("open_aftercare_sheet"),
  attach: (sessionId, kind, sourcePath) =>
    invoke<SessionDocument>("attach_session_document", { sessionId, kind, sourcePath }),
  open: (documentId) => invoke<void>("open_session_document", { documentId }),
  voidDocument: (documentId, reason) =>
    invoke<SessionDocument>("void_session_document", { documentId, reason }),
}));
