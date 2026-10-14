//! Questionnaire de santé, consentement éclairé et documents signés d'une séance.
//!
//! Déroulé : la tatoueuse saisit les réponses avec le client, l'app imprime le PDF
//! d'origine pré-rempli (`form_pdf`), le client le signe sur papier, puis le scan
//! ou la photo est joint à la séance. Dès qu'un document signé est joint, les
//! réponses correspondantes ne sont plus modifiables : elles doivent rester celles
//! que le client a signées.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::error::LotError;
use super::sql::NOW;

/// Version des formulaires papier suivis par les structs ci-dessous.
pub const FORM_VERSION: i64 = 1;

/// Taille maximale d'un document joint (scan ou photo).
const MAX_DOCUMENT_BYTES: u64 = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS: [&str; 5] = ["pdf", "jpg", "jpeg", "png", "heic"];

// ---------------------------------------------------------------------------
// Questionnaire de santé (QUESTIONNAIRE DE SANTÉ, v1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Allergy {
    Nickel,
    Latex,
    Antiseptics,
    Inks,
    Medications,
    Other,
}

impl Allergy {
    pub fn label(self) -> &'static str {
        match self {
            Self::Nickel => "Nickel",
            Self::Latex => "Latex",
            Self::Antiseptics => "Antiseptiques",
            Self::Inks => "Encres ou pigments",
            Self::Medications => "Médicaments",
            Self::Other => "Autre",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProfessionalDecision {
    /// « Prestation possible »
    Possible,
    /// « Report conseillé »
    Postpone,
    /// « Avis médical »
    MedicalAdvice,
}

impl ProfessionalDecision {
    pub fn label(self) -> &'static str {
        match self {
            Self::Possible => "Prestation possible",
            Self::Postpone => "Report conseillé",
            Self::MedicalAdvice => "Avis médical",
        }
    }
}

/// Réponses au questionnaire de santé. `None` = pas encore répondu.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HealthAnswers {
    // État général
    pub sick_or_fever: Option<bool>,
    pub current_infection: Option<bool>,
    pub recent_surgery: Option<bool>,
    // Antécédents médicaux
    pub diabetes: Option<bool>,
    pub coagulation_disorder: Option<bool>,
    pub immunodeficiency: Option<bool>,
    pub heart_disease: Option<bool>,
    pub epilepsy: Option<bool>,
    // Traitements en cours
    pub anticoagulant: Option<bool>,
    pub healing_treatment: Option<bool>,
    pub healing_treatment_details: Option<String>,
    // Allergies
    pub allergies: Vec<Allergy>,
    pub allergy_other: Option<String>,
    // Situations particulières
    pub pregnant_or_breastfeeding: Option<bool>,
    pub severe_allergic_reaction: Option<bool>,
    pub skin_lesion_on_area: Option<bool>,
    pub details: Option<String>,
    // Réservé au professionnel
    pub professional_decision: Option<ProfessionalDecision>,
    pub professional_comments: Option<String>,
}

/// Identifiant stable d'une question oui/non (sert au PDF et aux libellés).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthQuestion {
    SickOrFever,
    CurrentInfection,
    RecentSurgery,
    Diabetes,
    CoagulationDisorder,
    Immunodeficiency,
    HeartDisease,
    Epilepsy,
    Anticoagulant,
    HealingTreatment,
    PregnantOrBreastfeeding,
    SevereAllergicReaction,
    SkinLesionOnArea,
}

impl HealthQuestion {
    /// Libellé court, utilisé dans les alertes.
    pub fn label(self) -> &'static str {
        match self {
            Self::SickOrFever => "Malade ou fièvre",
            Self::CurrentInfection => "Infection en cours",
            Self::RecentSurgery => "Intervention chirurgicale récente",
            Self::Diabetes => "Diabète",
            Self::CoagulationDisorder => "Trouble de la coagulation",
            Self::Immunodeficiency => "Immunodépression ou traitement immunosuppresseur",
            Self::HeartDisease => "Maladie cardiaque",
            Self::Epilepsy => "Épilepsie",
            Self::Anticoagulant => "Traitement anticoagulant",
            Self::HealingTreatment => "Traitement influençant la cicatrisation",
            Self::PregnantOrBreastfeeding => "Enceinte ou allaitement",
            Self::SevereAllergicReaction => "Antécédent de réaction allergique importante",
            Self::SkinLesionOnArea => "Lésion cutanée sur la zone",
        }
    }
}

