//! Questionnaires, consentements et documents signés.

use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::paperwork::{
    self, age_at, Allergy, ConsentAnswers, DocumentKind, FormKind, Guardian, GuardianRelation,
    HealthAnswers, ProfessionalDecision, CONSENT_LOCKED, HEALTH_LOCKED,
};
use crate::config::StudioSettings;

async fn db(birth_date: Option<&str>) -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .in_memory(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO clients (id, first_name, last_name, birth_date, address, created_at, updated_at)
         VALUES ('c1', 'Léa', 'Martin', ?, '12 rue des Écoles, Lyon',
                 '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
    )
    .bind(birth_date)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO sessions (id, client_id, date, status, created_at, updated_at)
         VALUES ('s1', 'c1', '2026-10-14', 'PLANNED', '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tracink-paperwork-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn complete_health() -> HealthAnswers {
    HealthAnswers {
        sick_or_fever: Some(false),
        current_infection: Some(false),
        recent_surgery: Some(false),
        diabetes: Some(true),
        coagulation_disorder: Some(false),
        immunodeficiency: Some(false),
        heart_disease: Some(false),
        epilepsy: Some(false),
        anticoagulant: Some(false),
        healing_treatment: Some(false),
        healing_treatment_details: None,
        allergies: vec![Allergy::Latex],
        allergy_other: None,
        pregnant_or_breastfeeding: Some(false),
        severe_allergic_reaction: Some(false),
        skin_lesion_on_area: Some(false),
        details: None,
        professional_decision: Some(ProfessionalDecision::Possible),
        professional_comments: None,
    }
}

fn complete_consent() -> ConsentAnswers {
    ConsentAnswers {
        informed_nature: true,
        informed_process: true,
        informed_benefits: true,
        informed_risks: true,
        informed_contraindications: true,
        informed_aftercare: true,
        informed_warning_signs: true,
        informed_healing: true,
        declared_health_answers: true,
        declared_treatments: true,
        declared_not_impaired: true,
        declared_understood: true,
        declared_aftercare_commitment: true,
        consents: true,
        questions_answered: true,
        guardian: None,
    }
}

#[test]
fn age_counts_completed_years_at_the_session_date() {
    assert_eq!(age_at("2008-10-14", "2026-10-14"), Some(18));
    assert_eq!(age_at("2008-10-15", "2026-10-14"), Some(17));
    assert_eq!(age_at("2008-02-29", "2026-02-28"), Some(17));
    assert_eq!(age_at("pas une date", "2026-10-14"), None);
}

#[tokio::test]
async fn health_answers_are_saved_with_missing_items_and_flags() {
    let pool = db(Some("1995-04-02")).await;
    let paperwork = paperwork::save_health(&pool, "s1", HealthAnswers::default())
        .await
        .unwrap();
    let health = paperwork.health.unwrap();
    assert_eq!(health.missing.len(), 14); // 13 questions + avis du professionnel
    assert!(health.flags.is_empty());

    let paperwork = paperwork::save_health(&pool, "s1", complete_health())
        .await
        .unwrap();
    let health = paperwork.health.unwrap();
    assert!(health.missing.is_empty());
    assert_eq!(health.flags, vec!["Diabète", "Allergie : Latex"]);
    assert_eq!(paperwork.client_age, Some(31));
    assert_eq!(paperwork.client_minor, Some(false));
}

#[tokio::test]
async fn a_yes_answer_asks_for_its_details() {
    let pool = db(None).await;
    let mut answers = complete_health();
    answers.healing_treatment = Some(true);
    answers.allergies = vec![Allergy::Other];
    let health = paperwork::save_health(&pool, "s1", answers)
        .await
        .unwrap()
        .health
        .unwrap();
    assert_eq!(
        health.missing,
        vec![
            "Nom du traitement influençant la cicatrisation",
            "Précision de l'allergie « Autre »"
        ]
    );

    let mut inconsistent = complete_health();
    inconsistent.healing_treatment_details = Some("Isotrétinoïne".into());
    let error = paperwork::save_health(&pool, "s1", inconsistent)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("« Oui »"));
}

#[tokio::test]
async fn a_minor_needs_a_legal_guardian() {
    let pool = db(Some("2010-01-01")).await;
    let paperwork = paperwork::save_consent(&pool, "s1", complete_consent())
        .await
        .unwrap();
    assert_eq!(paperwork.client_minor, Some(true));
    let consent = paperwork.consent.unwrap();
    assert_eq!(consent.missing.len(), 2);

    let mut answers = complete_consent();
    answers.guardian = Some(Guardian {
        relation: Some(GuardianRelation::Mother),
        last_name: Some(" Martin ".into()),
        first_name: Some("Sophie".into()),
    });
    let consent = paperwork::save_consent(&pool, "s1", answers)
        .await
        .unwrap()
        .consent
        .unwrap();
    assert!(consent.missing.is_empty());
    assert_eq!(
        consent.answers.guardian.unwrap().last_name.as_deref(),
        Some("Martin")
    );
}

#[tokio::test]
async fn an_unknown_birth_date_leaves_majority_unknown() {
    let pool = db(None).await;
    let paperwork = paperwork::get_paperwork(&pool, "s1").await.unwrap();
    assert_eq!(paperwork.client_minor, None);
    assert!(paperwork.health.is_none());
    assert!(paperwork.consent.is_none());
}

