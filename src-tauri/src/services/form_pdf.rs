//! Pré-remplissage des formulaires papier de l'atelier.
//!
//! On écrit par-dessus les PDF d'origine (`assets/forms/`) : le document imprimé est
//! exactement celui de la tatoueuse, avec les réponses à la place des pointillés et
//! des cases. Les coordonnées sont celles des formulaires v1 (A4, 595 × 842 pt),
//! relevées en points depuis le haut de la page.

use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream, StringFormat};

use super::paperwork::{
    Allergy, ConsentAnswers, GuardianRelation, HealthAnswers, HealthQuestion, ProfessionalDecision,
};

pub const HEALTH_TEMPLATE: &[u8] = include_bytes!("../../assets/forms/questionnaire-sante-v1.pdf");
pub const CONSENT_TEMPLATE: &[u8] = include_bytes!("../../assets/forms/consentement-v1.pdf");
pub const AFTERCARE_PDF: &[u8] = include_bytes!("../../assets/forms/conseils-cicatrisation.pdf");

const PAGE_HEIGHT: f32 = 842.0;
const FONT: &str = "TracinkHelv";
const FONT_BOLD: &str = "TracinkHelvBold";
/// Bleu encre : on distingue le pré-rempli de l'imprimé d'origine.
const INK: (f32, f32, f32) = (0.08, 0.16, 0.45);

/// Identité imprimée en tête des formulaires.
#[derive(Debug, Clone, Default)]
pub struct Identity {
    pub last_name: String,
    pub first_name: String,
    pub birth_date: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub session_date: String,
    pub professional_name: String,
    pub city: String,
}

#[derive(Debug)]
pub struct PdfError(String);

impl std::fmt::Display for PdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<lopdf::Error> for PdfError {
    fn from(error: lopdf::Error) -> Self {
        Self(error.to_string())
    }
}

/// Opérations de dessin sur une page, en coordonnées « depuis le haut ».
#[derive(Default)]
struct Overlay {
    ops: Vec<Operation>,
}

impl Overlay {
    /// Texte dont la ligne de base est à `baseline` points du haut de la page.
    fn text(&mut self, x: f32, baseline: f32, size: f32, text: &str) {
        self.text_with(FONT, x, baseline, size, text);
    }

    fn text_with(&mut self, font: &str, x: f32, baseline: f32, size: f32, text: &str) {
        if text.is_empty() {
            return;
        }
        let (r, g, b) = INK;
        self.ops.extend([
            Operation::new("BT", vec![]),
            Operation::new("rg", vec![r.into(), g.into(), b.into()]),
            Operation::new(
                "Tf",
                vec![Object::Name(font.as_bytes().to_vec()), size.into()],
            ),
            Operation::new("Td", vec![x.into(), (PAGE_HEIGHT - baseline).into()]),
            Operation::new(
                "Tj",
                vec![Object::String(win_ansi(text), StringFormat::Hexadecimal)],
            ),
            Operation::new("ET", vec![]),
        ]);
    }

    /// Coche une case ☐ dont le coin gauche est en `x` et la ligne de base en `baseline`.
    fn check(&mut self, x: f32, baseline: f32) {
        self.text_with(FONT_BOLD, x + 0.4, baseline, 9.0, "X");
    }

    /// Texte réparti sur plusieurs lignes de pointillés ; tronqué avec « … » si trop long.
    fn lines(&mut self, x: f32, baselines: &[f32], width: f32, size: f32, text: &str) {
        let wrapped = wrap(text, width, size);
        for (index, baseline) in baselines.iter().enumerate() {
            let Some(line) = wrapped.get(index) else {
                break;
            };
            let mut line = line.clone();
            if index == baselines.len() - 1 && wrapped.len() > baselines.len() {
                line.push('…');
            }
            self.text(x, *baseline, size, &line);
        }
    }

    /// Date `AAAA-MM-JJ` écrite dans les trois zones « ..../..../........ ».
    fn date(&mut self, xs: [f32; 3], baseline: f32, size: f32, iso: &str) {
        let parts: Vec<&str> = iso.split('-').collect();
        if let [year, month, day] = parts.as_slice() {
            self.text(xs[0], baseline, size, day);
            self.text(xs[1], baseline, size, month);
            self.text(xs[2], baseline, size, year);
        }
    }
}

