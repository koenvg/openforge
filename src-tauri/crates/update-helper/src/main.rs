fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let result = if args.len() == 1 {
        openforge_update_helper::run_helper()
    } else if args.len() == 2 && args[1] == openforge_update_helper::APP_BOOTSTRAP_ARGUMENT {
        openforge_update_helper::run_app_bootstrap()
    } else if args.len() == 4 && args[1] == "--cold-startup" {
        openforge_update_helper::run_cold_startup(
            std::path::Path::new(&args[2]),
            std::path::Path::new(&args[3]),
        )
    } else if args.len() == 4 && args[1] == "--cold-inspect" {
        (|| -> Result<(), String> {
            let target =
                openforge_update_helper::cold_target_sha256(std::path::Path::new(&args[2]))?;
            let source =
                openforge_update_helper::cold_source_sha256(std::path::Path::new(&args[3]))?;
            println!(
                "{}",
                serde_json::json!({"sourceSha256":source,"targetSha256":target})
            );
            Ok(())
        })()
    } else if args.len() == 6 && args[1] == "--cold-install" {
        openforge_update_helper::run_cold_install(
            std::path::Path::new(&args[2]),
            std::path::Path::new(&args[3]),
            std::path::Path::new(&args[4]),
            std::path::Path::new(&args[5]),
        )
    } else if args.len() == 4 && args[1] == "--cold-recover" {
        openforge_update_helper::run_cold_recovery(
            std::path::Path::new(&args[2]),
            std::path::Path::new(&args[3]),
        )
    } else {
        Err("updater accepts only an inherited authenticated handoff".into())
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
