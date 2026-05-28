const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let mut args = std::env::args().skip(1);

    match args.next().as_deref() {
        None | Some("packet") => print_basic_packet(),
        Some("inspect") => print_inspect_report(),
        Some("doctor") => print_doctor_report(),
        Some("version") | Some("--version") | Some("-V") => print_version(),
        Some("help") | Some("--help") | Some("-h") => print_help(),
        Some(other) => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: bea-l [packet|inspect|doctor|version|help]");
            std::process::exit(2);
        }
    }
}

fn print_version() {
    println!("bea-l {VERSION}");
}

fn print_help() {
    println!("bea-l {VERSION}");
    println!();
    println!("Local evidence packet tool for AI coding chats.");
    println!();
    println!("Usage:");
    println!("  bea-l packet    Print a compact basic packet");
    println!("  bea-l inspect   Print a readable local evidence report");
    println!("  bea-l doctor    Check the local bea-l CLI surface");
    println!("  bea-l version   Print version information");
    println!();
    println!("Boundary:");
    println!("  local evidence only; no source mutation; no model call; no upload");
}

fn print_basic_packet() {
    println!("BEA-L BASIC PACKET");
    println!("boundary=local evidence only; no source mutation; no model call");
    println!("editor=unknown errors=? warnings=?");
    println!("build=unknown tests=? failed=?");
    println!("visual=attach screenshot if relevant");
    println!("next=paste this with your request");
}

fn print_inspect_report() {
    println!("bea-l workbench evidence");
    println!();
    println!("Boundary:");
    println!("local evidence only; no source mutation; no model call; no upload");
    println!();
    println!("Editor:");
    println!("status=unknown");
    println!("errors=?");
    println!("warnings=?");
    println!();
    println!("Build:");
    println!("status=unknown");
    println!("tests=?");
    println!("failed=?");
    println!();
    println!("Visual:");
    println!("attach screenshot if relevant");
    println!();
    println!("Next:");
    println!("Run `bea-l packet` to print the compact packet.");
}

fn print_doctor_report() {
    println!("bea-l doctor");
    println!("status=ok");
    println!("boundary=local evidence only; no source mutation; no model call; no upload");
}
