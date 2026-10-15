fn main() {
    // Touch ID : petit pont Objective-C vers LocalAuthentication, macOS seulement.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/macos/touch_id.m");
        cc::Build::new()
            .file("src/macos/touch_id.m")
            .flag("-fobjc-arc")
            .flag("-fmodules")
            .compile("tracink_touch_id");
        println!("cargo:rustc-link-lib=framework=LocalAuthentication");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    tauri_build::build()
}
