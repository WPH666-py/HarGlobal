//! Product identity shared by the shell's modules.
//!
//! This shell ships one product, HarGlobal, so the name is a compile-time constant: an installed
//! application has no environment to inherit one from, and the office product this shell used to
//! be built as alongside lives in its own repository.

/// Product name baked into this binary.
pub const PRODUCT_NAME: &str = "HarGlobal";
