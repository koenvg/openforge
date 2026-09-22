fn main() {
    if std::env::args_os().len() != 1 {
        eprintln!("updater accepts only an inherited authenticated handoff");
        std::process::exit(1);
    }
    if let Err(error) = openforge_update_helper::run_helper() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
