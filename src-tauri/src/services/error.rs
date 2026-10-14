#[derive(Debug)]
pub enum LotError {
    Invalid(&'static str),
    NotFound,
    AlreadyLinked,
    /// Erreur SQLite, déjà journalisée. Le détail ne remonte pas à l'écran.
    Database,
}

impl std::fmt::Display for LotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Introuvable"),
            Self::AlreadyLinked => write!(f, "Déjà lié à cette séance"),
            Self::Database => write!(f, "{}", super::sql::DATABASE_MESSAGE),
        }
    }
}

impl From<sqlx::Error> for LotError {
    fn from(error: sqlx::Error) -> Self {
        super::sql::log_database_error(&error);
        Self::Database
    }
}

#[cfg(test)]
mod tests {
    use super::super::clients::ClientError;
    use super::super::sessions::SessionError;
    use super::super::sql::DATABASE_MESSAGE;
    use super::LotError;

    #[test]
    fn database_errors_never_reach_the_screen_as_raw_sql() {
        let raw = || sqlx::Error::Protocol("UNIQUE constraint failed: lots.name".into());
        for shown in [
            LotError::from(raw()).to_string(),
            ClientError::from(raw()).to_string(),
            SessionError::from(raw()).to_string(),
        ] {
            assert_eq!(shown, DATABASE_MESSAGE);
            assert!(!shown.contains("constraint"));
        }
    }
}
