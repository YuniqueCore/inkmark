use crate::{MAX_BYTES, import, validate_name, write_atomic};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::fs;

#[test]
fn export_overwrites_atomically_and_failed_destination_keeps_previous_bytes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("审阅.json");
    write_atomic(&path, b"old").unwrap();
    let bytes = [0, 255, 1, 0, 42];
    write_atomic(&path, &bytes).unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let directory = root.path().join("directory.json");
    fs::create_dir(&directory).unwrap();
    fs::write(directory.join("untouched"), b"keep").unwrap();
    assert!(write_atomic(&directory, b"replacement").is_err());
    assert_eq!(fs::read(directory.join("untouched")).unwrap(), b"keep");
    assert_eq!(
        fs::read_dir(root.path()).unwrap().count(),
        2,
        "staging files are removed on failure"
    );
    for name in ["", ".", "..", "../secret", "a\\b", "a\n/../b", "a\0b"] {
        assert!(validate_name(name).is_err(), "{name:?}");
    }
    assert!(validate_name("审阅 😀.json").is_ok());
}

#[test]
fn folder_import_preserves_relative_paths_and_rejects_partial_oversized_selections() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("reviews");
    fs::create_dir_all(folder.join("nested")).unwrap();
    fs::write(folder.join("a.md"), "# 审阅").unwrap();
    fs::write(folder.join("nested/b.PNG"), [0, 255, 7]).unwrap();
    fs::write(folder.join("ignored.exe"), b"not a document").unwrap();
    let files = import::read_directory(&folder).unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[1].relative_path, "reviews/nested/b.PNG");
    assert_eq!(files[1].media_type, "image/png");
    assert_eq!(STANDARD.decode(&files[1].base64).unwrap(), [0, 255, 7]);
    assert!(import::read_file(&folder, "reviews".into(), &mut 0).is_err());
    let large = fs::File::create(folder.join("too-large.txt")).unwrap();
    large.set_len(MAX_BYTES as u64).unwrap();
    assert!(
        import::read_directory(&folder)
            .unwrap_err()
            .contains("32 MB")
    );
    fs::remove_file(folder.join("too-large.txt")).unwrap();
    for n in 0..99 {
        fs::write(folder.join(format!("{n}.txt")), b"").unwrap();
    }
    assert!(import::read_directory(&folder).unwrap_err().contains("100"));
}

#[cfg(unix)]
#[test]
fn folder_import_does_not_follow_symlinks_outside_the_selected_root() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("selected");
    fs::create_dir(&folder).unwrap();
    fs::write(root.path().join("private.txt"), b"outside").unwrap();
    std::os::unix::fs::symlink(root.path().join("private.txt"), folder.join("link.txt")).unwrap();
    std::os::unix::fs::symlink(root.path(), folder.join("cycle")).unwrap();
    assert!(import::read_directory(&folder).unwrap().is_empty());
}