/// Largeur approximative d'un caractère en Helvetica (fraction de la taille).
fn char_width(c: char) -> f32 {
    match c {
        'i' | 'j' | 'l' | '.' | ',' | ':' | ';' | '\'' | '!' | '|' | ' ' => 0.28,
        'f' | 't' | 'r' | 'I' | '(' | ')' | '-' => 0.36,
        'm' | 'w' | 'M' | 'W' => 0.82,
        c if c.is_uppercase() => 0.68,
        _ => 0.54,
    }
}

fn text_width(text: &str, size: f32) -> f32 {
    text.chars().map(char_width).sum::<f32>() * size
}

fn wrap(text: &str, width: f32, size: f32) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in text.lines() {
        let mut current = String::new();
        for word in paragraph.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };
            if text_width(&candidate, size) > width && !current.is_empty() {
                lines.push(std::mem::take(&mut current));
                current = word.to_string();
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    lines
}

/// Encodage WinAnsi (Windows-1252) attendu par les polices standard du PDF.
fn win_ansi(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| match c {
            '\u{20}'..='\u{7e}' => c as u8,
            '\u{a0}'..='\u{ff}' => c as u32 as u8,
            '€' => 0x80,
            '…' => 0x85,
            'Œ' => 0x8c,
            '‘' => 0x91,
            '’' => 0x92,
            '“' => 0x93,
            '”' => 0x94,
            '–' => 0x96,
            '—' => 0x97,
            'œ' => 0x9c,
            _ => b'?',
        })
        .collect()
}

/// Ajoute les deux polices standard aux ressources de la page.
fn add_fonts(doc: &mut Document, page_id: ObjectId) -> Result<(), PdfError> {
    let regular = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let bold = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica-Bold",
        "Encoding" => "WinAnsiEncoding",
    });

    // Les ressources peuvent être directes ou référencées, et le dictionnaire
    // des polices aussi : on suit les références avant d'écrire.
    let resources = doc.get_dictionary(page_id)?.get(b"Resources").ok().cloned();
    let resources_id = match resources {
        Some(Object::Reference(id)) => id,
        Some(Object::Dictionary(dict)) => {
            let id = doc.add_object(dict);
            doc.get_dictionary_mut(page_id)?
                .set("Resources", Object::Reference(id));
            id
        }
        _ => {
            let id = doc.add_object(dictionary! {});
            doc.get_dictionary_mut(page_id)?
                .set("Resources", Object::Reference(id));
            id
        }
    };
    let fonts = doc.get_dictionary(resources_id)?.get(b"Font").ok().cloned();
    let fonts_id = match fonts {
        Some(Object::Reference(id)) => id,
        Some(Object::Dictionary(dict)) => {
            let id = doc.add_object(dict);
            doc.get_dictionary_mut(resources_id)?
                .set("Font", Object::Reference(id));
            id
        }
        _ => {
            let id = doc.add_object(dictionary! {});
            doc.get_dictionary_mut(resources_id)?
                .set("Font", Object::Reference(id));
            id
        }
    };
    let fonts = doc.get_dictionary_mut(fonts_id)?;
    fonts.set(FONT, Object::Reference(regular));
    fonts.set(FONT_BOLD, Object::Reference(bold));
    Ok(())
}