#[tokio::test]
async fn a_signed_scan_freezes_the_answers_until_it_is_voided() {
    let pool = db(Some("1995-04-02")).await;
    let dir = TempDir::new();
    let documents = dir.0.join("documents");
    paperwork::save_health(&pool, "s1", complete_health())
        .await
        .unwrap();
    paperwork::save_consent(&pool, "s1", complete_consent())
        .await
        .unwrap();

    let scan = dir.file("Scan questionnaire.PDF", b"%PDF-1.4 scan");
    let document =
        paperwork::attach_document(&pool, &documents, "s1", DocumentKind::HealthSigned, &scan)
            .await
            .unwrap();
    assert_eq!(document.original_name, "Scan questionnaire.PDF");
    let stored = paperwork::document_path(&pool, &documents, &document.id)
        .await
        .unwrap();
    assert_eq!(std::fs::read(stored).unwrap(), b"%PDF-1.4 scan");

    let error = paperwork::save_health(&pool, "s1", complete_health())
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), HEALTH_LOCKED);
    // Le consentement, lui, n'est pas encore signé.
    paperwork::save_consent(&pool, "s1", complete_consent())
        .await
        .unwrap();

    let error = paperwork::void_document(&pool, &document.id, "  ")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Le motif d'annulation est obligatoire");
    let voided = paperwork::void_document(&pool, &document.id, "Mauvaise page scannée")
        .await
        .unwrap();
    assert!(voided.voided_at.is_some());
    let error = paperwork::void_document(&pool, &document.id, "Encore")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Ce document est déjà annulé");

    // Le document annulé reste listé, et les réponses redeviennent modifiables.
    let paperwork = paperwork::save_health(&pool, "s1", complete_health())
        .await
        .unwrap();
    assert!(!paperwork.health_signed);
    assert_eq!(paperwork.documents.len(), 1);

    paperwork::attach_document(
        &pool,
        &documents,
        "s1",
        DocumentKind::ConsentSigned,
        &dir.file("consentement.jpg", b"jpeg"),
    )
    .await
    .unwrap();
    let error = paperwork::save_consent(&pool, "s1", complete_consent())
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), CONSENT_LOCKED);
}

#[tokio::test]
async fn only_scans_and_photos_are_accepted() {
    let pool = db(None).await;
    let dir = TempDir::new();
    let documents = dir.0.join("documents");
    for (name, bytes) in [
        ("notes.txt", b"texte".as_slice()),
        ("vide.pdf", b"".as_slice()),
    ] {
        let error = paperwork::attach_document(
            &pool,
            &documents,
            "s1",
            DocumentKind::Other,
            &dir.file(name, bytes),
        )
        .await
        .unwrap_err();
        assert!(!error.to_string().is_empty());
    }
    let error = paperwork::attach_document(
        &pool,
        &documents,
        "inconnue",
        DocumentKind::Other,
        &dir.file("ok.png", b"png"),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "La séance est introuvable");
}

#[tokio::test]
async fn a_joined_document_cannot_be_rewritten_in_the_database() {
    let pool = db(None).await;
    let dir = TempDir::new();
    let document = paperwork::attach_document(
        &pool,
        &dir.0.join("documents"),
        "s1",
        DocumentKind::Other,
        &dir.file("photo.png", b"png"),
    )
    .await
    .unwrap();
    let rewritten = sqlx::query("UPDATE session_documents SET original_name = 'x' WHERE id = ?")
        .bind(&document.id)
        .execute(&pool)
        .await;
    assert!(rewritten.is_err());
}

#[tokio::test]
async fn printing_writes_the_filled_form_in_the_session_folder() {
    let pool = db(Some("1995-04-02")).await;
    let dir = TempDir::new();
    let documents = dir.0.join("documents");
    let studio = StudioSettings {
        professional_name: "Camille Durand".into(),
        city: "Lyon".into(),
    };
    // Sans réponses : formulaire avec la seule identité.
    let blank = paperwork::print_form(&pool, &documents, &studio, "s1", FormKind::Consent)
        .await
        .unwrap();
    assert!(blank.ends_with("s1/a-imprimer/consentement.pdf"));

    paperwork::save_health(&pool, "s1", complete_health())
        .await
        .unwrap();
    let path = paperwork::print_form(&pool, &documents, &studio, "s1", FormKind::Health)
        .await
        .unwrap();
    let bytes = std::fs::read(path).unwrap();
    assert!(bytes.starts_with(b"%PDF"));

    let sheet = paperwork::aftercare_sheet(&documents).unwrap();
    assert!(std::fs::read(sheet).unwrap().starts_with(b"%PDF"));
}

#[test]
fn a_session_folder_never_leaves_the_documents_folder() {
    let root = PathBuf::from("/docs");
    assert!(paperwork::session_dir(&root, "../etc").is_err());
    assert!(paperwork::session_dir(&root, "").is_err());
    assert_eq!(
        paperwork::session_dir(&root, "abc123").unwrap(),
        PathBuf::from("/docs/abc123")
    );
}
