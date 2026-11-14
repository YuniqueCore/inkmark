use base64::{Engine, engine::general_purpose::STANDARD};
use nsh_core::{
    file_dialog::{FileFilter, OpenDialog},
    prelude::*,
};
use std::{io::Read, path::Path};

/// A selected document with a relative display path; no host path crosses the bridge.
#[derive(Debug, Clone, JsObject)]
pub struct ImportedFile {
    /// Basename shown in the workspace.
    pub name: String,
    /// Content type inferred from the supported extension, verified again by the domain importer.
    pub media_type: String,
    /// File bytes, encoded for the JSON bridge.
    pub base64: String,
    /// Path relative to the chosen folder's parent.
    pub relative_path: String,
}

/// User-mediated directory import on desktop.
#[module]
pub struct Import;

#[module]
impl Import {
    /// Selects files, reading a bounded aggregate after the user confirms.
    pub async fn files(
        multiple: bool,
        extensions: Vec<String>,
    ) -> Result<Vec<ImportedFile>, String> {
        let mut dialog = OpenDialog::files().multiple(multiple);
        if !extensions.is_empty() {
            dialog = dialog.filter(FileFilter::new("文档与图片", extensions));
        }
        let Some(paths) = pick_paths(dialog).await? else {
            return Ok(vec![]);
        };
        blocking(move || {
            if paths.len() > 100 {
                return Err("一次最多导入 100 个文件".into());
            }
            let mut files = Vec::new();
            let mut total = 0;
            for path in paths {
                let relative = path
                    .file_name()
                    .ok_or("无效的文件名")?
                    .to_string_lossy()
                    .into_owned();
                files.push(read_file(&path, relative, &mut total)?);
            }
            Ok(files)
        })
        .await
        .map_err(|_| "文件读取任务失败")?
    }

    /// Selects one folder. Cancellation returns no files; symbolic links are not followed.
    pub async fn folder() -> Result<Vec<ImportedFile>, String> {
        let selected = pick_paths(OpenDialog::folders()).await?;
        let Some(root) = selected.and_then(|paths| paths.into_iter().next()) else {
            return Ok(vec![]);
        };
        blocking(move || read_directory(&root))
            .await
            .map_err(|_| "文件读取任务失败")?
    }
}

pub(super) fn read_directory(root: &Path) -> Result<Vec<ImportedFile>, String> {
    let mut files = Vec::new();
    let mut total = 0;
    for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
        let entry = entry.map_err(|_| "无法读取所选文件夹中的文件")?;
        if !entry.file_type().is_file() {
            continue;
        }
        let extension = entry
            .path()
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ![
            "png", "jpg", "jpeg", "webp", "json", "md", "markdown", "txt",
        ]
        .contains(&extension.as_str())
        {
            continue;
        }
        if files.len() >= 100 {
            return Err("一次最多导入 100 个文件".into());
        }
        let relative = entry
            .path()
            .strip_prefix(root.parent().unwrap_or(root))
            .map_err(|_| "无效的相对路径")?;
        files.push(read_file(
            entry.path(),
            relative.to_string_lossy().replace('\\', "/"),
            &mut total,
        )?);
    }
    Ok(files)
}

pub(super) fn read_file(
    path: &Path,
    relative_path: String,
    total: &mut u64,
) -> Result<ImportedFile, String> {
    let remaining = super::MAX_BYTES as u64 - *total;
    if !std::fs::metadata(path)
        .map_err(|_| "无法读取文件信息")?
        .is_file()
    {
        return Err("只能导入普通文件".into());
    }
    let file = std::fs::File::open(path).map_err(|_| "无法打开所选文件")?;
    let metadata = file.metadata().map_err(|_| "无法读取文件大小")?;
    if !metadata.is_file() {
        return Err("只能导入普通文件".into());
    }
    if metadata.len() > remaining {
        return Err("所选文件合计超过 32 MB".into());
    }
    let mut bytes = Vec::new();
    file.take(remaining + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取所选文件")?;
    *total += bytes.len() as u64;
    if *total > super::MAX_BYTES as u64 {
        return Err("所选文件合计超过 32 MB".into());
    }
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let media_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "json" => "application/json",
        "md" | "markdown" => "text/markdown",
        _ => "text/plain",
    };
    Ok(ImportedFile {
        name: path
            .file_name()
            .ok_or("无效的文件名")?
            .to_string_lossy()
            .into_owned(),
        media_type: media_type.into(),
        base64: STANDARD.encode(bytes),
        relative_path,
    })
}
