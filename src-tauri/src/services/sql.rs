pub(crate) const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%S', 'now')";

pub(crate) fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

pub(crate) fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..].iter().all(u8::is_ascii_digit)
}

pub(crate) fn like_pattern(search: Option<String>) -> Option<String> {
    clean(search).map(|text| {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    })
}

/// Message affiché quand SQLite échoue. Le détail technique reste dans le journal :
/// il peut contenir des noms de tables, jamais montrés à l'utilisatrice.
pub(crate) const DATABASE_MESSAGE: &str =
    "Erreur d'accès aux données. Réessaie, puis redémarre l'app si le problème continue.";

/// Journalise une erreur SQLite sans donnée client : sqlx ne recopie pas les valeurs liées.
pub(crate) fn log_database_error(error: &sqlx::Error) {
    eprintln!("erreur SQLite : {error}");
}
