pub mod domain;
pub mod parser;
pub mod repository;
pub mod service;

pub use domain::PMPLyricDocument;
pub use service::{
    LyricResolveQuery, LyricResolveRequest, LyricResolveResult, LyricWriteBackRequest,
    LyricWriteBackResult,
};