impl HealthAnswers {
    /// Les 13 questions oui/non, dans l'ordre du formulaire.
    pub fn yes_no(&self) -> [(HealthQuestion, Option<bool>); 13] {
        use HealthQuestion as Q;
        [
            (Q::SickOrFever, self.sick_or_fever),
            (Q::CurrentInfection, self.current_infection),
            (Q::RecentSurgery, self.recent_surgery),
            (Q::Diabetes, self.diabetes),
            (Q::CoagulationDisorder, self.coagulation_disorder),
            (Q::Immunodeficiency, self.immunodeficiency),
            (Q::HeartDisease, self.heart_disease),
            (Q::Epilepsy, self.epilepsy),
            (Q::Anticoagulant, self.anticoagulant),
            (Q::HealingTreatment, self.healing_treatment),
            (Q::PregnantOrBreastfeeding, self.pregnant_or_breastfeeding),
            (Q::SevereAllergicReaction, self.severe_allergic_reaction),
            (Q::SkinLesionOnArea, self.skin_lesion_on_area),
        ]
    }

    fn normalize(mut self) -> Result<Self, LotError> {
        self.healing_treatment_details = clean_text(self.healing_treatment_details);
        self.allergy_other = clean_text(self.allergy_other);
        self.details = clean_text(self.details);
        self.professional_comments = clean_text(self.professional_comments);
        let mut allergies = Vec::new();
        for allergy in self.allergies {
            if !allergies.contains(&allergy) {
                allergies.push(allergy);
            }
        }
        self.allergies = allergies;
        if self.healing_treatment != Some(true) && self.healing_treatment_details.is_some() {
            return Err(LotError::Invalid(
                "Le détail du traitement n'a de sens que si la réponse est « Oui »",
            ));
        }
        if !self.allergies.contains(&Allergy::Other) && self.allergy_other.is_some() {
            return Err(LotError::Invalid(
                "Précise l'allergie « Autre » seulement si la case est cochée",
            ));
        }
        Ok(self)
    }

    /// Ce qui manque pour considérer le questionnaire comme rempli.
    pub fn missing(&self) -> Vec<String> {
        let mut missing: Vec<String> = self
            .yes_no()
            .iter()
            .filter(|(_, answer)| answer.is_none())
            .map(|(question, _)| question.label().to_string())
            .collect();
        if self.healing_treatment == Some(true) && self.healing_treatment_details.is_none() {
            missing.push("Nom du traitement influençant la cicatrisation".into());
        }
        if self.allergies.contains(&Allergy::Other) && self.allergy_other.is_none() {
            missing.push("Précision de l'allergie « Autre »".into());
        }
        if self.professional_decision.is_none() {
            missing.push("Avis du professionnel".into());
        }
        missing
    }

    /// Points d'attention : réponses « Oui », allergies et avis réservé.
    pub fn flags(&self) -> Vec<String> {
        let mut flags: Vec<String> = self
            .yes_no()
            .iter()
            .filter(|(_, answer)| *answer == Some(true))
            .map(|(question, _)| question.label().to_string())
            .collect();
        for allergy in &self.allergies {
            let label = match (allergy, &self.allergy_other) {
                (Allergy::Other, Some(other)) => format!("Allergie : {other}"),
                _ => format!("Allergie : {}", allergy.label()),
            };
            flags.push(label);
        }
        if let Some(decision) = self.professional_decision {
            if decision != ProfessionalDecision::Possible {
                flags.push(format!("Avis du professionnel : {}", decision.label()));
            }
        }
        flags
    }
}

// ---------------------------------------------------------------------------
// Consentement éclairé (CONSENTEMENT ÉCLAIRÉ - TATOUAGE, v1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GuardianRelation {
    Father,
    Mother,
    LegalGuardian,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Guardian {
    pub relation: Option<GuardianRelation>,
    pub last_name: Option<String>,
    pub first_name: Option<String>,
}

/// Cases du consentement. Chaque case correspond à une case du papier.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConsentAnswers {
    // Information préalable
    pub informed_nature: bool,
    pub informed_process: bool,
    pub informed_benefits: bool,
    pub informed_risks: bool,
    pub informed_contraindications: bool,
    pub informed_aftercare: bool,
    pub informed_warning_signs: bool,
    pub informed_healing: bool,
    // Déclaration du client
    pub declared_health_answers: bool,
    pub declared_treatments: bool,
    pub declared_not_impaired: bool,
    pub declared_understood: bool,
    pub declared_aftercare_commitment: bool,
    // Consentement
    pub consents: bool,
    pub questions_answered: bool,
    // Représentant légal (client mineur)
    pub guardian: Option<Guardian>,
}

