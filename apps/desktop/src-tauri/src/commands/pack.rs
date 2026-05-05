use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read, Seek};
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmpsPackParseResult {
    pub manifest: Value,
    pub fragment_text: String,
    pub package_sha256: String,
    pub manifest_sha256: String,
    pub fragment_sha256: String,
}

fn normalize_zip_path(path: &str) -> &str {
    path.strip_prefix("./")
        .or_else(|| path.strip_prefix('/'))
        .unwrap_or(path)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn find_zip_entry_index<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    filename: &str,
) -> Result<Option<usize>, String> {
    let target = normalize_zip_path(filename).to_ascii_lowercase();
    let mut normalized_match = None;

    for index in 0..archive.len() {
        let name = archive
            .by_index(index)
            .map_err(|error| format!("Invalid .pmps: unreadable zip entry metadata: {error}"))?
            .name()
            .to_string();

        if name == filename {
            return Ok(Some(index));
        }

        if normalized_match.is_none() {
            let normalized = normalize_zip_path(&name).to_ascii_lowercase();
            if normalized == target || normalized.ends_with(&format!("/{target}")) {
                normalized_match = Some(index);
            }
        }
    }

    Ok(normalized_match)
}

fn read_zip_entry_bytes<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    filename: &str,
) -> Result<Option<Vec<u8>>, String> {
    let Some(index) = find_zip_entry_index(archive, filename)? else {
        return Ok(None);
    };

    let mut file = archive
        .by_index(index)
        .map_err(|error| format!("Invalid .pmps: unreadable zip entry \"{filename}\": {error}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| {
        format!("Invalid .pmps: failed to read zip entry \"{filename}\": {error}")
    })?;
    Ok(Some(bytes))
}

fn manifest_fragment_path(manifest: &Value) -> Result<&str, String> {
    manifest
        .get("entry")
        .and_then(Value::as_object)
        .and_then(|entry| entry.get("fragment"))
        .and_then(Value::as_str)
        .filter(|fragment| !fragment.is_empty())
        .ok_or_else(|| "Invalid .pmps: manifest.entry.fragment is required".to_string())
}

pub fn parse_pmps_pack_bytes(bytes: &[u8]) -> Result<PmpsPackParseResult, String> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|error| format!("Invalid .pmps: failed to read zip: {error}"))?;

    let manifest_bytes = read_zip_entry_bytes(&mut archive, "manifest.json")?
        .ok_or_else(|| "Invalid .pmps: missing manifest.json".to_string())?;
    let manifest = serde_json::from_slice::<Value>(&manifest_bytes)
        .map_err(|error| format!("Invalid .pmps: manifest.json is not valid JSON: {error}"))?;

    let fragment_path = manifest_fragment_path(&manifest)?;
    let fragment_bytes = read_zip_entry_bytes(&mut archive, fragment_path)?
        .ok_or_else(|| format!("Invalid .pmps: missing fragment \"{fragment_path}\""))?;
    let fragment_text = String::from_utf8(fragment_bytes.clone()).map_err(|error| {
        format!("Invalid .pmps: fragment \"{fragment_path}\" is not UTF-8: {error}")
    })?;

    Ok(PmpsPackParseResult {
        manifest,
        fragment_text,
        package_sha256: sha256_hex(bytes),
        manifest_sha256: sha256_hex(&manifest_bytes),
        fragment_sha256: sha256_hex(&fragment_bytes),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pack_parse_pmps_pack_bytes(bytes: Vec<u8>) -> Result<PmpsPackParseResult, String> {
    tauri::async_runtime::spawn_blocking(move || parse_pmps_pack_bytes(&bytes))
        .await
        .map_err(|error| format!("PMPS parse task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{write::FileOptions, CompressionMethod, ZipWriter};

    fn make_pmps_zip(manifest: &str, files: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);

        writer.start_file("manifest.json", options).unwrap();
        writer.write_all(manifest.as_bytes()).unwrap();

        for (path, text) in files {
            writer.start_file(*path, options).unwrap();
            writer.write_all(text.as_bytes()).unwrap();
        }

        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn parses_pmps_manifest_fragment_and_hashes() {
        let manifest = r#"{"formatVersion":"2.0","type":"shader-pack","metadata":{"id":"native-pack","name":"Native Pack","version":"1.0.0"},"entry":{"fragment":"shaders/fragment.glsl"}}"#;
        let fragment = "void main() { gl_FragColor = vec4(1.0); }";
        let bytes = make_pmps_zip(manifest, &[("shaders/fragment.glsl", fragment)]);

        let parsed = parse_pmps_pack_bytes(&bytes).expect("pmps pack should parse");

        assert_eq!(parsed.manifest["metadata"]["id"], "native-pack");
        assert_eq!(parsed.fragment_text, fragment);
        assert_eq!(parsed.package_sha256, sha256_hex(&bytes));
        assert_eq!(parsed.manifest_sha256, sha256_hex(manifest.as_bytes()));
        assert_eq!(parsed.fragment_sha256, sha256_hex(fragment.as_bytes()));
    }

    #[test]
    fn reports_missing_fragment() {
        let manifest = r#"{"formatVersion":"2.0","type":"shader-pack","metadata":{"id":"native-pack","name":"Native Pack","version":"1.0.0"},"entry":{"fragment":"missing.glsl"}}"#;
        let bytes = make_pmps_zip(manifest, &[]);

        let error = parse_pmps_pack_bytes(&bytes).expect_err("missing fragment should fail");

        assert!(error.contains("missing fragment \"missing.glsl\""));
    }
}
