fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let result = if args.len() == 1 {
        openforge_update_helper::run_helper()
    } else if args.len() == 2 && args[1] == openforge_update_helper::APP_BOOTSTRAP_ARGUMENT {
        openforge_update_helper::run_app_bootstrap()
    } else {
        Err("updater accepts only an inherited authenticated handoff".into())
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