impl ConsentAnswers {
    /// Les 15 cases, dans l'ordre du formulaire, avec un libellé court.
    pub fn boxes(&self) -> [(&'static str, bool); 15] {
        [
            (
                "Information : nature de la prestation",
                self.informed_nature,
            ),
            ("Information : déroulement", self.informed_process),
            ("Information : bénéfices attendus", self.informed_benefits),
            (
                "Information : risques et complications",
                self.informed_risks,
            ),
            (
                "Information : contre-indications",
                self.informed_contraindications,
            ),
            ("Information : conseils post-acte", self.informed_aftercare),
            ("Information : signes d'alerte", self.informed_warning_signs),
            (
                "Information : modalités de cicatrisation",
                self.informed_healing,
            ),
            (
                "Déclaration : questionnaire de santé sincère",
                self.declared_health_answers,
            ),
            (
                "Déclaration : traitements, allergies et antécédents signalés",
                self.declared_treatments,
            ),
            (
                "Déclaration : pas sous l'emprise d'alcool ou de substances",
                self.declared_not_impaired,
            ),
            (
                "Déclaration : informations comprises",
                self.declared_understood,
            ),
            (
                "Déclaration : engagement à suivre les recommandations",
                self.declared_aftercare_commitment,
            ),
            ("Consentement libre à la prestation", self.consents),
            (
                "Possibilité de poser des questions",
                self.questions_answered,
            ),
        ]
    }

    fn normalize(mut self) -> Self {
        self.guardian = self.guardian.and_then(|guardian| {
            let guardian = Guardian {
                relation: guardian.relation,
                last_name: clean_text(guardian.last_name),
                first_name: clean_text(guardian.first_name),
            };
            if guardian == Guardian::default() {
                None
            } else {
                Some(guardian)
            }
        });
        self
    }

    /// Ce qui manque. `minor` : le client est mineur à la date de la séance.
    pub fn missing(&self, minor: Option<bool>) -> Vec<String> {
        let mut missing: Vec<String> = self
            .boxes()
            .iter()
            .filter(|(_, checked)| !checked)
            .map(|(label, _)| (*label).to_string())
            .collect();
        if minor == Some(true) {
            let guardian = self.guardian.clone().unwrap_or_default();
            if guardian.relation.is_none() {
                missing.push("Représentant légal : lien (père, mère, tuteur)".into());
            }
            if guardian.last_name.is_none() || guardian.first_name.is_none() {
                missing.push("Représentant légal : nom et prénom".into());
            }
        }
        missing
    }
}

fn clean_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

// ---------------------------------------------------------------------------
// Âge et majorité
// ---------------------------------------------------------------------------

/// Âge en années révolues à une date donnée. `None` si une date est illisible.
pub fn age_at(birth_date: &str, on: &str) -> Option<i64> {
    let birth = NaiveDate::parse_from_str(birth_date, "%Y-%m-%d").ok()?;
    let on = NaiveDate::parse_from_str(on, "%Y-%m-%d").ok()?;
    let mut age = i64::from(on.year() - birth.year());
    if (on.month(), on.day()) < (birth.month(), birth.day()) {
        age -= 1;
    }
    Some(age)
}

// ---------------------------------------------------------------------------
// Vue d'ensemble d'une séance
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DocumentKind {
    HealthSigned,
    ConsentSigned,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionDocument {
    pub id: String,
    pub session_id: String,
    pub kind: DocumentKind,
    #[serde(skip)]
    pub stored_name: String,
    pub original_name: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub void_reason: Option<String>,
    pub voided_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthForm {
    pub answers: HealthAnswers,
    pub updated_at: String,
    pub missing: Vec<String>,
    pub flags: Vec<String>,
    /// Un scan signé est joint : réponses figées.
    pub signed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentForm {
    pub answers: ConsentAnswers,
    pub updated_at: String,
    pub missing: Vec<String>,
    pub signed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paperwork {
    pub session_id: String,
    pub session_date: String,
    pub session_status: String,
    pub client_first_name: String,
    pub client_last_name: String,
    pub client_birth_date: Option<String>,
    /// Âge à la date de la séance ; `None` si la date de naissance manque.
    pub client_age: Option<i64>,
    /// `None` si la date de naissance manque : la majorité n'est pas vérifiable.
    pub client_minor: Option<bool>,
    pub health: Option<HealthForm>,
    pub consent: Option<ConsentForm>,
    pub health_signed: bool,
    pub consent_signed: bool,
    pub documents: Vec<SessionDocument>,
}

#[derive(sqlx::FromRow)]
struct SessionContext {
    date: String,
    status: String,
    first_name: String,
    last_name: String,
    birth_date: Option<String>,
}

async fn session_context(pool: &SqlitePool, session_id: &str) -> Result<SessionContext, LotError> {
    sqlx::query_as::<_, SessionContext>(
        "SELECT s.date, s.status, c.first_name, c.last_name, c.birth_date
         FROM sessions s INNER JOIN clients c ON c.id = s.client_id
         WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?
    .ok_or(LotError::Invalid("La séance est introuvable"))
}

async fn form_row(
    pool: &SqlitePool,
    session_id: &str,
    kind: &str,
) -> Result<Option<(String, String)>, LotError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT answers, updated_at FROM session_forms WHERE session_id = ? AND kind = ?",
    )
    .bind(session_id)
    .bind(kind)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

fn parse_answers<T: for<'de> Deserialize<'de>>(json: &str) -> Result<T, LotError> {
    serde_json::from_str(json).map_err(|error| {
        eprintln!("réponses de formulaire illisibles : {error}");
        LotError::Invalid("Les réponses enregistrées sont illisibles")
    })
}

async fn signed(pool: &SqlitePool, session_id: &str, kind: DocumentKind) -> Result<bool, LotError> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM session_documents
         WHERE session_id = ? AND kind = ? AND voided_at IS NULL LIMIT 1",
    )
    .bind(session_id)
    .bind(kind)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

pub async fn get_paperwork(pool: &SqlitePool, session_id: &str) -> Result<Paperwork, LotError> {
    let context = session_context(pool, session_id).await?;
    let client_age = context
        .birth_date
        .as_deref()
        .and_then(|birth| age_at(birth, &context.date));
    let client_minor = client_age.map(|age| age < 18);
    let health_signed = signed(pool, session_id, DocumentKind::HealthSigned).await?;
    let consent_signed = signed(pool, session_id, DocumentKind::ConsentSigned).await?;

    let health = match form_row(pool, session_id, "HEALTH").await? {
        Some((json, updated_at)) => {
            let answers: HealthAnswers = parse_answers(&json)?;
            Some(HealthForm {
                missing: answers.missing(),
                flags: answers.flags(),
                answers,
                updated_at,
                signed: health_signed,
            })
        }
        None => None,
    };
    let consent = match form_row(pool, session_id, "CONSENT").await? {
        Some((json, updated_at)) => {
            let answers: ConsentAnswers = parse_answers(&json)?;
            Some(ConsentForm {
                missing: answers.missing(client_minor),
                answers,
                updated_at,
                signed: consent_signed,
            })
        }
        None => None,
    };

    let documents = sqlx::query_as::<_, SessionDocument>(
        "SELECT id, session_id, kind, stored_name, original_name, size_bytes, created_at,
                void_reason, voided_at
         FROM session_documents WHERE session_id = ?
         ORDER BY created_at ASC, id ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    Ok(Paperwork {
        session_id: session_id.to_string(),
        session_date: context.date,
        session_status: context.status,
        client_first_name: context.first_name,
        client_last_name: context.last_name,
        client_birth_date: context.birth_date,
        client_age,
        client_minor,
        health,
        consent,
        health_signed,
        consent_signed,
        documents,
    })
}

async fn save_form(
    pool: &SqlitePool,
    session_id: &str,
    kind: &str,
    answers: String,
) -> Result<(), LotError> {
    let sql = format!(
        "INSERT INTO session_forms
            (id, session_id, kind, form_version, answers, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, {NOW}, {NOW})
         ON CONFLICT (session_id, kind) DO UPDATE
         SET answers = excluded.answers,
             form_version = excluded.form_version,
             updated_at = excluded.updated_at"
    );
    sqlx::query(&sql)
        .bind(session_id)
        .bind(kind)
        .bind(FORM_VERSION)
        .bind(answers)
        .execute(pool)
        .await?;
    Ok(())
}

pub const HEALTH_LOCKED: &str = "Le questionnaire signé est joint : les réponses ne sont plus modifiables. Pour corriger, annule le scan signé puis fais signer un nouveau questionnaire.";
pub const CONSENT_LOCKED: &str = "Le consentement signé est joint : les réponses ne sont plus modifiables. Pour corriger, annule le scan signé puis fais signer un nouveau consentement.";

pub async fn save_health(
    pool: &SqlitePool,
    session_id: &str,
    answers: HealthAnswers,
) -> Result<Paperwork, LotError> {
    session_context(pool, session_id).await?;
    if signed(pool, session_id, DocumentKind::HealthSigned).await? {
        return Err(LotError::Invalid(HEALTH_LOCKED));
    }
    let answers = answers.normalize()?;
    let json = serde_json::to_string(&answers)
        .map_err(|_| LotError::Invalid("Réponses impossibles à enregistrer"))?;
    save_form(pool, session_id, "HEALTH", json).await?;
    get_paperwork(pool, session_id).await
}

pub async fn save_consent(
    pool: &SqlitePool,
    session_id: &str,
    answers: ConsentAnswers,
) -> Result<Paperwork, LotError> {
    session_context(pool, session_id).await?;
    if signed(pool, session_id, DocumentKind::ConsentSigned).await? {
        return Err(LotError::Invalid(CONSENT_LOCKED));
    }
    let answers = answers.normalize();
    let json = serde_json::to_string(&answers)
        .map_err(|_| LotError::Invalid("Réponses impossibles à enregistrer"))?;
    save_form(pool, session_id, "CONSENT", json).await?;
    get_paperwork(pool, session_id).await
}

// ---------------------------------------------------------------------------
// Documents joints
// ---------------------------------------------------------------------------

/// Dossier des fichiers d'une séance. L'identifiant vient de la base (hexadécimal),
/// on le vérifie quand même pour ne jamais sortir du dossier documents.
pub fn session_dir(documents_root: &Path, session_id: &str) -> Result<PathBuf, LotError> {
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(LotError::Invalid("Identifiant de séance invalide"));
    }
    Ok(documents_root.join(session_id))
}

fn file_error(error: std::io::Error) -> LotError {
    eprintln!("erreur fichier : {error}");
    LotError::Invalid("Le fichier n'a pas pu être copié dans le dossier de l'app")
}

pub async fn attach_document(
    pool: &SqlitePool,
    documents_root: &Path,
    session_id: &str,
    kind: DocumentKind,
    source: &Path,
) -> Result<SessionDocument, LotError> {
    session_context(pool, session_id).await?;
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(LotError::Invalid(
            "Formats acceptés : PDF, JPEG, PNG ou HEIC",
        ));
    }
    let metadata = fs::metadata(source).map_err(|_| LotError::Invalid("Fichier introuvable"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(LotError::Invalid("Le fichier est vide ou illisible"));
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(LotError::Invalid("Le fichier dépasse 25 Mo"));
    }
    let original_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document")
        .to_string();

    let id: String = sqlx::query_scalar("SELECT lower(hex(randomblob(16)))")
        .fetch_one(pool)
        .await?;
    let stored_name = format!("{id}.{extension}");
    let dir = session_dir(documents_root, session_id)?;
    fs::create_dir_all(&dir).map_err(file_error)?;
    let destination = dir.join(&stored_name);
    fs::copy(source, &destination).map_err(file_error)?;

    let sql = format!(
        "INSERT INTO session_documents
            (id, session_id, kind, stored_name, original_name, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, {NOW})"
    );
    let inserted = sqlx::query(&sql)
        .bind(&id)
        .bind(session_id)
        .bind(kind)
        .bind(&stored_name)
        .bind(&original_name)
        .bind(i64::try_from(metadata.len()).unwrap_or(i64::MAX))
        .execute(pool)
        .await;
    if let Err(error) = inserted {
        // La base refuse : ne pas laisser un fichier orphelin.
        let _ = fs::remove_file(&destination);
        return Err(error.into());
    }
    get_document(pool, &id).await
}

pub async fn get_document(pool: &SqlitePool, id: &str) -> Result<SessionDocument, LotError> {
    sqlx::query_as::<_, SessionDocument>(
        "SELECT id, session_id, kind, stored_name, original_name, size_bytes, created_at,
                void_reason, voided_at
         FROM session_documents WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(LotError::NotFound)
}

/// Chemin du fichier d'un document joint (pour l'ouvrir).
pub async fn document_path(
    pool: &SqlitePool,
    documents_root: &Path,
    id: &str,
) -> Result<PathBuf, LotError> {
    let document = get_document(pool, id).await?;
    let path = session_dir(documents_root, &document.session_id)?.join(&document.stored_name);
    if !path.is_file() {
        return Err(LotError::Invalid(
            "Le fichier de ce document est introuvable dans le dossier de l'app",
        ));
    }
    Ok(path)
}

pub async fn void_document(
    pool: &SqlitePool,
    id: &str,
    reason: &str,
) -> Result<SessionDocument, LotError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(LotError::Invalid("Le motif d'annulation est obligatoire"));
    }
    let document = get_document(pool, id).await?;
    if document.voided_at.is_some() {
        return Err(LotError::Invalid("Ce document est déjà annulé"));
    }
    let sql = format!(
        "UPDATE session_documents SET void_reason = ?, voided_at = {NOW}
         WHERE id = ? AND voided_at IS NULL"
    );
    sqlx::query(&sql)
        .bind(reason)
        .bind(id)
        .execute(pool)
        .await?;
    get_document(pool, id).await
}

// ---------------------------------------------------------------------------
// Impression
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormKind {
    Health,
    Consent,
}

#[derive(sqlx::FromRow)]
struct IdentityRow {
    date: String,
    first_name: String,
    last_name: String,
    birth_date: Option<String>,
    address: Option<String>,
    phone: Option<String>,
    email: Option<String>,
}

/// Écrit le formulaire pré-rempli dans `documents/<séance>/a-imprimer/` et renvoie
/// son chemin. Sans réponses enregistrées, le formulaire sort avec la seule identité.
pub async fn print_form(
    pool: &SqlitePool,
    documents_root: &Path,
    studio: &crate::config::StudioSettings,
    session_id: &str,
    kind: FormKind,
) -> Result<PathBuf, LotError> {
    let row = sqlx::query_as::<_, IdentityRow>(
        "SELECT s.date, c.first_name, c.last_name, c.birth_date, c.address, c.phone, c.email
         FROM sessions s INNER JOIN clients c ON c.id = s.client_id
         WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?
    .ok_or(LotError::Invalid("La séance est introuvable"))?;
    let identity = super::form_pdf::Identity {
        last_name: row.last_name,
        first_name: row.first_name,
        birth_date: row.birth_date,
        address: row.address,
        phone: row.phone,
        email: row.email,
        session_date: row.date,
        professional_name: studio.professional_name.trim().to_string(),
        city: studio.city.trim().to_string(),
    };

    let (bytes, file_name) = match kind {
        FormKind::Health => {
            let answers = match form_row(pool, session_id, "HEALTH").await? {
                Some((json, _)) => parse_answers(&json)?,
                None => HealthAnswers::default(),
            };
            (
                super::form_pdf::health_pdf(&identity, &answers),
                "questionnaire-sante.pdf",
            )
        }
        FormKind::Consent => {
            let answers = match form_row(pool, session_id, "CONSENT").await? {
                Some((json, _)) => parse_answers(&json)?,
                None => ConsentAnswers::default(),
            };
            (
                super::form_pdf::consent_pdf(&identity, &answers),
                "consentement.pdf",
            )
        }
    };
    let bytes = bytes.map_err(|error| {
        eprintln!("génération PDF : {error}");
        LotError::Invalid("Le PDF n'a pas pu être généré")
    })?;

    let dir = session_dir(documents_root, session_id)?.join("a-imprimer");
    fs::create_dir_all(&dir).map_err(file_error)?;
    let path = dir.join(file_name);
    fs::write(&path, bytes).map_err(file_error)?;
    Ok(path)
}

/// Copie la fiche de conseils de cicatrisation dans le dossier documents.
pub fn aftercare_sheet(documents_root: &Path) -> Result<PathBuf, LotError> {
    fs::create_dir_all(documents_root).map_err(file_error)?;
    let path = documents_root.join("conseils-cicatrisation.pdf");
    fs::write(&path, super::form_pdf::AFTERCARE_PDF).map_err(file_error)?;
    Ok(path)
}
