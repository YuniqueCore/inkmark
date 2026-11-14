//! User-mediated, bounded file import and atomic export for the desktop host.
use std::{io::Write, path::Path};

use base64::{Engine, engine::general_purpose::STANDARD};
use nsh_core::{file_dialog::SaveDialog, prelude::*};
mod import;
use import::Import;

const MAX_BYTES: usize = 32 * 1024 * 1024;

#[native_module("inkmark/native")]
fn native(registry: &mut Registry) {
    registry.module::<Export>().module::<Import>();
}

#[module]
/// Desktop file export through the system save dialog.
pub struct Export;

#[module]
impl Export {
    /// Opens the system save dialog. Only an atomically committed file reports `saved`.
    pub async fn save(name: String, base64: String) -> Result<String, String> {
        validate_name(&name)?;
        if base64.len() > MAX_BYTES.div_ceil(3) * 4 {
            return Err("导出文件超过 32 MB".into());
        }
        let bytes = blocking(move || STANDARD.decode(base64))
            .await
            .map_err(|_| "文件解码任务失败")?
            .map_err(|_| "无效的文件数据")?;
        if bytes.len() > MAX_BYTES {
            return Err("导出文件超过 32 MB".into());
        }
        let Some(path) =
            pick_save_path(SaveDialog::new().file_name(name).title("导出 InkMark 文件")).await?
        else {
            return Ok("cancelled".into());
        };
        blocking(move || write_atomic(&path, &bytes))
            .await
            .map_err(|_| "文件保存任务失败")?
            .map_err(|error| format!("保存失败：{error}"))?;
        Ok("saved".into())
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.encode_utf16().count() > 255
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c < ' ' || c == '\u{7f}' || "/\\".contains(c))
    {
        return Err("无效的导出文件名".into());
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let directory = path
        .parent()
        .ok_or_else(|| std::io::Error::other("目标目录不可用"))?;
    let mut staged = tempfile::NamedTempFile::new_in(directory)?;
    staged.write_all(bytes)?;
    staged.as_file().sync_all()?;
    staged.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
