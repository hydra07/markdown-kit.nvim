//! Force a recompile whenever the embedded client bundle changes.
//!
//! `rust_embed` bakes `../client/dist/` into the release binary at compile time,
//! but its derive macro cannot tell Cargo about that dependency. Without this,
//! rebuilding the client and then `cargo build --release` reuses the cached
//! binary and ships the *previous* UI. Emitting `rerun-if-changed` for every
//! file in the bundle makes Cargo rebuild the crate when the dist changes.

use std::path::Path;

fn main() {
    let dist = Path::new("../client/dist");
    println!("cargo:rerun-if-changed=../client/dist");
    watch(dist);
}

fn watch(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        println!("cargo:rerun-if-changed={}", path.display());
        if path.is_dir() {
            watch(&path);
        }
    }
}
