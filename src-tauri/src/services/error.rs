#[derive(Debug)]
pub enum LotError {
    Invalid(&'static str),
    NotFound,
    AlreadyLinked,
    Database(sqlx::Error),
}

impl std::fmt::Display for LotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Introuvable"),
            Self::AlreadyLinked => write!(f, "Déjà lié à cette séance"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl From<sqlx::Error> for LotError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}