/// Dessine `overlay` au-dessus de la première page et renvoie le PDF.
fn render(template: &[u8], overlay: Overlay) -> Result<Vec<u8>, PdfError> {
    let mut doc = Document::load_mem(template)?;
    let page_id = *doc
        .get_pages()
        .get(&1)
        .ok_or_else(|| PdfError("Le modèle de formulaire n'a pas de page".into()))?;
    add_fonts(&mut doc, page_id)?;

    // Le contenu d'origine est isolé entre q/Q pour que son état graphique
    // (transformations, couleurs) ne déplace pas nos ajouts.
    let save = doc.add_object(Stream::new(dictionary! {}, b"q\n".to_vec()));
    let mut ours = vec![Operation::new("Q", vec![])];
    ours.extend(overlay.ops);
    let content = Content { operations: ours }.encode()?;
    let added = doc.add_object(Stream::new(dictionary! {}, content));

    let existing = doc.get_dictionary(page_id)?.get(b"Contents")?.clone();
    let mut contents = vec![Object::Reference(save)];
    match existing {
        Object::Array(items) => contents.extend(items),
        other => contents.push(other),
    }
    contents.push(Object::Reference(added));
    doc.get_dictionary_mut(page_id)?
        .set("Contents", Object::Array(contents));

    let mut bytes = Vec::new();
    doc.save_to(&mut bytes)
        .map_err(|error| PdfError(error.to_string()))?;
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Questionnaire de santé v1
// ---------------------------------------------------------------------------

/// Position des cases « Oui » et « Non » et ligne de base de chaque question.
fn health_boxes(question: HealthQuestion) -> (f32, f32, f32) {
    use HealthQuestion as Q;
    match question {
        Q::SickOrFever => (310.0, 334.0, 151.0),
        Q::CurrentInfection => (310.0, 334.0, 179.0),
        Q::RecentSurgery => (310.0, 334.0, 207.0),
        Q::Diabetes => (119.0, 142.0, 280.0),
        Q::CoagulationDisorder => (200.0, 223.0, 294.0),
        Q::Immunodeficiency => (113.0, 137.0, 322.0),
        Q::HeartDisease => (182.0, 205.0, 336.0),
        Q::Epilepsy => (119.0, 142.0, 350.0),
        Q::Anticoagulant => (469.0, 493.0, 280.0),
        Q::HealingTreatment => (310.0, 334.0, 308.0),
        Q::PregnantOrBreastfeeding => (450.0, 474.0, 451.0),
        Q::SevereAllergicReaction => (310.0, 334.0, 479.0),
        Q::SkinLesionOnArea => (391.0, 415.0, 507.0),
    }
}

fn allergy_baseline(allergy: Allergy) -> f32 {
    match allergy {
        Allergy::Nickel => 479.0,
        Allergy::Latex => 493.0,
        Allergy::Antiseptics => 507.0,
        Allergy::Inks => 521.0,
        Allergy::Medications => 535.0,
        Allergy::Other => 549.0,
    }
}

pub fn health_pdf(identity: &Identity, answers: &HealthAnswers) -> Result<Vec<u8>, PdfError> {
    let mut o = Overlay::default();
    let size = 9.0;

    o.text(54.0, 137.0, size, &identity.last_name);
    o.text(65.0, 151.0, size, &identity.first_name);
    if let Some(birth) = &identity.birth_date {
        o.date([104.0, 124.0, 144.0], 165.0, size, birth);
    }
    o.date([113.0, 133.0, 153.0], 179.0, size, &identity.session_date);

    for (question, answer) in answers.yes_no() {
        let (yes, no, baseline) = health_boxes(question);
        match answer {
            Some(true) => o.check(yes, baseline),
            Some(false) => o.check(no, baseline),
            None => {}
        }
    }
    if let Some(details) = &answers.healing_treatment_details {
        o.lines(312.0, &[335.0, 349.0, 363.0, 377.0], 250.0, size, details);
    }
    for allergy in &answers.allergies {
        o.check(29.0, allergy_baseline(*allergy));
    }
    if let Some(other) = &answers.allergy_other {
        o.lines(66.0, &[549.0], 130.0, size, other);
    }
    if let Some(details) = &answers.details {
        o.lines(312.0, &[534.0, 548.0, 562.0, 576.0], 250.0, size, details);
    }
    if let Some(decision) = answers.professional_decision {
        let x = match decision {
            ProfessionalDecision::Possible => 310.0,
            ProfessionalDecision::Postpone => 398.0,
            ProfessionalDecision::MedicalAdvice => 474.0,
        };
        o.check(x, 650.0);
    }
    if let Some(comments) = &answers.professional_comments {
        o.lines(312.0, &[673.0, 688.0], 250.0, size, comments);
    }
    // Dates de signature : celle de la séance.
    o.date([334.0, 354.0, 374.0], 705.0, size, &identity.session_date);
    o.date([53.0, 73.0, 93.0], 719.0, size, &identity.session_date);

    render(HEALTH_TEMPLATE, o)
}

// ---------------------------------------------------------------------------
// Consentement éclairé v1
// ---------------------------------------------------------------------------

pub fn consent_pdf(identity: &Identity, answers: &ConsentAnswers) -> Result<Vec<u8>, PdfError> {
    let mut o = Overlay::default();
    let size = 9.0;
    // Lignes du formulaire : 14 pt d'interligne. Le texte se pose sur les pointillés
    // (`line`), les coches sur la ligne de base des cases (`row`).
    let row = |top: f32| top + 12.0;
    let line = |top: f32| top + 13.5;

    o.text(57.0, line(116.0), size, &identity.last_name);
    o.text(68.0, line(130.0), size, &identity.first_name);
    if let Some(birth) = &identity.birth_date {
        o.date([109.0, 129.0, 149.0], line(144.0), size, birth);
    }
    if let Some(address) = &identity.address {
        let lines = wrap(address, 128.0, size);
        let first = lines.first().cloned().unwrap_or_default();
        let rest = lines.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
        o.text(70.0, line(158.0), size, &first);
        o.lines(35.0, &[line(172.0)], 220.0, size, &rest);
    }
    if let Some(phone) = &identity.phone {
        o.text(78.0, line(186.0), size, phone);
    }
    if let Some(email) = &identity.email {
        o.lines(65.0, &[line(200.0)], 185.0, size, email);
    }
    o.date(
        [119.0, 139.0, 159.0],
        line(214.0),
        size,
        &identity.session_date,
    );
    o.lines(
        145.0,
        &[line(228.0)],
        110.0,
        size,
        &identity.professional_name,
    );

    let informed = [
        answers.informed_nature,
        answers.informed_process,
        answers.informed_benefits,
        answers.informed_risks,
        answers.informed_contraindications,
        answers.informed_aftercare,
        answers.informed_warning_signs,
        answers.informed_healing,
    ];
    for (index, checked) in informed.iter().enumerate() {
        if *checked {
            o.check(314.0, row(144.0 + 14.0 * index as f32));
        }
    }
    let declared = [
        (answers.declared_health_answers, 329.0),
        (answers.declared_treatments, 343.0),
        (answers.declared_not_impaired, 371.0),
        (answers.declared_understood, 399.0),
        (answers.declared_aftercare_commitment, 413.0),
    ];
    for (checked, top) in declared {
        if checked {
            o.check(33.0, row(top));
        }
    }
    if answers.consents {
        o.check(314.0, row(343.0));
    }
    if answers.questions_answered {
        o.check(76.0, row(474.0));
    }

    if let Some(guardian) = &answers.guardian {
        let full_name = [
            guardian.first_name.as_deref(),
            guardian.last_name.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        o.lines(97.0, &[line(579.0)], 155.0, size, &full_name);
        if let Some(relation) = guardian.relation {
            let x = match relation {
                GuardianRelation::Father => 33.0,
                GuardianRelation::Mother => 66.0,
                GuardianRelation::LegalGuardian => 102.0,
            };
            o.check(x, row(593.0));
        }
        if let Some(last_name) = &guardian.last_name {
            o.text(57.0, line(607.0), size, last_name);
        }
        if let Some(first_name) = &guardian.first_name {
            o.text(68.0, line(621.0), size, first_name);
        }
    }

    o.lines(342.0, &[line(593.0)], 210.0, size, &identity.city);
    o.date([330.0, 350.0, 370.0], 619.0, size, &identity.session_date);

    render(CONSENT_TEMPLATE, o)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Identity {
        Identity {
            last_name: "Martin".into(),
            first_name: "Léa".into(),
            birth_date: Some("1995-04-02".into()),
            address: Some("12 rue des Écoles, 69001 Lyon".into()),
            phone: Some("06 12 34 56 78".into()),
            email: Some("lea@exemple.fr".into()),
            session_date: "2026-10-14".into(),
            professional_name: "Camille Durand".into(),
            city: "Lyon".into(),
        }
    }

    #[test]
    fn accented_text_uses_win_ansi() {
        assert_eq!(
            win_ansi("Léa’s œ…"),
            vec![0x4c, 0xe9, 0x61, 0x92, 0x73, 0x20, 0x9c, 0x85]
        );
        assert_eq!(win_ansi("✓"), vec![b'?']);
    }

    #[test]
    fn long_text_is_wrapped_by_width() {
        let lines = wrap("un deux trois quatre cinq six sept", 40.0, 9.0);
        assert!(lines.len() > 1);
        assert!(lines
            .iter()
            .all(|line| text_width(line, 9.0) <= 40.0 || !line.contains(' ')));
    }

    #[test]
    fn filled_forms_are_valid_one_page_pdfs() {
        let health = HealthAnswers {
            diabetes: Some(true),
            healing_treatment: Some(true),
            healing_treatment_details: Some("Isotrétinoïne".into()),
            allergies: vec![Allergy::Latex],
            ..HealthAnswers::default()
        };
        let consent = ConsentAnswers {
            consents: true,
            ..ConsentAnswers::default()
        };
        for bytes in [
            health_pdf(&identity(), &health).unwrap(),
            consent_pdf(&identity(), &consent).unwrap(),
        ] {
            assert!(bytes.starts_with(b"%PDF"));
            let doc = Document::load_mem(&bytes).unwrap();
            assert_eq!(doc.get_pages().len(), 1);
        }
    }
}

/// `TRACINK_PDF_SAMPLES=/dossier cargo test write_samples -- --ignored`
/// écrit deux formulaires entièrement remplis pour vérifier le placement à l'œil.
#[cfg(test)]
mod samples {
    use super::*;
    use crate::services::paperwork::Guardian;

    #[test]
    #[ignore]
    fn write_samples() {
        let Ok(dir) = std::env::var("TRACINK_PDF_SAMPLES") else {
            return;
        };
        let identity = Identity {
            last_name: "Martin".into(),
            first_name: "Léa".into(),
            birth_date: Some("2009-04-02".into()),
            address: Some("12 rue des Écoles, bâtiment B, 69001 Lyon".into()),
            phone: Some("06 12 34 56 78".into()),
            email: Some("lea.martin@exemple.fr".into()),
            session_date: "2026-10-14".into(),
            professional_name: "Camille Durand".into(),
            city: "Lyon".into(),
        };
        let health = HealthAnswers {
            sick_or_fever: Some(false),
            current_infection: Some(false),
            recent_surgery: Some(true),
            diabetes: Some(true),
            coagulation_disorder: Some(false),
            immunodeficiency: Some(false),
            heart_disease: Some(true),
            epilepsy: Some(false),
            anticoagulant: Some(true),
            healing_treatment: Some(true),
            healing_treatment_details: Some(
                "Isotrétinoïne depuis trois mois, arrêt prévu en décembre. Crème corticoïde ponctuelle sur l'avant-bras gauche.".into(),
            ),
            allergies: vec![Allergy::Nickel, Allergy::Inks, Allergy::Other],
            allergy_other: Some("Pollen".into()),
            pregnant_or_breastfeeding: Some(false),
            severe_allergic_reaction: Some(true),
            skin_lesion_on_area: Some(false),
            details: Some("Réaction au latex en 2022 (urticaire). Pas d'hospitalisation.".into()),
            professional_decision: Some(ProfessionalDecision::MedicalAdvice),
            professional_comments: Some("Attendre l'accord écrit du dermatologue.".into()),
        };
        let consent = ConsentAnswers {
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
            guardian: Some(Guardian {
                relation: Some(GuardianRelation::Mother),
                last_name: Some("Martin".into()),
                first_name: Some("Sophie".into()),
            }),
        };
        std::fs::write(
            format!("{dir}/health.pdf"),
            health_pdf(&identity, &health).unwrap(),
        )
        .unwrap();
        std::fs::write(
            format!("{dir}/consent.pdf"),
            consent_pdf(&identity, &consent).unwrap(),
        )
        .unwrap();
    }
}
